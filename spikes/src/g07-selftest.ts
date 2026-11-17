// G0.7 offline self-test (no QuickNode needed):
//  (a) filter.js against synthetic programs_with_logs + block payloads
//  (b) webhook receiver: valid signature accepted; bad signature, replayed nonce,
//      and stale timestamp rejected.
// Usage: QN_STREAM_SECURITY_TOKEN=<any 32+ chars> G07_PORT=8799 pnpm exec tsx src/g07-selftest.ts
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { SPIKES_DIR } from "./lib/env.js";
import { record } from "./lib/evidence.js";

const VAULT = "HcgWsXyjULsJiuH8Vx5ec7JZr98fa2rjDoricYW6YnVt";
const OUR = "C31ntvRNLT8YuMuqHNkto5Pj3hgkQbCE1YZ4uaent8Zc";
const src = readFileSync(join(SPIKES_DIR, "quicknode/filter.js"), "utf8")
  .replaceAll("__WATCH_ACCOUNTS__", JSON.stringify([VAULT]))
  .replaceAll("__OUR_PROGRAMS__", JSON.stringify([OUR]))
  .replaceAll("__KV_LIST__", "null");
const ctx = vm.createContext({ qnLib: {} });
vm.runInContext(src, ctx);
const main = ctx.main as (s: unknown) => Promise<any>;

const pwl = {
  metadata: { dataset: "programs_with_logs", batch_start_range: 100 },
  data: [[
    { signature: "sigMatch", slot: 100, blockTime: 1, success: true, logs: ["Program data: AAAA"],
      programInvocations: [{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", instruction: { accounts: [{ pubkey: VAULT }, { pubkey: "x" }], data: "4" } }] },
    { signature: "sigNoise", slot: 100, blockTime: 1, success: true, logs: [],
      programInvocations: [{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", instruction: { accounts: [{ pubkey: "other" }], data: "3" } }] },
  ]],
};
const blk = {
  metadata: { dataset: "block", batch_start_range: 200 },
  data: [{ blockTime: 2, transactions: [
    { meta: { err: null, logMessages: [`Program ${OUR} invoke [1]`] }, transaction: { signatures: ["sigOurs"], message: { accountKeys: [{ pubkey: "a" }], instructions: [] } } },
    { meta: { err: null, logMessages: [] }, transaction: { signatures: ["sigOther"], message: { accountKeys: [{ pubkey: "b" }], instructions: [] } } },
  ] }],
};
const r1 = await main(pwl);
const r2 = await main(blk);
const r3 = await main({ metadata: {}, data: [[]] });
const filterOk =
  r1?.matches?.length === 1 && r1.matches[0].signature === "sigMatch" && r1.matches[0].splOps?.[0]?.op === "Transfer" &&
  r2?.matches?.length === 1 && r2.matches[0].signature === "sigOurs" && r2.matches[0].slot === 200 && r3 === null;
record("g07", filterOk ? "selftest_filter_PASS" : "selftest_filter_FAIL", { programs_with_logs: r1, block: r2, empty: r3 });

// (b) webhook receiver
const token = process.env.QN_STREAM_SECURITY_TOKEN!;
const port = Number(process.env.G07_PORT ?? 8799);
const server = spawn("pnpm", ["exec", "tsx", "src/g07-webhook-server.ts"], { cwd: SPIKES_DIR, env: { ...process.env, G07_PORT: String(port) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

async function post(body: string, { nonce = randomUUID(), ts = String(Math.floor(Date.now() / 1000)), key = token } = {}) {
  const sig = createHmac("sha256", Buffer.from(key)).update(Buffer.from(nonce + ts + body)).digest("hex");
  const res = await fetch(`http://127.0.0.1:${port}/webhooks/quicknode`, {
    method: "POST", headers: { "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": sig, "content-type": "application/json" }, body,
  });
  return res.status;
}
const body = JSON.stringify(r1);
const fixedNonce = randomUUID();
const results = {
  valid: await post(body, { nonce: fixedNonce }),
  replayed_nonce: await post(body, { nonce: fixedNonce }),
  wrong_key: await post(body, { key: "not-the-token-not-the-token-xxxx" }),
  stale_timestamp: await post(body, { ts: String(Math.floor(Date.now() / 1000) - 3600) }),
};
server.kill();
const webhookOk = results.valid === 200 && results.replayed_nonce === 409 && results.wrong_key === 401 && results.stale_timestamp === 401;
record("g07", webhookOk ? "selftest_webhook_PASS" : "selftest_webhook_FAIL", { http_status: results });
process.exit(filterOk && webhookOk ? 0 : 1);
