// LEAD-OWNED. Server-only environment access with sandbox/devnet guards. Never import from client code.
import "server-only";
import { z } from "zod";

const Env = z.object({
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string().url().optional(),
  SETTLEMENT_AUTHORITY_SECRET_KEY: z.string().min(10),
  FEE_PAYER_SECRET_KEY: z.string().min(10),
  DEMO_FAUCET_SECRET_KEY: z.string().min(10).optional(),
  FAUCET_AMOUNT_BASE: z.coerce.bigint().default(5_000_000n),
  LITHIC_API_KEY: z.string().min(10),
  LITHIC_ASA_SECRET: z.string().startsWith("whsec_"),
  LITHIC_EVENTS_SECRET: z.string().startsWith("whsec_").optional(),
  ASA_BUDGET_MS: z.coerce.number().int().min(500).max(5500).default(4500),
  PRIVY_APP_ID: z.string().min(5),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  QN_STREAM_SECURITY_TOKEN: z.string().min(8).optional(),
  RECONCILE_CRON_SECRET: z.string().min(16).optional(),
  ADMIN_API_TOKEN: z.string().min(16).optional(),
  DEMO_MERCHANT_ENABLED: z.enum(["0", "1"]).default("0"),
  DEMO_MERCHANT_MAX_CENTS: z.coerce.number().int().min(1).max(5000).default(5000),
});
export type ServerEnv = z.infer<typeof Env>;

let cached: ServerEnv | null = null;
/** Parsed env. Throws (without echoing values) if anything required is missing or malformed. */
export function env(): ServerEnv {
  if (cached) return cached;
  const r = Env.safeParse(process.env);
  if (!r.success) throw new Error(`server env invalid: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  if (r.data.SOLANA_RPC_URL.includes("mainnet")) throw new Error("refusing mainnet RPC (devnet only)");
  cached = r.data;
  return cached;
}

/** Only the Lithic sandbox host is ever allowed (hard rule: never production cards). */
export const LITHIC_BASE = "https://sandbox.lithic.com" as const;

export const wsUrl = (e = env()) => e.SOLANA_WS_URL ?? e.SOLANA_RPC_URL.replace(/^http/, "ws");
