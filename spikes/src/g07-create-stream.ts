// G0.7 — create a QuickNode Stream on Solana devnet with our filter → webhook.
// Usage: pnpm g07:stream [--test-slot <slot>] [--dataset programs_with_logs|block] [--dry-run]
// Webhook URL: QN_WEBHOOK_PUBLIC_URL, or auto-discovered from a local ngrok agent.
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SPIKES_DIR, SPIKE_PROGRAM_ID, env, optEnv } from "./lib/env.js";
import { record, saveState, stateStr } from "./lib/evidence.js";
import { loadKeypair, usdcAta } from "./lib/solana.js";

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const dataset = arg("--dataset") ?? optEnv("QN_DATASET") ?? "programs_with_logs";
const API = "https://api.quicknode.com/streams/rest/v1";
const apiKey = env("QUICKNODE_API_KEY");

let token = optEnv("QN_STREAM_SECURITY_TOKEN");
if (!token) {
  token = randomBytes(32).toString("hex");
  appendFileSync(join(SPIKES_DIR, ".env"), `\nQN_STREAM_SECURITY_TOKEN=${token}\n`);
  console.log("Generated QN_STREAM_SECURITY_TOKEN and appended it to spikes/.env (gitignored). Restart g07:webhook.");
}

let webhookBase = optEnv("QN_WEBHOOK_PUBLIC_URL");
if (!webhookBase) {
  try {
    const t = (await (await fetch("http://127.0.0.1:4040/api/tunnels")).json()) as { tunnels: { public_url: string }[] };
    webhookBase = t.tunnels.find((x) => x.public_url.startsWith("https://"))?.public_url;
  } catch { /* no ngrok agent */ }
}
if (!webhookBase) throw new Error("No webhook URL: set QN_WEBHOOK_PUBLIC_URL or run `ngrok http 8787`.");
const webhookUrl = `${webhookBase.replace(/\/$/, "")}/webhooks/quicknode`;

const owner = loadKeypair("card-a-owner").publicKey;
const watch = [usdcAta(owner).toBase58(), owner.toBase58(), stateStr("cardBVault"), stateStr("cardBPda")].filter(Boolean) as string[];
const filterSrc = readFileSync(join(SPIKES_DIR, "quicknode/filter.js"), "utf8")
  .replaceAll("__WATCH_ACCOUNTS__", JSON.stringify(watch))
  .replaceAll("__OUR_PROGRAMS__", JSON.stringify([SPIKE_PROGRAM_ID]))
  .replaceAll("__KV_LIST__", JSON.stringify(optEnv("QN_KV_LIST") ?? null));
const filterB64 = Buffer.from(filterSrc).toString("base64");

async function qn(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 1000) }; }
  return { status: res.status, json };
}

const testSlot = arg("--test-slot");
if (testSlot) {
  const t = await qn("POST", "/streams/test_filter", { network: "solana-devnet", dataset, filter_function: filterB64, block: testSlot });
  record("g07", "test_filter", { slot: testSlot, dataset, status: t.status, result_preview: String(t.json?.result ?? "").slice(0, 800), logs: t.json?.logs ?? null });
}
if (process.argv.includes("--dry-run")) process.exit(0);

const body = (batch: number) => ({
  name: "solsend-g0-devnet",
  network: "solana-devnet",
  dataset,
  filter_function: filterB64,
  filter_language: "javascript",
  region: "usa_east",
  dataset_batch_size: batch,
  keep_distance_from_tip: 0,
  fix_block_reorgs: 0,
  destination: "webhook",
  status: "active",
  destination_attributes: {
    url: webhookUrl, compression: "none", headers: {}, max_retry: 3, retry_interval_sec: 1, post_timeout_sec: 10, security_token: token,
  },
});
let r = await qn("POST", "/streams", body(Number(optEnv("QN_BATCH_SIZE") ?? 1)));
if (r.status === 422) r = await qn("POST", "/streams", body(5)); // sub-second chains may require batch >= 5
record("g07", r.status < 300 ? "stream_created" : "stream_create_error", {
  status: r.status, stream_id: r.json?.id ?? null, dataset, webhook_host: new URL(webhookUrl).host,
  watched_accounts: watch, batch_size: r.json?.dataset_batch_size ?? null, error: r.status >= 300 ? r.json : undefined,
});
if (r.json?.id) saveState({ qnStreamId: r.json.id });
