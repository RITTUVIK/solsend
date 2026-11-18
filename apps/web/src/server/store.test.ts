import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store";

describe("MemoryStore contract", () => {
  it("intents consume once; card CAS; feed idempotent; receipts replay-guarded", async () => {
    const s = new MemoryStore();
    const i = await s.insertIntent({ owner_wallet: "w", kind: "create_card", card_pda: null, message_sha256: "h", expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await s.consumeIntent(i.id)).toBe(true);
    expect(await s.consumeIntent(i.id)).toBe(false);
    await s.insertCard({ card_pda: "c", owner_wallet: "w", card_id: "1", kind: "STORE_LOCKED", label: "Temu", merchant_name: "Temu", limit_base: "1", period_secs: null,
      issue_state: "onchain_confirmed", register_signature: null, lithic_card_token: null, lithic_last_four: null, lithic_error: null });
    expect(await s.updateCard("c", { issue_state: "lithic_pending" }, "onchain_confirmed")).toBe(true);
    expect(await s.updateCard("c", { issue_state: "lithic_pending" }, "onchain_confirmed")).toBe(false);
    const ev = { owner_wallet: "w", card_pda: "c", kind: "settled", amount_base: "1", remaining_base: "0", signature: "s", lithic_token: null, merchant: null, reason: null, source: "quicknode" as const, slot: 1 };
    expect(await s.insertFeedEvent(ev)).toBe(true);
    expect(await s.insertFeedEvent(ev)).toBe(false);
    expect(await s.recordReceipt("quicknode", "n1")).toBe(true);
    expect(await s.recordReceipt("quicknode", "n1")).toBe(false);
    expect(await s.rateLimit("b", 60, 1)).toBe(true);
    expect(await s.rateLimit("b", 60, 1)).toBe(false);
  });
});
