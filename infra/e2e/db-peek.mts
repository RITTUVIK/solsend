// LEAD. Read-only view of what the deployed backend persisted for one Lithic token (no secrets in output).
// Usage: npx tsx infra/e2e/db-peek.mts <lithicToken> [--since <iso>]
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { createClient } = createRequire(path.join(root, "apps/web/package.json"))("@supabase/supabase-js");
const env = Object.fromEntries(readFileSync(path.join(root, "spikes/.env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const token = process.argv[2]!;
const { data: a } = await sb.from("authorizations").select("lithic_token,decision,reason,settle_signature,confirmed_at,replied_at,timings,lithic_final_status,reconcile_action,refund_signature,card_pda,created_at,updated_at").eq("lithic_token", token).maybeSingle();
console.log("authorization:", JSON.stringify(a));
const cardPda = a?.card_pda;
const { data: f } = await sb.from("feed_events").select("kind,source,amount_base,remaining_base,signature,lithic_token,reason,slot,at").eq("card_pda", cardPda ?? "-").order("at", { ascending: false }).limit(8);
console.log("feed (card, newest first):"); for (const r of f ?? []) console.log("  ", JSON.stringify(r));
const { data: rc } = await sb.from("webhook_receipts").select("provider,received_at").order("received_at", { ascending: false }).limit(6);
console.log("recent webhook receipts:", JSON.stringify(rc));
