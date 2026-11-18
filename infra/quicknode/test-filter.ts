// Runs filter.dist.js on QuickNode's own sandbox against one real devnet block (POST /streams/test_filter).
// Usage: tsx infra/quicknode/test-filter.ts <slot>   (one block; no stream needed; prints a result preview only)
import { existsSync } from "node:fs";
import { buildFilterSource } from "./build-filter.js";

const ENV_FILE = process.env.SOLSEND_ENV_FILE ?? "/Users/darrendeepak/solsend/spikes/.env";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const slot = process.argv[2];
if (!slot || !process.env.QUICKNODE_API_KEY) { console.error("usage: test-filter <slot> (QUICKNODE_API_KEY in spikes/.env)"); process.exit(2); }

async function main() {
const res = await fetch("https://api.quicknode.com/streams/rest/v1/streams/test_filter", {
  method: "POST",
  headers: { "x-api-key": process.env.QUICKNODE_API_KEY ?? "", "content-type": "application/json" },
  body: JSON.stringify({ network: "solana-devnet", dataset: "programs_with_logs", filter_function: Buffer.from(buildFilterSource()).toString("base64"), block: slot }),
});
const j = (await res.json().catch(() => ({}))) as { result?: unknown; logs?: unknown; error?: unknown; message?: unknown };
console.log(JSON.stringify({ http: res.status, result: String(JSON.stringify(j.result ?? null)).slice(0, 400), logs: j.logs ?? null, error: j.error ?? j.message ?? null }));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "failed"); process.exit(1); });
