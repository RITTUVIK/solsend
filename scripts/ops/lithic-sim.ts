// REAL Lithic SANDBOX simulations for W2 end-to-end tests (a handful per session; never load tests).
// The sandbox test PAN is read via GET /v1/cards/{token} INTO MEMORY ONLY for /v1/simulate/authorize;
// it is never printed, logged, stored, or returned. Sandbox host only (enforced in _lib).
//   npx tsx@4.23.15 scripts/ops/lithic-sim.ts authorize --card <lithic card token> --cents 114 [--acceptor SOLSENDDEMOTEMU01] [--descriptor "TEMU (SANDBOX)"]
//   npx tsx@4.23.15 scripts/ops/lithic-sim.ts void --token <lithic transaction token>
//   npx tsx@4.23.15 scripts/ops/lithic-sim.ts txn --token <lithic transaction token>
import { appEnv, lithic, lithicCallsUsed } from "./_lib";

const [cmd, ...args] = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const apiKey = appEnv().get("LITHIC_API_KEY");
if (!apiKey) throw new Error("LITHIC_API_KEY missing");

const summarize = (t: any) => ({ token: t.token, status: t.status, result: t.result, amount: t.amount, events: (t.events ?? []).map((e: any) => ({ type: e.type, result: e.result, amount: e.amount, created: e.created, detailed_results: e.detailed_results })) });

if (cmd === "authorize") {
  const card = opt("card") ?? (() => { throw new Error("--card required"); })();
  const c = await lithic(apiKey, "GET", `/v1/cards/${encodeURIComponent(card)}`);
  let pan: string | null = typeof c.json.pan === "string" ? c.json.pan : null; // memory only
  c.json = null; // drop the card body (contains PAN/CVV) immediately
  if (!pan) throw new Error(`card lookup HTTP ${c.status}: no sandbox PAN`);
  const descriptor = opt("descriptor", "TEMU (SANDBOX)")!;
  if (descriptor.length < 1 || descriptor.length > 25) throw new Error("descriptor must be 1–25 chars (Lithic)");
  const t0 = Date.now();
  const r = await lithic(apiKey, "POST", "/v1/simulate/authorize", { amount: Number(opt("cents", "114")), descriptor, pan, mcc: opt("mcc", "5399"), merchant_acceptor_id: opt("acceptor", "SOLSENDDEMOTEMU01") });
  pan = null;
  console.log(JSON.stringify({ simulate_authorize_http: r.status, transaction_token: r.json.token ?? null, debugging_request_id: r.json.debugging_request_id ?? null, ms: Date.now() - t0, message: r.status >= 300 ? String(r.json.message ?? "").slice(0, 160) : undefined }));
} else if (cmd === "void") {
  const r = await lithic(apiKey, "POST", "/v1/simulate/void", { token: opt("token"), type: "AUTHORIZATION_REVERSAL" });
  console.log(JSON.stringify({ simulate_void_http: r.status, message: r.status >= 300 ? String(r.json.message ?? "").slice(0, 160) : undefined }));
} else if (cmd === "txn") {
  const r = await lithic(apiKey, "GET", `/v1/transactions/${encodeURIComponent(opt("token") ?? "")}`);
  console.log(JSON.stringify({ http: r.status, ...summarize(r.json) }, null, 2));
} else {
  console.log("usage: lithic-sim.ts authorize|void|txn …");
}
console.error(`(Lithic sandbox calls this run: ${lithicCallsUsed()})`);
