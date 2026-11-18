import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { IDL, SOLSEND_PROGRAM_ID, cardDelegation, cardPda, toHex, usdcAta } from "@solsend/shared";
import { MemoryStore } from "../store";
import { authCommitment } from "../lib/commitments";
import { realClock } from "../solana/rpc";
import { MockRpc, encodeCard, putRecord } from "../__test__/mockRpc";
import { reconcileAuthorization, recoverMissingRow, sweep } from "./reconciler";
import { maybePiggybackSweep } from "./piggyback";
import { applyTransactionUpdate, intakeLithicEvent } from "./events";
import { signLikeLithic } from "../lithic/webhook";
import { afterAsaReply } from "../asa/after";
import type { AsaDecision } from "../asa/engine";

const refundDisc = IDL.instructions.find((i) => i.name === "refund")!.discriminator;

function world(status: string | null) {
  const rpc = new MockRpc();
  const store = new MemoryStore();
  const owner = Keypair.generate().publicKey;
  const cardId = 42n;
  const pda = cardPda(owner, cardId);
  rpc.setAccount(pda, SOLSEND_PROGRAM_ID, encodeCard({ owner, cardId, delegation: cardDelegation(owner, cardId), source: usdcAta(owner) }));
  const lithicCalls: string[] = [];
  const lithic = { getTransaction: async (t: string) => { lithicCalls.push(t); return status === null ? null : { token: t, status }; }, setCardState: async () => {} };
  const deps = { rpc: rpc.asRpc(), settler: Keypair.generate(), store, lithic, clock: realClock, blockhash: async () => (await rpc.getLatestBlockhash()).blockhash };
  return { rpc, store, owner, cardId, pda, deps, lithicCalls };
}
async function addAuth(w: ReturnType<typeof world>, decision: string, recordAmount: bigint | null, extra: Record<string, unknown> = {}) {
  const token = randomUUID();
  const h = authCommitment(token);
  if (recordAmount !== null) putRecord(w.rpc, w.pda, h, recordAmount);
  await w.store.upsertAuthorization({ lithic_token: token, auth_hash: toHex(h), card_pda: w.pda.toBase58(), amount_cents: 114, decision, reason: "x", settle_signature: "sig", timings: {}, ...extra });
  return token;
}

describe("reconciler executor", () => {
  it("VOIDED approved auth → refund(remainder) via the program, row + feed (lithic_token set) updated", async () => {
    const w = world("VOIDED");
    const token = await addAuth(w, "APPROVED", 1_140_000n);
    const r = await reconcileAuthorization(w.deps, (await w.store.getAuthorization(token))!);
    expect(r.outcome).toBe("refund");
    const tx = VersionedTransaction.deserialize(w.rpc.sent[0]!);
    const data = Buffer.from(tx.message.compiledInstructions[1]!.data);
    expect([...data.subarray(0, 8)]).toEqual(refundDisc);
    expect(data.readBigUInt64LE(8)).toBe(1_140_000n);
    const row = (await w.store.getAuthorization(token))!;
    expect([row.reconcile_action, row.refund_signature, row.lithic_final_status]).toEqual(["refunded", r.refundSignature, "VOIDED"]);
    const feed = w.store.feed.find((f) => f.kind === "refunded")!;
    expect(feed).toMatchObject({ lithic_token: token, card_pda: w.pda.toBase58(), owner_wallet: w.owner.toBase58(), amount_base: "1140000", source: "reconciler", signature: r.refundSignature });
    expect(feed.reason).toMatch(/card limit stays used/);
  });
  it("PENDING → wait (no refund, row stays in the sweep); lookup failure → wait", async () => {
    const w = world("PENDING");
    const token = await addAuth(w, "APPROVED", 1_140_000n);
    expect((await reconcileAuthorization(w.deps, (await w.store.getAuthorization(token))!)).outcome).toBe("wait");
    expect(w.rpc.sent.length).toBe(0);
    expect((await w.store.getAuthorization(token))!.reconcile_action).toBeNull();
  });
  it("APPROVED with no onchain record → anomaly flagged", async () => {
    const w = world("SETTLED");
    const token = await addAuth(w, "APPROVED", null);
    const r = await reconcileAuthorization(w.deps, (await w.store.getAuthorization(token))!);
    expect([r.outcome, (await w.store.getAuthorization(token))!.reconcile_action]).toEqual(["anomaly", "anomaly_approved_without_record"]);
  });
  it("failed refund leaves reconcile_action null so the cron retries", async () => {
    const w = world("DECLINED");
    w.rpc.onSend = () => ({ err: { InstructionError: [1, { Custom: 6018 }] } as never });
    const token = await addAuth(w, "INSUFFICIENT_FUNDS", 770_000n);
    const r = await reconcileAuthorization(w.deps, (await w.store.getAuthorization(token))!);
    expect(r.outcome).toBe("error");
    expect((await w.store.getAuthorization(token))!.reconcile_action).toBeNull();
  });
  it("sweep only processes unreconciled rows", async () => {
    const w = world("DECLINED");
    await addAuth(w, "INSUFFICIENT_FUNDS", null);
    await addAuth(w, "INSUFFICIENT_FUNDS", null, { reconcile_action: "none_no_settle" });
    const res = await sweep(w.deps, { olderThanSecs: 0 });
    expect(res.length).toBe(1);
  });
});

