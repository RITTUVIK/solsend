// Regression tests ported from the independent backend audit (scratchpad/backend-audit/*.audit.test.ts).
// Each FAILED on the pre-fix code (the auditor's tests asserted the buggy behavior) and passes after the fix batch.
import { describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { SOLSEND_PROGRAM_ID, cardDelegation, cardPda, toHex, usdcAta } from "@solsend/shared";
import { createAsaEngine } from "../asa/engine";
import { signLikeLithic } from "../lithic/webhook";
import { authCommitment } from "../lib/commitments";
import { realClock } from "../solana/rpc";
import { MemoryStore } from "../store";
import { applyTransactionUpdate } from "../reconcile/events";
import { sweep } from "../reconcile/reconciler";
import { MockRpc, encodeCard, putRecord, randomKey } from "./mockRpc";

const secret = "whsec_" + randomBytes(24).toString("base64");
const settler = Keypair.generate();
const owner = randomKey(); const cardId = 7n; const pda = cardPda(owner, cardId);
const tags = { solsend_card: pda.toBase58(), solsend_owner: owner.toBase58(), solsend_card_id: cardId.toString() };
const req = (token: string, cents: number, status = "AUTHORIZATION") => ({ token, status, amount: cents, amounts: { cardholder: { amount: cents, currency: "USD" } },
  card: { token: "lc", state: "OPEN", tags }, merchant: { descriptor: "TEMU (SANDBOX)", acceptor_id: "SOLSENDTEMU01" } });
const signed = (body: unknown, id = "msg_" + randomUUID()) => { const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000));
  return { raw, headers: new Headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": signLikeLithic(secret, id, ts, raw) }) }; };
const engine = (rpc: MockRpc) => createAsaEngine({ rpc: rpc.asRpc(), settler, secret, budgetMs: 800, cuLimit: 80_000, clock: realClock,
  blockhash: async () => (await rpc.getLatestBlockhash()).blockhash, outage: async () => false, rebroadcastMs: 60, pollMs: 50 });

describe("AUDIT H1: in-flight dedupe must compare the request, not just the token", () => {
  it("same token with a LARGER amount or a BALANCE_INQUIRY is declined (inflight_mismatch), never the cached APPROVED; one settle", async () => {
    const rpc = new MockRpc(); const e = engine(rpc); const token = randomUUID();
    const a = signed(req(token, 100)); const r1 = await e.handle(a.raw, a.headers);
    const b = signed(req(token, 4999)); const r2 = await e.handle(b.raw, b.headers);
    const c = signed(req(token, 4999, "BALANCE_INQUIRY")); const r3 = await e.handle(c.raw, c.headers);
    expect(r1.status === 200 && r1.body.result).toBe("APPROVED");
    expect(r2.status === 200 && [r2.body.result, r2.decision.reason]).toEqual(["SUSPECTED_FRAUD", "inflight_mismatch"]);
    expect(r3.status === 200 && r3.body.result).not.toBe("APPROVED");
    expect(new Set(rpc.sent.map((x) => Buffer.from(x.subarray(1, 65)).toString("hex"))).size).toBe(1);
  });
  it("an identical redelivery (same fingerprint) still gets the same decision", async () => {
    const rpc = new MockRpc(); const e = engine(rpc); const token = randomUUID();
    const a = signed(req(token, 100)); const b = signed(req(token, 100));
    const [r1, r2] = await Promise.all([e.handle(a.raw, a.headers), e.handle(b.raw, b.headers)]);
    expect([r1.status === 200 && r1.body.result, r2.status === 200 && r2.body.result]).toEqual(["APPROVED", "APPROVED"]);
  });
});

describe("AUDIT M1: duplicate path must not approve a refunded record", () => {
  it("record fully refunded → decline", async () => {
    const rpc = new MockRpc(); rpc.onSend = () => ({ err: { InstructionError: [1, { Custom: 0 }] } as never });
    const token = randomUUID(); putRecord(rpc, pda, authCommitment(token), 1_000_000n, 1_000_000n);
    const s = signed(req(token, 100)); const r = await engine(rpc).handle(s.raw, s.headers);
    expect(r.status === 200 && r.body.result).not.toBe("APPROVED");
  });
  it("record partially refunded → decline", async () => {
    const rpc = new MockRpc(); rpc.onSend = () => ({ err: { InstructionError: [1, { Custom: 0 }] } as never });
    const token = randomUUID(); putRecord(rpc, pda, authCommitment(token), 1_000_000n, 1n);
    const s = signed(req(token, 100)); const r = await engine(rpc).handle(s.raw, s.headers);
    expect(r.status === 200 && r.body.result).not.toBe("APPROVED");
  });
});

describe("AUDIT L2: webhook-id replay guard", () => {
  it("a repeated webhook-id after completion declines `replay` (no second settle attempt)", async () => {
    const rpc = new MockRpc(); const e = engine(rpc); const token = randomUUID();
    const s = signed(req(token, 100), "msg_fixed_" + randomUUID());
    const r1 = await e.handle(s.raw, s.headers);
    const sent = rpc.sent.length;
    const r2 = await e.handle(s.raw, s.headers);
    expect(r1.status === 200 && r1.body.result).toBe("APPROVED");
    expect(r2.status === 200 && [r2.body.result, r2.decision.reason]).toEqual(["SUSPECTED_FRAUD", "replay"]);
    expect(rpc.sent.length).toBe(sent);
  });
  it("a repeated webhook-id while the first is still in flight gets the same decision", async () => {
    const rpc = new MockRpc(); rpc.confirmAfterMs = 150; const e = engine(rpc);
    const s = signed(req(randomUUID(), 100), "msg_fixed_" + randomUUID());
    const [r1, r2] = await Promise.all([e.handle(s.raw, s.headers), e.handle(s.raw, s.headers)]);
    expect([r1.status === 200 && r1.body.result, r2.status === 200 && r2.body.result]).toEqual(["APPROVED", "APPROVED"]);
  });
});

function reconWorld(lithicStatus: string | null) {
  const rpc = new MockRpc(); const store = new MemoryStore();
  rpc.setAccount(pda, SOLSEND_PROGRAM_ID, encodeCard({ owner, cardId, delegation: cardDelegation(owner, cardId), source: usdcAta(owner) }));
  rpc.setAccount(usdcAta(owner), randomKey(), new Uint8Array(165)); // owner ATA exists
  const deps = { rpc: rpc.asRpc(), settler, store, lithic: { getTransaction: async (t: string) => (lithicStatus ? { token: t, status: lithicStatus } : null), setCardState: async () => {} },
    clock: realClock, blockhash: async () => "11111111111111111111111111111111" };
  return { rpc, store, deps };
}

describe("AUDIT M2/M3: reconcile retries are never lost and never starve the queue", () => {
  it("late VOID on an approved_pending_settlement row whose refund fails is re-queued with backoff (status kept)", async () => {
    const { rpc, store, deps } = reconWorld(null);
    const token = randomUUID(); putRecord(rpc, pda, authCommitment(token), 1_000_000n);
    await store.upsertAuthorization({ lithic_token: token, auth_hash: toHex(authCommitment(token)), card_pda: pda.toBase58(), amount_cents: 100, decision: "APPROVED", reason: "x",
      settle_signature: "s", timings: {}, reconcile_action: "approved_pending_settlement", lithic_final_status: "PENDING" });
    rpc.sendThrows = new Error("429 Too Many Requests");
    const r = await applyTransactionUpdate(deps, { token, status: "VOIDED" }, { rowWaitMs: 0 });
    expect(r.outcome).toBe("error");
    const row = (await store.getAuthorization(token))!;
    expect(row).toMatchObject({ reconcile_action: null, lithic_final_status: "VOIDED", reconcile_attempts: 1 });
    expect(Date.parse(row.next_attempt_at!)).toBeGreaterThan(Date.now());
    expect(row.last_error).toMatch(/429/);
    // once the backoff elapses, the sweep picks it up again
    row.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    expect((await store.listUnreconciled(0, 100)).map((x) => x.lithic_token)).toContain(token);
  });

  it("5 permanently failing refunds no longer starve a later row (backoff moves them behind it)", async () => {
    const { rpc, store, deps } = reconWorld("DECLINED");
    const add = async (iso: string) => { const t = randomUUID(); putRecord(rpc, pda, authCommitment(t), 10_000n);
      await store.upsertAuthorization({ lithic_token: t, auth_hash: toHex(authCommitment(t)), card_pda: pda.toBase58(), amount_cents: 1, decision: "INSUFFICIENT_FUNDS", reason: "x", settle_signature: "s", timings: {}, created_at: iso }); return t; };
    for (let i = 0; i < 5; i++) await add(new Date(Date.now() - 3600_000 + i).toISOString());
    const victim = await add(new Date(Date.now() - 60_000).toISOString());
    (rpc as unknown as { sendRawTransaction: unknown }).sendRawTransaction = async () => { throw new Error("simulation failed: AccountNotInitialized"); };
    const seen: string[] = [];
    for (let round = 0; round < 2; round++) seen.push(...(await sweep(deps, { olderThanSecs: 20, limit: 5 })).map((r) => r.token));
    expect(seen).toContain(victim);
  });

  it("after 8 failed attempts the row is tagged anomaly_refund_failing and leaves the sweep", async () => {
    const { rpc, store, deps } = reconWorld("DECLINED");
    const t = randomUUID(); putRecord(rpc, pda, authCommitment(t), 10_000n);
    await store.upsertAuthorization({ lithic_token: t, auth_hash: toHex(authCommitment(t)), card_pda: pda.toBase58(), amount_cents: 1, decision: "INSUFFICIENT_FUNDS", reason: "x",
      settle_signature: "s", timings: {}, reconcile_attempts: 7 });
    rpc.sendThrows = new Error("blockhash not found");
    await sweep(deps, { olderThanSecs: 0, limit: 5 });
    expect((await store.getAuthorization(t))!.reconcile_action).toBe("anomaly_refund_failing");
    expect(await store.countAuthorizations({ reconcileAction: "anomaly_refund_failing" })).toBe(1);
  });
});
