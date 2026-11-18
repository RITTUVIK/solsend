// G0.7 — run a filter through QuickNode's test_filter API against a specific devnet slot.
// Usage: pnpm exec tsx src/g07-test-filter.ts <filter.js> <slot> [dataset]
import { readFileSync } from "node:fs";
import { env } from "./lib/env.js";
import { record } from "./lib/evidence.js";
const [file, slot, dataset = "programs_with_logs"] = process.argv.slice(2);
const res = await fetch("https://api.quicknode.com/streams/rest/v1/streams/test_filter", {
  method: "POST",
  headers: { "x-api-key": env("QUICKNODE_API_KEY"), "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ network: "solana-devnet", dataset, filter_function: Buffer.from(readFileSync(file!, "utf8")).toString("base64"), block: String(slot) }),
});
const body: any = await res.json().catch(async () => ({ raw: (await res.text()).slice(0, 500) }));
let result: unknown = body.result;
try { result = typeof body.result === "string" ? JSON.parse(body.result) : body.result; } catch { /* keep string */ }
record("g07", "test_filter", { http: res.status, filter: file, slot, dataset, logs: body.logs ?? null, result, error: res.ok ? null : body });
process.exit(0);
