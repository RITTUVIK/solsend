import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store";
import { handleQuickNodeWebhook } from "./handler";
import { signQuickNode, timestampFresh, verifyQuickNodeSignature } from "./verify";

const TOKEN = "unit-test-token-0123456789abcdef";
const SIG = "5".repeat(87);
const CARD = "Gf" + "1".repeat(40);
const OWNER = "Ow" + "2".repeat(40);

const payload = (over: Record<string, unknown> = {}) => ({
  solsend: "v1",
  matches: [{
    signature: SIG, slot: 123, blockTime: 1_800_000_000, success: true,
    events: [{ name: "CardSettled", card: CARD, owner: OWNER, amount: "10000", remainingAllowance: "990000", authHash: "abcd", merchantHash: "cd", totalSettled: "10000", statusAfter: 0 }],
    ...over,
  }],
});

function mkReq(body: string, o: { nonce?: string; ts?: string; token?: string; sig?: string } = {}) {
  const nonce = o.nonce ?? "nonce-1";
  const ts = o.ts ?? String(Math.floor(Date.now() / 1000));
  const sig = o.sig ?? signQuickNode(o.token ?? TOKEN, nonce, ts, body);
  return new Request("http://x/api/quicknode", { method: "POST", body, headers: { "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": sig } });
}

describe("quicknode signature", () => {
  it("accepts a valid signature, rejects tamper / wrong key / malformed", () => {
    const s = signQuickNode(TOKEN, "n", "1", "{}");
    expect(verifyQuickNodeSignature(TOKEN, "n", "1", "{}", s)).toBe(true);
    expect(verifyQuickNodeSignature(TOKEN, "n", "1", "{ }", s)).toBe(false);
    expect(verifyQuickNodeSignature("other-token-0000", "n", "1", "{}", s)).toBe(false);
    expect(verifyQuickNodeSignature(TOKEN, "n", "1", "{}", "zz")).toBe(false);
    expect(verifyQuickNodeSignature(TOKEN, "n", "1", "{}", s.slice(2))).toBe(false);
  });
  it("timestamp window is +-5 min (seconds or ms)", () => {
    const now = 1_800_000_000_000;
    expect(timestampFresh(String(now / 1000), now)).toBe(true);
    expect(timestampFresh(String(now), now)).toBe(true);
    expect(timestampFresh(String(now / 1000 - 301), now)).toBe(false);
    expect(timestampFresh(String(now / 1000 + 301), now)).toBe(false);
    expect(timestampFresh("abc", now)).toBe(false);
  });
});

describe("quicknode webhook handler", () => {
  it("ok -> 200 and writes a quicknode feed row (idempotent on redelivery with a new nonce)", async () => {
    const store = new MemoryStore();
    (store as any).getAuthorizationByAuthHash = async (h: string) => (h === "abcd" ? { lithic_token: "lithic-tok-1" } : null);
    const body = JSON.stringify(payload());
    const r = await handleQuickNodeWebhook(mkReq(body), { token: TOKEN, store });
    expect(r.status).toBe(200);
    expect(store.feed).toHaveLength(1);
    expect(store.feed[0]).toMatchObject({
      source: "quicknode", kind: "settled", signature: SIG, slot: 123, amount_base: "10000", remaining_base: "990000",
      lithic_token: "lithic-tok-1", owner_wallet: OWNER, card_pda: CARD,
    });
    const r2 = await handleQuickNodeWebhook(mkReq(body, { nonce: "nonce-2" }), { token: TOKEN, store });
    expect(r2.status).toBe(200);
    expect(store.feed).toHaveLength(1);
  });
  it("unknown auth hash or store without the lookup -> lithic_token null", async () => {
    const store = new MemoryStore();
    await handleQuickNodeWebhook(mkReq(JSON.stringify(payload())), { token: TOKEN, store });
    expect(store.feed[0]!.lithic_token).toBeNull();
  });
  it("tampered body -> 401, wrong key -> 401, no rows", async () => {
    const store = new MemoryStore();
    const body = JSON.stringify(payload());
    const good = mkReq(body);
    const tampered = new Request(good.url, { method: "POST", body: body.replace("10000", "99999"), headers: good.headers });
    expect((await handleQuickNodeWebhook(tampered, { token: TOKEN, store })).status).toBe(401);
    expect((await handleQuickNodeWebhook(mkReq(body, { token: "attacker-token-0000" }), { token: TOKEN, store })).status).toBe(401);
    expect(store.feed).toHaveLength(0);
  });
  it("stale timestamp -> 401 (signature valid)", async () => {
    const store = new MemoryStore();
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await handleQuickNodeWebhook(mkReq(JSON.stringify(payload()), { ts: old }), { token: TOKEN, store })).status).toBe(401);
  });
  it("replayed nonce -> 409", async () => {
    const store = new MemoryStore();
    const body = JSON.stringify(payload());
    expect((await handleQuickNodeWebhook(mkReq(body), { token: TOKEN, store })).status).toBe(200);
    expect((await handleQuickNodeWebhook(mkReq(body), { token: TOKEN, store })).status).toBe(409);
  });
  it("unsigned payload that is not QnPayload -> 400; unconfigured token -> 503", async () => {
    const store = new MemoryStore();
    expect((await handleQuickNodeWebhook(mkReq(JSON.stringify({ hello: 1 })), { token: TOKEN, store })).status).toBe(400);
    expect((await handleQuickNodeWebhook(mkReq("{}"), { token: undefined, store })).status).toBe(503);
  });
  it("maps all kinds; owner falls back to the cards table; failed tx and ConfigUpdated are skipped", async () => {
    const store = new MemoryStore();
    await store.insertCard({ card_pda: CARD, owner_wallet: OWNER, card_id: "1", kind: "STORE_LOCKED", label: "l", merchant_name: "m", limit_base: "1", period_secs: null, issue_state: "issued", register_signature: null, lithic_card_token: null, lithic_last_four: null, lithic_error: null });
    const ev = (name: string, extra = {}) => ({ name, card: CARD, ...extra });
    const body = JSON.stringify(payload({
            events: [ev("CardRegistered", { owner: OWNER, cardId: "1" }), ev("CardFrozen", { by: OWNER }), ev("CardUnfrozen"), ev("CardClosed"),
        ev("CardRefunded", { owner: OWNER, amount: "5" }), { name: "ConfigUpdated", paused: true, settlementAuthority: OWNER }],
    }));
    await handleQuickNodeWebhook(mkReq(body), { token: TOKEN, store });
    expect(store.feed.map((f) => f.kind).sort()).toEqual(["closed", "frozen", "refunded", "registered", "unfrozen"]);
    expect(store.feed.find((f) => f.kind === "frozen")?.owner_wallet).toBe(OWNER);
    expect(store.feed.find((f) => f.kind === "closed")?.owner_wallet).toBe(OWNER);
    const failed = new MemoryStore();
    await handleQuickNodeWebhook(mkReq(JSON.stringify(payload({ success: false })), { nonce: "n9" }), { token: TOKEN, store: failed });
    expect(failed.feed).toHaveLength(0);
  });
});
