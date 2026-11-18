import { describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { IDL, cardPda, toHex } from "@solsend/shared";
import { createAsaEngine, type AsaDeps } from "./engine";
import { signLikeLithic } from "../lithic/webhook";
import { authCommitment, merchantCommitment } from "../lib/commitments";
import { realClock } from "../solana/rpc";
import { MockRpc, putRecord } from "../__test__/mockRpc";

const secret = "whsec_" + randomBytes(24).toString("base64");
const owner = Keypair.generate().publicKey;
const cardId = 123456789n;
const pda = cardPda(owner, cardId);
const tags = { solsend_card: pda.toBase58(), solsend_owner: owner.toBase58(), solsend_card_id: cardId.toString() };
const settleDisc = IDL.instructions.find((i) => i.name === "settle")!.discriminator;

function req(over: Record<string, unknown> = {}, cents = 114) {
  return {
    token: randomUUID(), status: "AUTHORIZATION", amount: cents,
    amounts: { cardholder: { amount: cents, currency: "USD" } },
    card: { token: randomUUID(), state: "OPEN", type: "VIRTUAL", tags },
    merchant: { descriptor: "TEMU (SANDBOX)", acceptor_id: "SOLSENDDEMOTEMU01", mcc: "5399" },
    ...over,
  };
}
function signed(body: unknown, opts: { tamper?: boolean; ts?: number; badSig?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const id = `msg_${randomUUID()}`;
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const headers = new Headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": opts.badSig ? "v1,AAAA" : signLikeLithic(secret, id, ts, raw) });
  return { raw: opts.tamper ? raw.replace("114", "115") : raw, headers };
}
function engine(rpc: MockRpc, over: Partial<AsaDeps> = {}) {
  return createAsaEngine({
    rpc: rpc.asRpc(), settler: Keypair.generate(), secret, budgetMs: 800, cuLimit: 120_000, clock: realClock,
    blockhash: async () => (await rpc.getLatestBlockhash()).blockhash, outage: async () => false, rebroadcastMs: 60, pollMs: 50, ...over,
  });
}
const run = async (e: ReturnType<typeof engine>, body: unknown, opts?: Parameters<typeof signed>[1]) => { const s = signed(body, opts); return e.handle(s.raw, s.headers); };

describe("ASA HMAC", () => {
  it("accepts a correctly signed request, rejects tampered / bad / stale / missing (401)", async () => {
    const rpc = new MockRpc();
    const e = engine(rpc);
    expect((await run(e, req())).status).toBe(200);
    expect((await run(e, req(), { tamper: true })).status).toBe(401);
    expect((await run(e, req(), { badSig: true })).status).toBe(401);
    expect((await run(e, req(), { ts: Math.floor(Date.now() / 1000) - 301 })).status).toBe(401);
    const missing = await e.handle(JSON.stringify(req()), new Headers());
    expect(missing.status).toBe(401);
  });
});

describe("ASA decision (confirmed-before-approve)", () => {
  it("APPROVES only after the settle is CONFIRMED with err null; tx = ComputeBudget + settle (no memo)", async () => {
    const rpc = new MockRpc();
    let confirmedAt = 0;
    rpc.onSend = () => ({ err: null });
    rpc.confirmAfterMs = 120;
    const origConfirm = rpc.confirm.bind(rpc);
    rpc.confirm = (s, st) => { confirmedAt = Date.now(); origConfirm(s, st); };
    const body = req();
    const out = await run(engine(rpc), body);
    const repliedAt = Date.now();
    expect(out.status).toBe(200);
    if (out.status !== 200) return;
    expect(out.body.result).toBe("APPROVED");
    expect(out.decision.reason).toBe("settled_confirmed");
    expect(confirmedAt).toBeGreaterThan(0);
    expect(confirmedAt).toBeLessThanOrEqual(repliedAt);
    // inspect the tx: exactly 2 instructions, ix1 = settle with the v1 commitments, no memo program
    const tx = VersionedTransaction.deserialize(rpc.sent[0]!);
    const ixs = tx.message.compiledInstructions;
    expect(ixs.length).toBe(2);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).not.toContain("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const data = Buffer.from(ixs[1]!.data);
    expect([...data.subarray(0, 8)]).toEqual(settleDisc);
    expect(data.readBigUInt64LE(8)).toBe(1_140_000n);
    expect(toHex(data.subarray(16, 48))).toBe(toHex(authCommitment(body.token)));
    expect(toHex(data.subarray(48, 80))).toBe(toHex(merchantCommitment("SOLSENDDEMOTEMU01")));
  });

  it("deadline → decline (fail-closed), never approves late", async () => {
    const rpc = new MockRpc();
    rpc.confirmAfterMs = 2_000; // confirms long after the 800 ms budget
    const out = await run(engine(rpc), req());
    expect(out.status === 200 && out.body.result).toBe("INSUFFICIENT_FUNDS");
    if (out.status === 200) { expect(["deadline_exceeded", "no_confirmation"]).toContain(out.decision.reason); expect(out.decision.settleSent).toBe(true); expect(out.decision.signature).toBeTruthy(); }
  });

  it("deadline fires BEFORE the send (slow blockhash) → decline and NOTHING is sent afterwards (no unwatched late settle)", async () => {
    const rpc = new MockRpc();
    const slow = () => new Promise<string>((r) => setTimeout(async () => r((await rpc.getLatestBlockhash()).blockhash), 1_000));
    const out = await run(engine(rpc, { blockhash: slow }), req());
    expect(out.status === 200 && out.body.result).toBe("INSUFFICIENT_FUNDS");
    if (out.status === 200) expect([out.decision.reason, out.decision.settleSent, out.decision.signature]).toEqual(["deadline_exceeded", false, null]);
    await new Promise((r) => setTimeout(r, 400)); // let the abandoned work resume
    expect(rpc.sent.length).toBe(0);
  });

  it("never throws: RPC exceptions → decline", async () => {
    const rpc = new MockRpc();
    rpc.sendThrows = new Error("socket hang up");
    rpc.rpcThrows = true;
    rpc.onSend = () => null;
    const out = await run(engine(rpc, { blockhash: async () => { throw new Error("rpc down"); } }), req());
    expect(out.status === 200 && out.body.result).not.toBe("APPROVED");
  });

  it("rebroadcasts the same bytes while waiting for confirmation", async () => {
    const rpc = new MockRpc();
    rpc.confirmAfterMs = 300;
    rpc.onSend = (_s, _r, n) => (n === 1 ? { err: null } : null);
    await run(engine(rpc), req());
    expect(rpc.sent.length).toBeGreaterThan(1);
    expect(new Set(rpc.sent.map((b) => Buffer.from(b).toString("hex"))).size).toBe(1);
  });
});

describe("ASA error mapping (onchain result → reply)", () => {
  const cases: [unknown, string][] = [
    [{ Custom: 300 }, "INSUFFICIENT_FUNDS"], [{ Custom: 1 }, "INSUFFICIENT_FUNDS"], [{ Custom: 400 }, "VELOCITY_EXCEEDED"],
    [{ Custom: 6003 }, "CARD_PAUSED"], [{ Custom: 6007 }, "CARD_PAUSED"], [{ Custom: 6004 }, "CARD_PAUSED"], ["InvalidAccountOwner", "CARD_PAUSED"],
    [{ Custom: 6005 }, "UNAUTHORIZED_MERCHANT"], [{ Custom: 6006 }, "VELOCITY_EXCEEDED"], [{ Custom: 4242 }, "SUSPECTED_FRAUD"],
  ];
  it.each(cases)("settle error %j → %s", async (detail, expected) => {
    const rpc = new MockRpc();
    rpc.onSend = () => ({ err: { InstructionError: [1, detail] } as never });
    const out = await run(engine(rpc), req());
    expect(out.status === 200 && out.body.result).toBe(expected);
  });
});

describe("ASA duplicate rule", () => {
  const dupErr = { InstructionError: [1, { Custom: 0 }] } as never;
  it("approves only when the record is readable at confirmed AND amount matches exactly", async () => {
    const rpc = new MockRpc();
    rpc.onSend = () => ({ err: dupErr });
    const body = req();
    putRecord(rpc, pda, authCommitment(body.token), 1_140_000n);
    const out = await run(engine(rpc), body);
    expect(out.status === 200 && out.body.result).toBe("APPROVED");
    expect(out.status === 200 && out.decision.reason).toBe("duplicate_already_settled");
  });
  it("record with a different amount (incremental auth) → decline", async () => {
    const rpc = new MockRpc();
    rpc.onSend = () => ({ err: dupErr });
    const body = req();
    putRecord(rpc, pda, authCommitment(body.token), 500_000n);
    const out = await run(engine(rpc), body);
    expect(out.status === 200 && out.body.result).not.toBe("APPROVED");
    expect(out.status === 200 && out.decision.reason).toBe("duplicate_amount_mismatch");
  });
  it("duplicate error but record never readable → decline", async () => {
    const rpc = new MockRpc();
    rpc.onSend = () => ({ err: dupErr });
    const out = await run(engine(rpc), req());
    expect(out.status === 200 && out.body.result).toBe("INSUFFICIENT_FUNDS");
  });
  it("same token concurrently on one instance → one settle, same reply", async () => {
    const rpc = new MockRpc();
    rpc.confirmAfterMs = 100;
    const e = engine(rpc);
    const body = req();
    const [a, b] = await Promise.all([run(e, body), run(e, body)]);
    expect(a.status === 200 && a.body.result).toBe("APPROVED");
    expect(b.status === 200 && b.body.result).toBe("APPROVED");
    expect(b.status === 200 && b.deduped).toBe(true);
    expect(new Set(rpc.sent.map((x) => Buffer.from(x.subarray(1, 65)).toString("hex"))).size).toBe(1);
  });
});

describe("ASA gates (no settle sent)", () => {
  const gate = async (body: unknown, over: Partial<AsaDeps> = {}) => {
    const rpc = new MockRpc();
    const out = await run(engine(rpc, over), body);
    return { out, sent: rpc.sent.length, result: out.status === 200 ? out.body.result : `HTTP_${out.status}`, reason: out.status === 200 ? out.decision.reason : "" };
  };
  it("$0 verification → APPROVED without settle", async () => {
    const g = await gate(req({}, 0));
    expect([g.result, g.reason, g.sent]).toEqual(["APPROVED", "zero_amount_verification", 0]);
  });
  it("missing / forged tags mapping → UNAUTHORIZED_MERCHANT", async () => {
    const other = cardPda(Keypair.generate().publicKey, 1n).toBase58();
    for (const t of [undefined, { ...tags, solsend_card: other }, { ...tags, solsend_card_id: "abc" }]) {
      const g = await gate(req({ card: { token: "c", state: "OPEN", tags: t } }));
      expect([g.result, g.reason, g.sent]).toEqual(["UNAUTHORIZED_MERCHANT", "unmapped_card", 0]);
    }
  });
  it("status gate: only AUTHORIZATION / FINANCIAL_AUTHORIZATION settle", async () => {
    for (const status of ["BALANCE_INQUIRY", "CREDIT_AUTHORIZATION", "FINANCIAL_CREDIT_AUTHORIZATION", "SOMETHING_NEW"]) {
      const g = await gate(req({ status }));
      expect(g.result).not.toBe("APPROVED");
      expect(g.sent).toBe(0);
    }
    expect((await gate(req({ status: "FINANCIAL_AUTHORIZATION" }))).result).toBe("APPROVED");
  });
  it("non-USD → decline; Lithic card state not OPEN → decline", async () => {
    expect((await gate(req({ amounts: { cardholder: { amount: 114, currency: "EUR" } } }))).result).toBe("SUSPECTED_FRAUD");
    const paused = await gate(req({ card: { token: "c", state: "PAUSED", tags } }));
    expect([paused.result, paused.sent]).toEqual(["CARD_PAUSED", 0]);
  });
  it("issuer outage → CARD_PAUSED before any settle", async () => {
    const g = await gate(req(), { outage: async () => true });
    expect([g.result, g.reason, g.sent]).toEqual(["CARD_PAUSED", "issuer_outage", 0]);
  });
  it("malformed (but signed) body → decline, not 500", async () => {
    const g = await gate({ token: "x" });
    expect(g.result).toBe("SUSPECTED_FRAUD");
  });
});
