// Reconciler decision rule (CP1 F5, docs/TRUST.md invariants 3 + 4). PURE — unit-tested as a matrix.
// Source of truth = the Lithic transaction status. `result` is NOT authoritative after a void (CP0b S2).
import "server-only";
import { LITHIC_TERMINAL_DECLINE } from "@solsend/shared";
import type { RecordView } from "../solana/records";

/** "NOT_FOUND" = Lithic has no transaction with this token (MOCK-signed requests; no network obligation). */
export type LithicStatus = string | "NOT_FOUND" | null; // null = unknown (lookup failed)

export type RuleInput = { decision: string; lithicStatus: LithicStatus; record: RecordView | null; ageSecs: number };
export type RuleOutput =
  | { action: "refund"; amount: bigint }
  | { action: "done"; tag: string }
  | { action: "anomaly"; tag: string }
  | { action: "wait"; why: string };

/** Approved + PENDING rows leave the cron sweep after this (the events webhook still reconciles later voids). */
export const PENDING_SWEEP_WINDOW_SECS = 30 * 60;
/** Don't treat NOT_FOUND as final until Lithic has certainly had time to create the transaction. */
export const NOT_FOUND_GRACE_SECS = 30;

export function decideReconcile({ decision, lithicStatus, record, ageSecs }: RuleInput): RuleOutput {
  const approved = decision === "APPROVED";
  const remainder = record && record.amount > record.refunded ? record.amount - record.refunded : 0n;
  if (lithicStatus === null) return { action: "wait", why: "lithic_status_unknown" };

  if (lithicStatus === "NOT_FOUND") {
    if (ageSecs < NOT_FOUND_GRACE_SECS) return { action: "wait", why: "not_found_grace" };
    if (approved) return record ? { action: "done", tag: "not_in_lithic_approved" } : { action: "anomaly", tag: "anomaly_approved_without_record" };
    return remainder > 0n ? { action: "refund", amount: remainder } : { action: "done", tag: record ? "already_refunded" : "none" };
  }

  if (LITHIC_TERMINAL_DECLINE.has(lithicStatus)) {
    // DECLINED / VOIDED / EXPIRED: whatever we replied, no merchant will be paid → return the remainder.
    if (remainder > 0n) return { action: "refund", amount: remainder };
    return { action: "done", tag: record ? "already_refunded" : "none" };
  }

  if (lithicStatus === "SETTLED") {
    if (!record) return { action: "anomaly", tag: approved ? "anomaly_approved_without_record" : "anomaly_settled_without_record" };
    return { action: "done", tag: "settled" };
  }

  if (lithicStatus === "PENDING") {
    if (approved && !record) return { action: "anomaly", tag: "anomaly_approved_without_record" };
    if (approved && ageSecs > PENDING_SWEEP_WINDOW_SECS) return { action: "done", tag: "approved_pending_settlement" };
    return { action: "wait", why: "lithic_pending" };
  }
  return { action: "wait", why: `lithic_status_${lithicStatus.toLowerCase()}` };
}

export const REFUND_FEED_REASON = "USDC returned; card limit stays used";
