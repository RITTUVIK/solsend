// Env loading + hard-rule guards for GATE 0 spikes.
// Secrets live only in spikes/.env (gitignored). Keypairs live outside the repo.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SPIKES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = join(SPIKES_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. Copy spikes/.env.example to spikes/.env and fill it in.`);
  return v;
}

export function optEnv(name: string): string | undefined {
  const v = process.env[name];
  return v ? v : undefined;
}

// ── Devnet constants (hard rule 4: devnet only, fixed mint) ────────────────
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const ISSUER_PROGRAM_ID = "cardWArqhdV5jeRXXjUti7cHAa4mj41Nj3Apc6RPZH2";
export const ISSUER_MERCHANT_ID = 1n;
export const SPIKE_PROGRAM_ID = "C31ntvRNLT8YuMuqHNkto5Pj3hgkQbCE1YZ4uaent8Zc";
export const USDC_DECIMALS = 6;

export const RPC_URL = optEnv("SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
if (/mainnet/i.test(RPC_URL)) throw new Error("Refusing to run: SOLANA_RPC_URL looks like mainnet (hard rule 4).");

export const KEYS_DIR = (optEnv("SOLSEND_KEYS_DIR") ?? "~/.config/solsend/devnet").replace(/^~(?=\/)/, homedir());

// ── Provider guards (sandbox only) ─────────────────────────────────────────
export function stripeKey(): string {
  const k = env("STRIPE_SECRET_KEY");
  if (!/^(sk|rk)_test_/.test(k)) throw new Error("Refusing to run: STRIPE_SECRET_KEY must be a sandbox/test key (sk_test_… or rk_test_…).");
  return k;
}

export const BRIDGE_BASE_URL = optEnv("BRIDGE_BASE_URL") ?? "https://api.sandbox.bridge.xyz";
export function bridgeKey(): string {
  if (!BRIDGE_BASE_URL.startsWith("https://api.sandbox.bridge.xyz")) {
    throw new Error("Refusing to run: BRIDGE_BASE_URL must be the Bridge sandbox.");
  }
  const k = env("BRIDGE_API_KEY");
  if (!k.startsWith("sk-test")) throw new Error("Refusing to run: BRIDGE_API_KEY must be a sandbox key (sk-test…).");
  return k;
}
