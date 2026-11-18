// QuickNode Streams control CLI (devnet, free trial, ONE Solana stream). Keep the stream PAUSED outside test/demo windows:
// billing is per processed block. Secrets (API key, stream token, webhook URL) are never printed.
//
//   tsx infra/quicknode/stream.ts create <webhookUrl>   create PAUSED stream "solsend-mvp-devnet", fresh token -> spikes/.env
//   tsx infra/quicknode/stream.ts get [id]              status summary (no URLs/tokens)
//   tsx infra/quicknode/stream.ts pause|activate [id]
//   tsx infra/quicknode/stream.ts set-filter [id]       re-upload filter.dist.js (rebuilt from the IDL)
//   tsx infra/quicknode/stream.ts set-url <webhookUrl> [id]
//   tsx infra/quicknode/stream.ts delete [id]           (default: our named stream)
//   tsx infra/quicknode/stream.ts list                  id/name/status of every stream on the account
//   tsx infra/quicknode/stream.ts usage                 best-effort credit usage (REST), reports if unavailable
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildFilterSource } from "./build-filter.js";

export const STREAM_NAME = "solsend-mvp-devnet";
const API = "https://api.quicknode.com/streams/rest/v1";
/** Repo root: nearest ancestor of the working directory holding pnpm-workspace.yaml (scripts run from root or scripts/). */
const REPO_ROOT = (() => { let d = resolve(process.cwd()); while (!existsSync(join(d, "pnpm-workspace.yaml")) && dirname(d) !== d) d = dirname(d); return d; })();
const ENV_FILE = process.env.SOLSEND_ENV_FILE ?? join(REPO_ROOT, "spikes", ".env");
const GEN_FILE = process.env.SOLSEND_GEN_ENV ?? join(REPO_ROOT, "spikes", ".env.generated"); // fresh stream tokens go here

