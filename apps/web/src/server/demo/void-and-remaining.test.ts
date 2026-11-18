import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store";
import { demoCheckout, demoVoid, type DemoDeps } from "./checkout";
import { sendWithBlockhashRetry } from "../tx/submit";
import { HttpError } from "../auth";

const W = "FB5ovrafjpVcnEfDkPckDTwu6pxnn8eUzU7SuguLQH6P", PDA = "9qmwDRAtfVzdRLLQGTcbMvEvRhQHMhw62qhRcUMWGxQC";
async function seed(s: MemoryStore, decision = "APPROVED", refund: string | null = null) {
  await s.insertCard({ card_pda: PDA, owner_wallet: W, card_id: "4617311161562321217", kind: "STORE_LOCKED", label: "Temu Test Card", merchant_name: "Temu",
    limit_base: "5000000", period_secs: null, issue_state: "issued", register_signature: null, lithic_card_token: "lc", lithic_last_four: "1234", lithic_error: null });
  await s.upsertAuthorization({ lithic_token: "tok", auth_hash: "ab".repeat(32), card_pda: PDA, amount_cents: 114, decision, refund_signature: refund });
}
function deps(s: MemoryStore, sim: Partial<DemoDeps["sim"]> & { calls?: string[] }, extra: Partial<DemoDeps> = {}): DemoDeps {
  const calls = sim.calls ?? [];
  return {
    store: s, wallet: W, enabled: true, maxCents: 5000, pollMs: 0, sleep: async () => {},
    sim: {
      authorize: async () => { calls.push("authorize"); return "tok2"; },
      voidTransaction: async (t: string) => { calls.push(`void:${t}`); },
      transaction: async () => ({ token: "tok", status: "PENDING", result: "APPROVED" }) as never,
      ...sim,
    } as DemoDeps["sim"],
    ...extra,
  };
}
const REFUND = "5eNWPKCdzgjYZAheB8hUTtasQBST8JAyftd3baGzBN72Rdy6hSd4ucod5GxbzT7Pb9GmimxehrRE7WnLX4NkTjR9";

describe("demo void is idempotent and state-checked (user report: void after navigating away)", () => {
  it("first void calls Lithic once; a double click within 60 s does NOT issue a second Lithic void", async () => {
    const s = new MemoryStore(); await seed(s); const calls: string[] = [];
    await demoVoid({ lithicToken: "tok" }, deps(s, { calls }));
    await demoVoid({ lithicToken: "tok" }, deps(s, { calls }));
    expect(calls.filter((c) => c.startsWith("void:"))).toEqual(["void:tok"]);
  });
  it("already refunded → returns the existing refund, no Lithic call at all", async () => {
    const s = new MemoryStore(); await seed(s, "APPROVED", REFUND); const calls: string[] = [];
    const r = await demoVoid({ lithicToken: "tok" }, deps(s, { calls, transaction: async () => { calls.push("txn"); return null; } }));
    expect(r.refundSignature).toBe(REFUND);
    expect(calls).toEqual([]);
  });
  it("Lithic already VOIDED → no second void (reconciler refunds)", async () => {
    const s = new MemoryStore(); await seed(s); const calls: string[] = [];
    await demoVoid({ lithicToken: "tok" }, deps(s, { calls, transaction: async () => ({ token: "tok", status: "VOIDED", result: "APPROVED" }) as never }));
    expect(calls.some((c) => c.startsWith("void:"))).toBe(false);
  });
  it("declined purchase → 409 not_voidable; settled → 409 not_voidable; someone else's → 404", async () => {
    const s1 = new MemoryStore(); await seed(s1, "INSUFFICIENT_FUNDS");
    await expect(demoVoid({ lithicToken: "tok" }, deps(s1, {}))).rejects.toMatchObject({ status: 409, code: "not_voidable" });
    const s2 = new MemoryStore(); await seed(s2);
    await expect(demoVoid({ lithicToken: "tok" }, deps(s2, { transaction: async () => ({ token: "tok", status: "SETTLED", result: "APPROVED" }) as never })))
      .rejects.toMatchObject({ status: 409, code: "not_voidable" });
    const s3 = new MemoryStore(); await seed(s3);
    await expect(demoVoid({ lithicToken: "tok" }, { ...deps(s3, {}), wallet: "SomeoneElse1111111111111111111111111111111" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("checkout returns the remaining limit read ONCHAIN (approvals and declines)", () => {
  it("uses remainingOnchain even when the feed has no QuickNode row (stream paused)", async () => {
    const s = new MemoryStore(); await seed(s);
    await s.upsertAuthorization({ lithic_token: "tok2", auth_hash: "cd".repeat(32), card_pda: PDA, amount_cents: 400, decision: "INSUFFICIENT_FUNDS", reason: "Over this card's limit (Allowances 300)" });
    const r = await demoCheckout({ cardPda: PDA, merchant: "TEMU", amountCents: 400 }, deps(s, {}, { remainingOnchain: async () => "3860000" }));
    expect(r.decision).toBe("DECLINED");
    expect(r.remainingBase).toBe("3860000");
  });
});

describe("submit: blockhash retry vs tx_expired (user report: first wallet setup 'Blockhash not found')", () => {
  it("transient node lag → retried and succeeds", async () => {
    let n = 0;
    await sendWithBlockhashRetry({ sendRawTransaction: async () => { if (++n < 2) throw new Error("Transaction simulation failed: Blockhash not found"); return "sig"; } } as never, new Uint8Array(1), async () => {});
    expect(n).toBe(2);
  });
  it("expired blockhash → 409 tx_expired (client re-prepares and re-signs once)", async () => {
    const p = sendWithBlockhashRetry({ sendRawTransaction: async () => { throw new Error("Transaction simulation failed: Blockhash not found"); } } as never, new Uint8Array(1), async () => {});
    await expect(p).rejects.toBeInstanceOf(HttpError);
    await expect(p).rejects.toMatchObject({ status: 409, code: "tx_expired" });
  });
  it("other preflight failures stay 400 tx_rejected (no retry)", async () => {
    let n = 0;
    const p = sendWithBlockhashRetry({ sendRawTransaction: async () => { n++; throw new Error("custom program error: 0x1"); } } as never, new Uint8Array(1), async () => {});
    await expect(p).rejects.toMatchObject({ status: 400, code: "tx_rejected" });
    expect(n).toBe(1);
  });
});
