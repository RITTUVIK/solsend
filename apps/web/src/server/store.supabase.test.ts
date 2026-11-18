// Live integration test of SupabaseStore against the real project (opt-in: SUPABASE_IT=1). Uses the server's
// sb_secret_ key exactly as production does; cleans up every row it creates. Never prints credentials.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseStore } from "./store";

const run = process.env.SUPABASE_IT === "1";
const env = run ? Object.fromEntries(readFileSync(new URL("../../../../spikes/.env", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])) : {};
const sb = run ? createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const tag = `it-${Date.now()}`;

describe.runIf(run)("SupabaseStore (live, sb_secret_ key)", () => {
  const s = new SupabaseStore(sb!);
  afterAll(async () => {
    await sb!.from("feed_events").delete().like("card_pda", `${tag}%`);
    await sb!.from("authorizations").delete().like("lithic_token", `${tag}%`);
    await sb!.from("cards").delete().like("card_pda", `${tag}%`);
    await sb!.from("tx_intents").delete().eq("owner_wallet", tag);
    await sb!.from("users").delete().like("privy_user_id", `${tag}%`);
    await sb!.from("webhook_receipts").delete().like("receipt_id", `${tag}%`);
    await sb!.from("rate_limits").delete().like("bucket", `${tag}%`);
  });
  it("users, cards CAS, intents atomic consume, authorizations update-first upsert + auth_hash lookup, feed dedupe, receipts, rate limit", async () => {
    const u = await s.upsertUser(`${tag}-privy`, `${tag}-wallet`);
    expect((await s.getUserByPrivyId(`${tag}-privy`))?.id).toBe(u.id);

    await s.insertCard({ card_pda: `${tag}-card`, owner_wallet: tag, card_id: "1", kind: "STORE_LOCKED", label: "it", merchant_name: "Temu", limit_base: "1",
      period_secs: null, issue_state: "onchain_confirmed", register_signature: null, lithic_card_token: null, lithic_last_four: null, lithic_error: null });
    expect(await s.updateCard(`${tag}-card`, { issue_state: "lithic_pending" }, "onchain_confirmed")).toBe(true);
    expect(await s.updateCard(`${tag}-card`, { issue_state: "lithic_pending" }, "onchain_confirmed")).toBe(false); // CAS lost

    const i = await s.insertIntent({ owner_wallet: tag, kind: "it", card_pda: null, message_sha256: "x", expires_at: new Date(Date.now() + 60_000).toISOString() });
    const [a, b] = await Promise.all([s.consumeIntent(i.id), s.consumeIntent(i.id)]);
    expect([a, b].filter(Boolean).length).toBe(1);                       // exactly one concurrent consumer wins
    const expired = await s.insertIntent({ owner_wallet: tag, kind: "it", card_pda: null, message_sha256: "y", expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await s.consumeIntent(expired.id)).toBe(false);

    const h = "ab".repeat(32);
    await s.upsertAuthorization({ lithic_token: `${tag}-auth`, auth_hash: h, card_pda: `${tag}-card`, amount_cents: 37, decision: "PENDING" });
    await s.upsertAuthorization({ lithic_token: `${tag}-auth`, decision: "APPROVED", reason: "settled_confirmed" }); // partial patch
    const row = await s.getAuthorizationByAuthHash(h);
    expect(row?.decision).toBe("APPROVED");
    expect(row?.amount_cents).toBe(37);

    const ev = { owner_wallet: tag, card_pda: `${tag}-card`, kind: "settled", amount_base: "1", remaining_base: "0", signature: `${tag}-sig`, lithic_token: `${tag}-auth`, merchant: null, reason: null, source: "quicknode" as const, slot: 1 };
    expect(await s.insertFeedEvent(ev)).toBe(true);
    expect(await s.insertFeedEvent(ev)).toBe(false);                    // unique index dedupe
    expect((await s.listFeed({ ownerWallet: tag })).length).toBe(1);

    expect(await s.recordReceipt("quicknode", `${tag}-n1`)).toBe(true);
    expect(await s.recordReceipt("quicknode", `${tag}-n1`)).toBe(false); // replay guard
    expect(await s.rateLimit(`${tag}-b`, 60, 2)).toBe(true);
    expect(await s.rateLimit(`${tag}-b`, 60, 2)).toBe(true);
    expect(await s.rateLimit(`${tag}-b`, 60, 2)).toBe(false);            // SECURITY DEFINER fn works for service_role
  });
});