describe("piggyback sweep + missing-row recovery", () => {
  it("piggyback runs at most once per 60 s window and never throws", async () => {
    const w = world("DECLINED");
    await addAuth(w, "INSUFFICIENT_FUNDS", null);
    expect(await maybePiggybackSweep(() => w.deps, w.store)).toBe(0); // row is <20 s old → not yet in the batch, but the window is consumed
    expect(await maybePiggybackSweep(() => w.deps, w.store)).toBeNull();
    expect(await maybePiggybackSweep(() => { throw new Error("boom"); }, new MemoryStore())).toBeNull();
  });
  it("missing authorizations row + onchain record + Lithic NOT_FOUND (aged) → rebuilt from chain and refunded", async () => {
    const w = world(null);
    const token = randomUUID();
    putRecord(w.rpc, w.pda, authCommitment(token), 30_000n); // created_ts = 1 (1970) → past the NOT_FOUND grace
    const r = await recoverMissingRow(w.deps, token, w.pda.toBase58());
    expect([r.outcome, r.tag]).toEqual(["refund", "refunded"]);
    expect((await w.store.getAuthorization(token))!).toMatchObject({ decision: "UNKNOWN", reconcile_action: "refunded" });
    expect((await recoverMissingRow(w.deps, randomUUID(), w.pda.toBase58())).tag).toBe("no_onchain_record");
  });
});