/** Parse KEY=VALUE lines into process.env (without overriding). Never prints values. */
function loadEnv(): void {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  if (existsSync(GEN_FILE)) process.loadEnvFile(GEN_FILE);
}
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} (expected in ${ENV_FILE})`);
  return v;
}

/** Rewrite (or append) KEY=value in the MACHINE-GENERATED env file (spikes/.env.generated), mode 600. Never writes the
 *  hand-edited spikes/.env: an editor saving a stale buffer there silently dropped generated secrets twice. */
function setEnvVar(key: string, value: string): void {
  const ENV_FILE = GEN_FILE;
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else { while (lines.length && lines[lines.length - 1] === "") lines.pop(); lines.push(`${key}=${value}`, ""); }
  writeFileSync(ENV_FILE, lines.join("\n"), { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}

async function qn(method: string, path: string, body?: unknown, base = API): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-api-key": need("QUICKNODE_API_KEY"), "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

const list = async (): Promise<any[]> => {
  const r = await qn("GET", "/streams?limit=50");
  if (r.status >= 300) throw new Error(`list streams failed: HTTP ${r.status}`);
  return Array.isArray(r.json) ? r.json : r.json?.data ?? [];
};
const ours = async () => (await list()).find((s) => s.name === STREAM_NAME);
async function resolveId(arg?: string): Promise<string> {
  if (arg && /^[0-9a-f-]{36}$/.test(arg)) return arg;
  const s = await ours();
  if (!s) throw new Error(`no stream named ${STREAM_NAME}`);
  return s.id;
}
/** Safe summary: never includes destination URL / headers / security token. */
const summary = (s: any) => ({
  id: s?.id, name: s?.name, status: s?.status, network: s?.network, dataset: s?.dataset, batch: s?.dataset_batch_size,
  start_range: s?.start_range ?? null, current_range: s?.current_range ?? s?.last_processed_block ?? null, updated_at: s?.updated_at ?? null,
});
const show = (o: unknown) => console.log(JSON.stringify(o));

function destination(url: string, token: string) {
  if (!/^https:\/\//.test(url)) throw new Error("webhook URL must be https");
  return { url, compression: "none", headers: {}, max_retry: 3, retry_interval_sec: 1, post_timeout_sec: 10, security_token: token };
}

async function pause(id: string) {
  let r = await qn("POST", `/streams/${id}/pause`);
  if (r.status >= 300) r = await qn("PATCH", `/streams/${id}`, { status: "paused" });
  return r;
}
/** Current devnet slot (RPC URL from env; never printed). */
async function latestSlot(): Promise<number> {
  const res = await fetch(need("SOLANA_RPC_URL"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "confirmed" }] }) });
  const j = (await res.json()) as { result?: number };
  if (typeof j.result !== "number") throw new Error("could not read the latest slot");
  return j.result;
}
async function activate(id: string) {
  // A paused stream resumes from its stored start_range: move it to the tip first, otherwise activation would
  // replay (and bill for) every block since the stream was created. Verified: PATCH start_range works while paused.
  const p = await qn("PATCH", `/streams/${id}`, { start_range: await latestSlot() });
  if (p.status >= 300) throw new Error(`could not move start_range to latest (HTTP ${p.status}); refusing to activate`);
  let r = await qn("POST", `/streams/${id}/activate`);
  if (r.status >= 300) r = await qn("PATCH", `/streams/${id}`, { status: "active" });
  return r;
}

async function usage() {
  // The Streams-scoped key returned 403 on the console usage API in CP0b; try the documented REST variants and report.
  const attempts: [string, string][] = [
    ["https://api.quicknode.com/v0/usage/rpc", "console usage (rpc)"],
    ["https://api.quicknode.com/v0/usage/rpc/by-chain", "console usage by chain"],
    ["https://api.quicknode.com/v0/usage/rpc/by-endpoint", "console usage by endpoint"],
  ];
  for (const [url, label] of attempts) {
    const r = await qn("GET", "", undefined, url);
    const nums = r.status === 200 ? JSON.stringify(r.json, (k, v) => (k === "name" || /url|token|key|endpoint/i.test(k) ? undefined : v)).slice(0, 600) : undefined;
    show({ source: label, http: r.status, credits: nums ?? null });
  }
  const s = await ours();
  if (s) show({ source: "stream object", stream: summary(s), numeric_fields: Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "number")) });
}

async function main() {
  loadEnv();
  const [cmd, a1, a2] = process.argv.slice(2);
  switch (cmd) {
    case "list": return show((await list()).map(summary));
    case "get": { const r = await qn("GET", `/streams/${await resolveId(a1)}`); return show({ http: r.status, ...summary(r.json) }); }
    case "pause": { const id = await resolveId(a1); const r = await pause(id); return show({ http: r.status, ...summary((await qn("GET", `/streams/${id}`)).json) }); }
    case "activate": { const id = await resolveId(a1); const r = await activate(id); return show({ http: r.status, ...summary((await qn("GET", `/streams/${id}`)).json) }); }
    case "delete": { const id = await resolveId(a1); const r = await qn("DELETE", `/streams/${id}`); return show({ http: r.status, deleted: id }); }
    case "usage": return usage();
    case "set-filter": { // push the freshly generated filter to an existing stream
      const id = await resolveId(a1);
      const r = await qn("PATCH", `/streams/${id}`, { filter_function: Buffer.from(buildFilterSource()).toString("base64"), filter_language: "javascript" });
      return show({ http: r.status, ...summary((await qn("GET", `/streams/${id}`)).json) });
    }
    case "set-url": {
      if (!a1) throw new Error("usage: set-url <webhookUrl> [id]");
      const id = await resolveId(a2);
      const r = await qn("PATCH", `/streams/${id}`, { destination_attributes: destination(a1, need("QN_STREAM_SECURITY_TOKEN")) });
      return show({ http: r.status, ...summary((await qn("GET", `/streams/${id}`)).json) });
    }
    case "create": {
      if (!a1) throw new Error("usage: create <webhookUrl>");
      const existing = await list();
      if (existing.some((s) => s.name === STREAM_NAME)) throw new Error(`${STREAM_NAME} already exists (use set-url / delete)`);
      if (existing.length >= 1) throw new Error(`trial allows 1 Solana stream; delete first: ${existing.map((s) => `${s.id} (${s.status})`).join(", ")}`);
      const token = randomBytes(32).toString("hex");
      setEnvVar("QN_STREAM_SECURITY_TOKEN", token); // stored, never printed
      process.env.QN_STREAM_SECURITY_TOKEN = token;
      const body = {
        name: STREAM_NAME, network: "solana-devnet", dataset: "programs_with_logs",
        filter_function: Buffer.from(buildFilterSource()).toString("base64"), filter_language: "javascript",
        region: "usa_east", dataset_batch_size: 1, elastic_batch_enabled: false, external_id: "solsend-mvp-devnet",
        keep_distance_from_tip: 0, fix_block_reorgs: 0, destination: "webhook", status: "paused",
        destination_attributes: destination(a1, token),
      };
      let r = await qn("POST", "/streams", body);
      if (r.status === 422) r = await qn("POST", "/streams", { ...body, dataset_batch_size: 5 });
      if (r.status >= 300) return show({ http: r.status, error: String(r.json?.error ?? r.json?.message ?? r.json?.raw ?? "").slice(0, 200) });
      const id = r.json?.id;
      const state = id ? (await qn("GET", `/streams/${id}`)).json : r.json;
      if (state?.status === "active") await pause(id); // safety: never leave a new stream running
      const final = id ? (await qn("GET", `/streams/${id}`)).json : state;
      return show({ http: r.status, ...summary(final), token_saved_to: ENV_FILE });
    }
    default: console.error("commands: create <webhookUrl> | get | list | pause | activate | set-url <url> | delete | usage"); process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : "failed"); process.exit(1); });
