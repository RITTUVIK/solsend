// Onchain settle result → Lithic ASA reply (CP1 F4 table). Settle tx layout (amendment 1, no memo):
//   ix 0 = ComputeBudget.setComputeUnitLimit, ix 1 = SolSend `settle` (inner CPIs bubble up as ix 1).
import type { AsaResult } from "@solsend/shared";
import { IDL } from "@solsend/shared";

export const SETTLE_IX_INDEX = 1;

const SOLSEND_ERR: Record<string, number> = Object.fromEntries(
  ((IDL as unknown as { errors?: { code: number; name: string }[] }).errors ?? []).map((e) => [e.name, e.code]),
);
const code = (name: string) => {
  const c = SOLSEND_ERR[name];
  if (c === undefined) throw new Error(`IDL is missing SolSend error ${name}`);
  return c;
};

/** Allowances (De1egAFM…) codes, from the pinned upstream IDL (spikes/allowances_spike/scripts/fetch-vendor.sh). */
export const ALLOWANCES_ERR = { delegationExpired: 128, staleSubscriptionAuthority: 136, amountExceedsLimit: 300, amountExceedsPeriodLimit: 400 } as const;
const SPL_INSUFFICIENT_FUNDS = 1;
const SYSTEM_ACCOUNT_IN_USE = 0; // SettlementRecord `init` collision = duplicate authorization
const ANCHOR_ACCOUNT_NOT_INITIALIZED = 3012;

export type Mapped = { duplicate: true } | { duplicate: false; result: Exclude<AsaResult, "APPROVED">; reason: string };

const decline = (result: Exclude<AsaResult, "APPROVED">, reason: string): Mapped => ({ duplicate: false, result, reason });

/** Map a transaction error (`getSignatureStatuses().err` / `onSignature` err JSON). Unknown → SUSPECTED_FRAUD. */
export function mapSettleError(err: unknown): Mapped {
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  if (!Array.isArray(ie)) return decline("SUSPECTED_FRAUD", `tx_error:${short(err)}`);
  const [idx, detail] = ie;
  if (idx !== SETTLE_IX_INDEX) return decline("SUSPECTED_FRAUD", `ix${idx}_error:${short(detail)}`);
  if (typeof detail === "string") {
    if (detail === "InvalidAccountOwner" || detail === "UninitializedAccount" || detail === "AccountNotInitialized") return decline("CARD_PAUSED", "delegation_closed_or_missing");
    return decline("SUSPECTED_FRAUD", `settle_error:${detail.slice(0, 60)}`);
  }
  const c = (detail as { Custom?: number } | null)?.Custom;
  if (typeof c !== "number") return decline("SUSPECTED_FRAUD", `settle_error:${short(detail)}`);
  switch (c) {
    case SYSTEM_ACCOUNT_IN_USE: return { duplicate: true };
    case ALLOWANCES_ERR.amountExceedsLimit: return decline("INSUFFICIENT_FUNDS", "card_limit_exceeded");
    case SPL_INSUFFICIENT_FUNDS: return decline("INSUFFICIENT_FUNDS", "wallet_balance_insufficient");
    case ALLOWANCES_ERR.amountExceedsPeriodLimit: return decline("VELOCITY_EXCEEDED", "period_limit_exceeded");
    case code("CardNotActive"): return decline("CARD_PAUSED", "card_not_active");
    case code("Paused"): return decline("CARD_PAUSED", "settlements_paused");
    case code("CardIdle"): return decline("CARD_PAUSED", "card_idle");
    case code("InvalidDelegation"):
    case ALLOWANCES_ERR.delegationExpired:
    case ALLOWANCES_ERR.staleSubscriptionAuthority:
    case ANCHOR_ACCOUNT_NOT_INITIALIZED: return decline("CARD_PAUSED", "delegation_closed_or_missing");
    case code("MerchantMismatch"): return decline("UNAUTHORIZED_MERCHANT", "merchant_mismatch");
    case code("PerTxLimitExceeded"): return decline("VELOCITY_EXCEEDED", "per_tx_limit_exceeded");
    default: return decline("SUSPECTED_FRAUD", `settle_custom_${c}`);
  }
}

const short = (v: unknown) => { try { return JSON.stringify(v).slice(0, 60); } catch { return "?"; } };

const ONCHAIN_DETAIL: Record<string, string> = {
  card_limit_exceeded: "Allowances 300", period_limit_exceeded: "Allowances 400", wallet_balance_insufficient: "SPL Token 1",
  card_not_active: "SolSend CardNotActive", settlements_paused: "SolSend Paused", card_idle: "SolSend CardIdle",
  merchant_mismatch: "SolSend MerchantMismatch", per_tx_limit_exceeded: "SolSend PerTxLimitExceeded",
  delegation_closed_or_missing: "delegation revoked / Allowances owner check", duplicate_already_settled: "SettlementRecord exists",
};

/** `authorizations.reason`: short human text + onchain detail, e.g. "Over this card's limit (Allowances 300)". */
export function reasonForRow(reason: string): string {
  const [base, ...rest] = reason.split(":");
  const custom = /^settle_custom_(\d+)$/.exec(base!);
  const detail = custom ? `custom error ${custom[1]}` : ONCHAIN_DETAIL[base!] ?? (rest.length ? rest.join(":").slice(0, 60) : null);
  return `${reasonText(reason)}${detail ? ` (${detail})` : ""}`;
}

/** Human-readable reason for the activity feed / Demo Merchant UI. */
export function reasonText(reason: string): string {
  const base = reason.split(":")[0]!;
  const t: Record<string, string> = {
    settled_confirmed: "Paid from your wallet (settled on devnet before approval)",
    duplicate_already_settled: "Duplicate delivery: already settled once",
    zero_amount_verification: "Card verification ($0), no funds moved",
    card_limit_exceeded: "Over this card's limit",
    wallet_balance_insufficient: "Not enough USDC in your wallet",
    period_limit_exceeded: "Over this period's limit",
    per_tx_limit_exceeded: "Over the per-transaction maximum",
    card_not_active: "Card is frozen, used or closed",
    settlements_paused: "Settlements are paused by the admin",
    card_idle: "Card idle — unfreeze to reactivate",
    delegation_closed_or_missing: "Allowance revoked or missing",
    merchant_mismatch: "Card is locked to a different store",
    issuer_outage: "Issuer outage: all cards paused",
    unmapped_card: "Unknown card",
    lithic_card_not_open: "Card is not open at the card network",
    unsupported_status: "Unsupported authorization type",
    non_usd: "Only USD authorizations are supported",
    invalid_amount: "Invalid amount",
    no_merchant_identity: "Merchant could not be identified",
    duplicate_amount_mismatch: "Same authorization with a different amount (incremental auths unsupported)",
    duplicate_unconfirmed: "Duplicate delivery not confirmable in time",
    duplicate_refunded: "Duplicate of an authorization that was already refunded",
    inflight_mismatch: "Same authorization re-sent with different details (declined)",
    replay: "Replayed authorization request (declined)",
    deadline_exceeded: "Timed out before devnet confirmation (fail-closed)",
    no_confirmation: "Not confirmed on devnet in time (fail-closed)",
    handler_error: "Internal error (fail-closed)",
    bad_request: "Malformed authorization request",
  };
  return t[base] ?? "Declined by the onchain policy";
}
