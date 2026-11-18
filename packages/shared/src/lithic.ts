// CP1 CONTRACT — Lithic sandbox shapes (verified against real sandbox traffic in CP0b S2).
import { z } from "zod";

export const LITHIC_SANDBOX_BASE = "https://sandbox.lithic.com";
/** Descriptors are limited to 25 chars by Lithic (CP0b S2 finding). Always suffixed "(SANDBOX)" in our UI. */
export const DEMO_MERCHANTS = {
  TEMU: { descriptor: "TEMU (SANDBOX)", acceptorId: "SOLSENDDEMOTEMU01", mcc: "5399" },
  AMAZON: { descriptor: "AMAZON (SANDBOX)", acceptorId: "SOLSENDDEMOAMZN01", mcc: "5942" },
  NETFLIX: { descriptor: "NETFLIX (SANDBOX)", acceptorId: "SOLSENDDEMONFLX01", mcc: "4899" },
  OTHER_STORE: { descriptor: "UNKNOWN STORE (SANDBOX)", acceptorId: "SOLSENDDEMOOTHR01", mcc: "5999" },
} as const;

/** Tags we set on every Lithic card (mapping card → onchain Card PDA without a DB lookup). */
export const CardTagsZ = z.object({ solsend_card: z.string(), solsend_owner: z.string(), solsend_card_id: z.string() });

/** Subset of Lithic `card_authorization.approval_request` (ASA). Never contains a card number. */
export const AsaRequestZ = z.object({
  token: z.string(),
  status: z.string(),
  amount: z.number().optional(),
  amounts: z.object({ cardholder: z.object({ amount: z.number(), currency: z.string() }).optional() }).partial().optional(),
  card: z.object({ token: z.string(), state: z.string().optional(), type: z.string().optional(), memo: z.string().optional(), tags: z.record(z.string(), z.string()).optional() }),
  merchant: z.object({ descriptor: z.string().optional(), acceptor_id: z.string().optional(), mcc: z.string().optional() }).optional(),
}).passthrough();
export type AsaRequest = z.infer<typeof AsaRequestZ>;

/** ASA reply `result` values (anything but APPROVED/CHALLENGE declines). */
export const AsaResultZ = z.enum(["APPROVED", "INSUFFICIENT_FUNDS", "CARD_PAUSED", "UNAUTHORIZED_MERCHANT", "VELOCITY_EXCEEDED", "SUSPECTED_FRAUD"]);
export type AsaResult = z.infer<typeof AsaResultZ>;

/** ASA `status` values that may settle onchain. Everything else (BALANCE_INQUIRY, credits, unknown) declines. */
export const ASA_SETTLE_STATUSES = new Set(["AUTHORIZATION", "FINANCIAL_AUTHORIZATION"]);

/** Lithic issuance config (security review, amendment 3). The onchain program is the AUTHORITATIVE spending gate;
 *  Lithic limits are an OUTER circuit breaker at 2× the onchain limit, so they never pre-empt an onchain decision in
 *  the normal range but bound issuer exposure if the ASA path ever approved without a confirmed settle.
 *  MERCHANT_LOCKED is deliberately not used: the onchain merchant lock is authoritative and must stay observable. */
export function lithicCardConfig(kind: "STORE_LOCKED" | "ONE_TIME" | "SUBSCRIPTION", limitCents: number) {
  if (!Number.isInteger(limitCents) || limitCents <= 0) throw new Error("invalid limit");
  const outer = limitCents * 2;
  switch (kind) {
    case "STORE_LOCKED": return { type: "VIRTUAL", spend_limit: outer, spend_limit_duration: "FOREVER" } as const;
    case "ONE_TIME": return { type: "SINGLE_USE", spend_limit: outer, spend_limit_duration: "TRANSACTION" } as const;
    case "SUBSCRIPTION": return { type: "VIRTUAL", spend_limit: outer, spend_limit_duration: "MONTHLY" } as const;
  }
}
/** Account-level daily cap (cents) — global circuit breaker set by scripts/ops/lithic-setup.ts when the sandbox supports it. */
export const LITHIC_ACCOUNT_DAILY_CAP_CENTS = 50_000;
export const OUTER_LIMIT_DECLINE_REASON = "Declined by card-network safety limit (sandbox)";

/** Lithic transaction (GET /v1/transactions/{token} and card_transaction.updated). Reconcile on
 *  `status` + event types — `result` stays "APPROVED" even after a void (CP0b S2 finding). */
export const LithicTransactionZ = z.object({
  token: z.string(), status: z.string(), result: z.string().nullable().optional(), amount: z.number().optional(),
  card_token: z.string().optional(),
  events: z.array(z.object({ type: z.string(), result: z.string().optional(), amount: z.number().optional(), created: z.string().optional(), detailed_results: z.array(z.string()).optional() })).optional(),
}).passthrough();
export type LithicTransaction = z.infer<typeof LithicTransactionZ>;
export const LITHIC_TERMINAL_DECLINE = new Set(["DECLINED", "VOIDED", "EXPIRED"]);