describe("ASA after-hook", () => {
  const decision = (w: ReturnType<typeof world>, over: Partial<AsaDecision>): AsaDecision => ({
    result: "APPROVED", reason: "settled_confirmed", token: randomUUID(), card: { pda: w.pda, owner: w.owner, cardId: w.cardId }, lithicCardToken: "lc",
    amountCents: 114, amountBase: 1_140_000n, authHashHex: null, merchant: { descriptor: "TEMU (SANDBOX)", acceptorId: "A" }, signature: "5sig", confirmedAt: new Date().toISOString(),
    settleSent: true, timings: { total_ms: 900 }, ...over,
  });
  it("persists decision = exact ASA code, human reason, auth_hash + card_pda, and a lithic feed row", async () => {
    const w = world("PENDING");
    const d = decision(w, { result: "INSUFFICIENT_FUNDS", reason: "card_limit_exceeded", settleSent: false });
    d.authHashHex = toHex(authCommitment(d.token));
    await afterAsaReply({ ...w.deps, lateWatchMs: 10 }, d, new Date().toISOString(), { deduped: false });
    const row = (await w.store.getAuthorization(d.token))!;
    expect(row).toMatchObject({ decision: "INSUFFICIENT_FUNDS", auth_hash: d.authHashHex, card_pda: w.pda.toBase58(), reconcile_action: "none_no_settle" });
    expect(row.reason).toBe("Over this card's limit (Allowances 300)");
    expect(w.store.feed[0]).toMatchObject({ kind: "authorization_declined", source: "lithic", lithic_token: d.token });
  });
  it("late settle after a decline (deadline) is refunded once Lithic says DECLINED", async () => {
    const w = world("DECLINED");
    const d = decision(w, { result: "INSUFFICIENT_FUNDS", reason: "deadline_exceeded" });
    d.authHashHex = toHex(authCommitment(d.token));
    putRecord(w.rpc, w.pda, authCommitment(d.token), 770_000n); // the settle landed after we declined
    await afterAsaReply({ ...w.deps, lateWatchMs: 20 }, d, new Date().toISOString(), { deduped: false });
    const row = (await w.store.getAuthorization(d.token))!;
    expect(row.reconcile_action).toBe("refunded");
    expect(row.refund_signature).toBeTruthy();
  });
  it("a declined redelivery never downgrades an APPROVED row", async () => {
    const w = world("PENDING");
    const d = decision(w, {});
    d.authHashHex = toHex(authCommitment(d.token));
    await afterAsaReply(w.deps, d, new Date().toISOString(), { deduped: false });
    await afterAsaReply({ ...w.deps, lateWatchMs: 10 }, { ...d, result: "SUSPECTED_FRAUD", reason: "duplicate_amount_mismatch" }, new Date().toISOString(), { deduped: false });
    expect((await w.store.getAuthorization(d.token))!.decision).toBe("APPROVED");
  });
});

describe("Lithic events intake", () => {
  const secret = "whsec_" + Buffer.from("events-secret-0123456789").toString("base64");
  const deliver = (w: ReturnType<typeof world>, body: unknown, id = `msg_${randomUUID()}`, key = secret) => {
    const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000));
    return intakeLithicEvent(w.deps, secret, new Headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": signLikeLithic(key, id, ts, raw) }), raw);
  };
  it("verifies HMAC, dedupes webhook-id, ignores other event types", async () => {
    const w = world("VOIDED");
    const body = { event_type: "card_transaction.updated", token: randomUUID(), status: "VOIDED", result: "APPROVED" };
    expect((await deliver(w, body, "msg_1")).status).toBe(200);
    expect(await deliver(w, body, "msg_1")).toMatchObject({ kind: "duplicate" });
    expect(await deliver(w, { ...body, event_type: "card.created" })).toMatchObject({ kind: "ignored" });
    expect((await deliver(w, body, "msg_2", "whsec_" + Buffer.from("wrong").toString("base64"))).status).toBe(401);
  });
  it("void event → refund through the reconciler", async () => {
    const w = world(null);
    const token = await addAuth(w, "APPROVED", 1_140_000n);
    const r = await applyTransactionUpdate(w.deps, { token, status: "VOIDED", result: "APPROVED" }, { rowWaitMs: 0 });
    expect(r.outcome).toBe("refund");
    expect(w.lithicCalls.length).toBe(0); // status came from the verified event
  });
  it("Lithic-side decline with no ASA row → recorded as a safety-limit decline, no settle", async () => {
    const w = world(null);
    const token = randomUUID();
    await w.store.insertCard({ card_pda: w.pda.toBase58(), owner_wallet: w.owner.toBase58(), card_id: "42", kind: "STORE_LOCKED", label: "T", merchant_name: "T", limit_base: "1", period_secs: null,
      issue_state: "issued", register_signature: null, lithic_card_token: "lc1", lithic_last_four: "1234", lithic_error: null });
    await applyTransactionUpdate(w.deps, { token, status: "DECLINED", card_token: "lc1", amount: 9999 }, { rowWaitMs: 0 });
    const row = (await w.store.getAuthorization(token))!;
    expect(row.reconcile_action).toBe("none_lithic_declined");
    expect(w.store.feed.find((f) => f.lithic_token === token)?.reason).toBe("Declined by card-network safety limit (sandbox)");
  });
});
