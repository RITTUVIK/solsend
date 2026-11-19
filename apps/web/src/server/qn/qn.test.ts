import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store";
import { AUTH_LOOKUP_RETRY_MS, handleQuickNodeWebhook, verifySettlement } from "./handler";
import { signQuickNode, timestampFresh, verifyQuickNodeSignature } from "./verify";

const noSleep = async () => {};

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
  it("unknown auth hash or store without the lookup -> lithic_token null, after ONE retry, with a Stream alert", async () => {
    const store = new MemoryStore();
    const waits: number[] = [];
    await handleQuickNodeWebhook(mkReq(JSON.stringify(payload())), { token: TOKEN, store, sleep: async (ms) => { waits.push(ms); } });
    expect(store.feed[0]!.lithic_token).toBeNull();
    expect(waits).toEqual([AUTH_LOOKUP_RETRY_MS]);
    expect(store.feed[0]!.reason).toMatch(/^Stream alert: no card-network authorization/);
  });
  it("race: the delivery beats the ASA's authorization write -> retried once, then linked and cross-checked", async () => {
    const store = new MemoryStore();
    const row = { lithic_token: "lithic-tok-1", card_pda: CARD, amount_cents: 1, decision: "APPROVED", confirmed_at: new Date(Date.now() - 600).toISOString() };
    let calls = 0;
    (store as any).getAuthorizationByAuthHash = async () => (++calls === 1 ? null : row);
    const ok = await handleQuickNodeWebhook(mkReq(JSON.stringify(payload())), { token: TOKEN, store, sleep: noSleep });
    expect(ok.status).toBe(200);
    expect(calls).toBe(2);
    expect(store.feed[0]).toMatchObject({ lithic_token: "lithic-tok-1", slot: 123 });
    expect(store.feed[0]!.reason).toMatch(/^Amount and card match the card-network authorization · delivered \d+ ms after SolSend confirmed the settle$/);
  });
  it("verifySettlement: exact match with latency; amount/card mismatch, declined and missing authorizations are alerts", () => {
    const ev = { name: "CardSettled", card: CARD, amount: "120000" };
    const auth = { lithic_token: "t", card_pda: CARD, amount_cents: 12, decision: "APPROVED", confirmed_at: "2026-11-19T22:00:00.000Z" };
    const at = Date.parse("2026-11-19T22:00:00.584Z");
    expect(verifySettlement(ev, auth, at)).toBe("Amount and card match the card-network authorization · delivered 584 ms after SolSend confirmed the settle");
    expect(verifySettlement(ev, { ...auth, confirmed_at: null }, at)).toBe("Amount and card match the card-network authorization");
    expect(verifySettlement(ev, { ...auth, amount_cents: 13 }, at)).toMatch(/^Stream alert: the onchain amount differs/);
    expect(verifySettlement(ev, { ...auth, card_pda: OWNER }, at)).toMatch(/^Stream alert: the onchain card differs/);
    expect(verifySettlement(ev, { ...auth, decision: "INSUFFICIENT_FUNDS" }, at)).toMatch(/did not approve/);
    expect(verifySettlement(ev, null, at)).toMatch(/no card-network authorization/);
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
  it("replayed nonce -> acknowledged (2xx, so QuickNode never pauses the stream) but not processed again", async () => {
    const store = new MemoryStore();
    const body = JSON.stringify(payload());
    expect((await handleQuickNodeWebhook(mkReq(body), { token: TOKEN, store, sleep: noSleep })).status).toBe(200);
    store.feed.length = 0;
    const again = await handleQuickNodeWebhook(mkReq(body), { token: TOKEN, store, sleep: noSleep });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(store.feed).toHaveLength(0);
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
