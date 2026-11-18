// Points Lithic SANDBOX at a SolSend deployment (ngrok static domain or Vercel):
//   1. ASA responder endpoint → <url>/api/lithic/asa   (GET status → DELETE if enrolled → POST)
//   2. event subscription `card_transaction.updated` → <url>/api/lithic/events (PATCH existing or POST),
//      then writes its whsec_ secret to apps/web/.env.local as LITHIC_EVENTS_SECRET (never printed)
//   3. account-level daily_spend_limit = 50000 cents (amendment 4; reports if the sandbox rejects/ignores it)
// Usage:
//   npx tsx@4.23.15 scripts/ops/lithic-setup.ts --url https://<host>
//   npx tsx@4.23.15 scripts/ops/lithic-setup.ts --disenroll      (stop Lithic calling a dead tunnel)
//   npx tsx@4.23.15 scripts/ops/lithic-setup.ts --status
import { SPIKES_ENV, GEN_ENV, appEnv, lithic, lithicCallsUsed, upsertEnvFile, writeEnvLocal } from "./_lib";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const apiKey = appEnv().get("LITHIC_API_KEY");
if (!apiKey) throw new Error("LITHIC_API_KEY missing (run make-env-local first)");

const status = await lithic(apiKey, "GET", "/v1/responder_endpoints?type=AUTH_STREAM_ACCESS");
console.log(`ASA responder: HTTP ${status.status} enrolled=${String(status.json.enrolled ?? "?")}`);
if (flag("status")) process.exit(0);

if (flag("disenroll")) {
  const d = await lithic(apiKey, "DELETE", "/v1/responder_endpoints?type=AUTH_STREAM_ACCESS");
  console.log(`ASA disenroll: HTTP ${d.status}`);
  process.exit(d.status < 300 ? 0 : 1);
}

const base = (opt("url") ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(base)) throw new Error("--url https://<host> required (https origin, no path)");
const host = new URL(base).host;

// 1. ASA endpoint
if (status.json.enrolled) {
  const d = await lithic(apiKey, "DELETE", "/v1/responder_endpoints?type=AUTH_STREAM_ACCESS");
  console.log(`ASA previous endpoint removed: HTTP ${d.status}`);
}
const enroll = await lithic(apiKey, "POST", "/v1/responder_endpoints", { type: "AUTH_STREAM_ACCESS", url: `${base}/api/lithic/asa` });
console.log(`ASA enroll → https://${host}/api/lithic/asa: HTTP ${enroll.status}${enroll.status >= 300 ? ` ${String(enroll.json.message ?? "").slice(0, 120)}` : ""}`);

// 2. events subscription
const eventsUrl = `${base}/api/lithic/events`;
const list = await lithic(apiKey, "GET", "/v1/event_subscriptions?page_size=50");
const subs: { token: string; url: string; event_types?: string[] | null; description?: string }[] = list.json.data ?? [];
const mine = subs.find((s) => (s.description ?? "").startsWith("SolSend")) ?? subs.find((s) => s.event_types?.includes("card_transaction.updated"));
let subToken: string | undefined;
if (mine) {
  const p = await lithic(apiKey, "PATCH", `/v1/event_subscriptions/${mine.token}`, { url: eventsUrl, event_types: ["card_transaction.updated"], description: "SolSend reconciler (sandbox)", disabled: false });
  console.log(`events subscription ${mine.token} updated → https://${host}/api/lithic/events: HTTP ${p.status}`);
  subToken = mine.token;
} else {
  const c = await lithic(apiKey, "POST", "/v1/event_subscriptions", { url: eventsUrl, event_types: ["card_transaction.updated"], description: "SolSend reconciler (sandbox)" });
  console.log(`events subscription created → https://${host}/api/lithic/events: HTTP ${c.status}${c.status >= 300 ? ` ${String(c.json.message ?? "").slice(0, 120)}` : ` token=${c.json.token}`}`);
  subToken = c.json.token;
}
if (subToken) {
  const s = await lithic(apiKey, "GET", `/v1/event_subscriptions/${subToken}/secret`);
  const key = s.json.key ?? s.json.secret;
  if (typeof key === "string" && key.startsWith("whsec_")) {
    console.log(`wrote ${writeEnvLocal(new Map([["LITHIC_EVENTS_SECRET", key]])).join(", ")} to apps/web/.env.local (value not printed)`);
    // Lead's env-sync pushes spikes/.env.generated to Vercel: store it there (mode 600, never printed, never hand-edited).
    upsertEnvFile(GEN_ENV, "LITHIC_EVENTS_SECRET", key);
    console.log(`wrote LITHIC_EVENTS_SECRET to ${GEN_ENV} (mode 600, value not printed)`);
  }
  else console.log(`events secret fetch: HTTP ${s.status} (no whsec_ key)`);
}

// 3. account-level circuit breaker
if (!flag("skip-account-limit")) {
  const accts = await lithic(apiKey, "GET", "/v1/accounts?page_size=5");
  const acct = (accts.json.data ?? [])[0] as { token: string } | undefined;
  if (!acct) console.log(`account limit: no account visible (HTTP ${accts.status})`);
  else {
    const p = await lithic(apiKey, "PATCH", `/v1/accounts/${acct.token}`, { daily_spend_limit: 50_000 });
    const lim = p.json.spend_limit ?? {};
    console.log(`account ${acct.token} daily_spend_limit=50000 → HTTP ${p.status}; account now reports spend_limit=${JSON.stringify(lim)}${p.status >= 300 ? ` (${String(p.json.message ?? "").slice(0, 120)})` : ""}`);
  }
}
console.log(`Lithic sandbox calls used: ${lithicCallsUsed()}`);
