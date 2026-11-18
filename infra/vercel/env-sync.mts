// LEAD-OWNED. Upsert SolSend env vars into the Vercel project from local sources, WITHOUT printing values.
// Sources: spikes/.env (parsed in-process), ~/.config/solsend/devnet/*.json keypairs, Lithic sandbox API (ASA secret).
// Usage: npx tsx infra/vercel/env-sync.mts [--dry-run]
import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ENV_FILE = path.join(ROOT, "spikes/.env");                 // human-edited credentials
const GEN_FILE = path.join(ROOT, "spikes/.env.generated");       // machine-generated secrets (never hand-edited)
const KEYS = path.join(os.homedir(), ".config/solsend/devnet");
const dry = process.argv.includes("--dry-run");

const parseEnv = (t: string) => Object.fromEntries(t.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const readAll = () => ({ ...parseEnv(readFileSync(ENV_FILE, "utf8")), ...(existsSync(GEN_FILE) ? parseEnv(readFileSync(GEN_FILE, "utf8")) : {}) });
let local = readAll();

/** Generate-once secrets are persisted to spikes/.env.generated (mode 600). That file is never hand-edited, so an
 *  editor saving a stale buffer of spikes/.env can't silently drop them (happened twice on 2026-11-18). */
function ensureLocal(name: string, gen: () => string): string {
  if (local[name]) return local[name]!;
  const v = gen();
  const t = existsSync(GEN_FILE) ? readFileSync(GEN_FILE, "utf8") : "# MACHINE-GENERATED secrets. Do not edit by hand.\n";
  writeFileSync(GEN_FILE, `${t.endsWith("\n") ? t : t + "\n"}${name}=${v}\n`, { mode: 0o600 });
  chmodSync(GEN_FILE, 0o600);
  local = readAll();
  return v;
}
const keyJson = (name: string) => {
  const arr = JSON.parse(readFileSync(path.join(KEYS, `${name}.json`), "utf8"));
  if (!Array.isArray(arr) || arr.length !== 64) throw new Error(`${name}.json is not a keypair`);
  return JSON.stringify(arr);
};
async function lithicAsaSecret(): Promise<string | undefined> {
  if (local.LITHIC_ASA_SECRET) return local.LITHIC_ASA_SECRET;
  if (!local.LITHIC_API_KEY) return undefined;
  const r = await fetch("https://sandbox.lithic.com/v1/auth_stream/secret", { headers: { Authorization: local.LITHIC_API_KEY } });
  if (!r.ok) { console.log(`lithic auth_stream/secret: HTTP ${r.status}`); return undefined; }
  const s = (await r.json() as { secret?: string }).secret;
  return s?.startsWith("whsec_") ? s : undefined;
}

if (local.SOLANA_RPC_URL?.includes("mainnet")) throw new Error("refusing: mainnet RPC");
const want: Record<string, { value: string | undefined; sensitive: boolean }> = {
  SOLANA_RPC_URL: { value: local.SOLANA_RPC_URL, sensitive: true },
  SETTLEMENT_AUTHORITY_SECRET_KEY: { value: keyJson("settlement-authority"), sensitive: true },
  FEE_PAYER_SECRET_KEY: { value: keyJson("fee-payer"), sensitive: true },
  DEMO_FAUCET_SECRET_KEY: { value: existsSync(path.join(KEYS, "demo-faucet.json")) ? keyJson("demo-faucet") : undefined, sensitive: true },
  FAUCET_AMOUNT_BASE: { value: local.FAUCET_AMOUNT_BASE ?? "5000000", sensitive: false },
  LITHIC_API_KEY: { value: local.LITHIC_API_KEY, sensitive: true },
  LITHIC_ASA_SECRET: { value: await lithicAsaSecret(), sensitive: true },
  LITHIC_EVENTS_SECRET: { value: local.LITHIC_EVENTS_SECRET, sensitive: true },
  ASA_BUDGET_MS: { value: local.ASA_BUDGET_MS ?? "4500", sensitive: false },
  PRIVY_APP_ID: { value: local.PRIVY_APP_ID ?? local.VITE_PRIVY_APP_ID, sensitive: false },
  NEXT_PUBLIC_PRIVY_APP_ID: { value: local.PRIVY_APP_ID ?? local.VITE_PRIVY_APP_ID, sensitive: false },
  SUPABASE_URL: { value: local.SUPABASE_URL, sensitive: false },
  SUPABASE_SECRET_KEY: { value: local.SUPABASE_SECRET_KEY, sensitive: true },
  QN_STREAM_SECURITY_TOKEN: { value: local.QN_STREAM_SECURITY_TOKEN, sensitive: true },
  RECONCILE_CRON_SECRET: { value: ensureLocal("RECONCILE_CRON_SECRET", () => randomBytes(32).toString("base64url")), sensitive: true },
  ADMIN_API_TOKEN: { value: ensureLocal("ADMIN_API_TOKEN", () => randomBytes(32).toString("base64url")), sensitive: true },
  DEMO_MERCHANT_ENABLED: { value: "1", sensitive: false },
  DEMO_MERCHANT_MAX_CENTS: { value: "5000", sensitive: false },
};

const auth = JSON.parse(readFileSync(path.join(os.homedir(), "Library/Application Support/com.vercel.cli/auth.json"), "utf8"));
const H = { Authorization: `Bearer ${auth.token}`, "content-type": "application/json" };
const set: string[] = [], missing: string[] = [];
for (const [key, { value, sensitive }] of Object.entries(want)) {
  if (!value) { missing.push(key); continue; }
  if (dry) { set.push(key); continue; }
  const r = await fetch("https://api.vercel.com/v10/projects/solsend/env?upsert=true", {
    method: "POST", headers: H,
    body: JSON.stringify({ key, value, type: sensitive ? "sensitive" : "plain", target: ["production", "preview"] }),
  });
  if (r.ok) set.push(key); else { const j = await r.json().catch(() => ({})) as { error?: { message?: string } }; console.log(`FAILED ${key}: HTTP ${r.status} ${j.error?.message ?? ""}`); }
}
console.log(`${dry ? "would set" : "set"} (${set.length}): ${set.join(", ")}`);
console.log(`missing (${missing.length}): ${missing.join(", ") || "none"}`);
