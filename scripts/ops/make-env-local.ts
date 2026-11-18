// Writes apps/web/.env.local (mode 600, gitignored) from spikes/.env + the key
// files in ~/.config/solsend/devnet/, fetching the ASA secret from Lithic `GET /v1/auth_stream/secret`.
// Prints ONLY the variable names written — never values.
//   npx tsx@4.23.15 scripts/ops/make-env-local.ts
import { randomBytes } from "node:crypto";
import { ENV_LOCAL, GEN_ENV, SPIKES_ENV, lithic, lithicCallsUsed, parseEnvFile, readKeyfile, writeEnvLocal } from "./_lib";

const spikes = parseEnvFile(SPIKES_ENV);
const generated = parseEnvFile(GEN_ENV); // machine-generated secrets are the source of truth (also pushed to Vercel)
const existing = parseEnvFile(ENV_LOCAL);
const need = (k: string) => { const v = spikes.get(k); if (!v) throw new Error(`spikes/.env is missing ${k}`); return v; };

const rpc = need("SOLANA_RPC_URL");
if (/mainnet/i.test(rpc)) throw new Error("refusing: SOLANA_RPC_URL looks like mainnet");
const apiKey = need("LITHIC_API_KEY");
const privy = need("VITE_PRIVY_APP_ID");

const out = new Map<string, string>([
  ["SOLANA_RPC_URL", rpc],
  ["SETTLEMENT_AUTHORITY_SECRET_KEY", readKeyfile("settlement-authority")],
  ["FEE_PAYER_SECRET_KEY", readKeyfile("fee-payer")],
  // Local dev only: card-a-owner acts as the faucet source; keep claims ≤ 1 USDC.
  ["DEMO_FAUCET_SECRET_KEY", readKeyfile("card-a-owner")],
  ["FAUCET_AMOUNT_BASE", "1000000"],
  ["LITHIC_API_KEY", apiKey],
  ["ASA_BUDGET_MS", existing.get("ASA_BUDGET_MS") ?? "4500"],
  ["PRIVY_APP_ID", privy],
  ["NEXT_PUBLIC_PRIVY_APP_ID", privy],
  ["RECONCILE_CRON_SECRET", generated.get("RECONCILE_CRON_SECRET") ?? existing.get("RECONCILE_CRON_SECRET") ?? randomBytes(24).toString("base64url")],
  ["ADMIN_API_TOKEN", generated.get("ADMIN_API_TOKEN") ?? existing.get("ADMIN_API_TOKEN") ?? randomBytes(24).toString("base64url")],
  ["DEMO_MERCHANT_ENABLED", existing.get("DEMO_MERCHANT_ENABLED") ?? "1"],
  ["DEMO_MERCHANT_MAX_CENTS", existing.get("DEMO_MERCHANT_MAX_CENTS") ?? "5000"],
]);
for (const k of ["QUICKNODE_API_KEY"]) if (spikes.get(k)) out.set(k, spikes.get(k)!);

const asa = await lithic(apiKey, "GET", "/v1/auth_stream/secret");
if (asa.status !== 200 || typeof asa.json.secret !== "string" || !asa.json.secret.startsWith("whsec_")) throw new Error(`Lithic auth_stream/secret failed (HTTP ${asa.status})`);
out.set("LITHIC_ASA_SECRET", asa.json.secret);

const names = writeEnvLocal(out);
console.log(`wrote ${ENV_LOCAL} (mode 600) — variables: ${names.join(", ")}`);
console.log(`(LITHIC_EVENTS_SECRET is written by scripts/ops/lithic-setup.ts; Lithic sandbox calls used: ${lithicCallsUsed()})`);
