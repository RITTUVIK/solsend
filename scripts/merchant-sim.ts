// Demo Merchant CLI fallback (Option A). LOCAL ONLY, never deployed. Lithic SANDBOX only.
//   tsx scripts/merchant-sim.ts list                              Lithic cards with solsend_* tags (token, last four, tags only)
//   tsx scripts/merchant-sim.ts buy <cardToken> <merchant> <cents>   merchant: TEMU|AMAZON|NETFLIX|OTHER_STORE, 1..5000 cents
//   tsx scripts/merchant-sim.ts void <txToken>
// Credentials are parsed in-process from spikes/.env (override: SOLSEND_ENV_FILE). The PAN is read into memory for the
// simulate call only and is never printed or written; all output passes through a digit-run scrubber.
import { existsSync } from "node:fs";
import { DEMO_MERCHANTS, LITHIC_SANDBOX_BASE } from "../packages/shared/src/index.js";

const ENV_FILE = process.env.SOLSEND_ENV_FILE ?? "/Users/darrendeepak/solsend/spikes/.env";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const KEY = process.env.LITHIC_API_KEY;
const MAX_CENTS = 5000;
const MAX_CALLS = 8;
let calls = 0, lastWrite = 0;

const scrub = (s: string) => s.replace(/\b(?:\d[ -]?){13,19}\b/g, "[redacted]");
const out = (o: unknown) => console.log(scrub(JSON.stringify(o)));
function fail(msg: string): never { console.error(scrub(msg)); process.exit(1); }

async function lithic(method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  if (!KEY) fail(`LITHIC_API_KEY missing (expected in ${ENV_FILE})`);
  if (++calls > MAX_CALLS) fail("refusing: too many real Lithic sandbox calls in one run");
  if (method !== "GET") { const wait = lastWrite + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); lastWrite = Date.now(); }
  const url = LITHIC_SANDBOX_BASE + path; // host is a constant: sandbox only
  const res = await fetch(url, { method, headers: { Authorization: KEY, "content-type": "application/json", accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) fail(`lithic sandbox HTTP ${res.status}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "list") {
    const r = await lithic("GET", "/v1/cards?page_size=50");
    const rows = (r.data ?? []).filter((x: any) => x.tags && Object.keys(x.tags).some((t) => t.startsWith("solsend_")))
      .map((x: any) => ({ token: x.token, last_four: x.last_four, tags: x.tags }));
    return out(rows);
  }
  if (cmd === "buy") {
    const m = DEMO_MERCHANTS[b as keyof typeof DEMO_MERCHANTS];
    const cents = Number(c);
    if (!a || !m || !Number.isInteger(cents) || cents < 1 || cents > MAX_CENTS) fail(`usage: buy <cardToken> <${Object.keys(DEMO_MERCHANTS).join("|")}> <1..${MAX_CENTS} cents>`);
    const getPan = ((pan: string) => () => pan)(String((await lithic("GET", `/v1/cards/${encodeURIComponent(a)}`)).pan ?? ""));
    const t0 = Date.now();
    const r = await lithic("POST", "/v1/simulate/authorize", { amount: cents, descriptor: m.descriptor.slice(0, 25), pan: getPan(), mcc: m.mcc, merchant_acceptor_id: m.acceptorId });
    const tx = r.token as string;
    await new Promise((r) => setTimeout(r, 2500)); // let the ASA path settle + reply
    const t = await lithic("GET", `/v1/transactions/${encodeURIComponent(tx)}`);
    return out({ label: "SANDBOX", txToken: tx, status: t.status, result: t.result, events: (t.events ?? []).map((e: any) => ({ type: e.type, result: e.result, detailed_results: e.detailed_results })), elapsedMs: Date.now() - t0 });
  }
  if (cmd === "void") {
    if (!a) fail("usage: void <txToken>");
    await lithic("POST", "/v1/simulate/void", { token: a, type: "AUTHORIZATION_REVERSAL" });
    const t = await lithic("GET", `/v1/transactions/${encodeURIComponent(a)}`);
    return out({ label: "SANDBOX", txToken: a, status: t.status, note: "USDC returned to your wallet. This card's spending limit stays used. (Refund lands via the reconciler.)" });
  }
  fail("commands: list | buy <cardToken> <merchant> <cents> | void <txToken>");
}
main().catch((e) => fail(e instanceof Error ? e.message : "failed"));
