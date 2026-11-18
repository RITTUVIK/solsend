// Lithic `card_transaction.updated` events → reconciler (CP1 F5). Same HMAC scheme as ASA, keyed with the
// event subscription's own whsec_ secret; deduped on webhook-id via webhook_receipts.
import { LithicTransactionZ, LITHIC_TERMINAL_DECLINE, toHex, type AuthorizationRow, type LithicTransaction } from "@solsend/shared";
import { authCommitment } from "../lib/commitments";
import { verifyLithicWebhook } from "../lithic/webhook";
import { reconcileAuthorization, type ReconcileDeps, type ReconcileResult } from "./reconciler";

export const SAFETY_LIMIT_REASON = "Declined by card-network safety limit (sandbox)";

export type EventIntake =
  | { status: 401; reason: string }
  | { status: 200; kind: "duplicate" | "ignored"; eventType: string | null }
  | { status: 200; kind: "accepted"; eventType: string; tx: LithicTransaction };

/** Verify + dedupe + parse. Body shape: Lithic delivers the resource with `event_type`; also accept a `{payload}` wrapper. */
export async function intakeLithicEvent(deps: Pick<ReconcileDeps, "store" | "clock">, secret: string, headers: Headers, raw: string): Promise<EventIntake> {
  const v = verifyLithicWebhook(secret, headers, raw, deps.clock.now());
  if (!v.ok) return { status: 401, reason: v.reason };
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return { status: 200, kind: "ignored", eventType: null }; }
  const eventType = typeof body.event_type === "string" ? body.event_type : null;
  if (!(await deps.store.recordReceipt("lithic_events", v.id))) return { status: 200, kind: "duplicate", eventType };
  if (eventType !== "card_transaction.updated") return { status: 200, kind: "ignored", eventType };
  const candidate = body.payload && typeof body.payload === "object" ? body.payload : body;
  const p = LithicTransactionZ.safeParse(candidate);
  if (!p.success) return { status: 200, kind: "ignored", eventType };
  return { status: 200, kind: "accepted", eventType, tx: p.data };
}

const SKIP = (a: string | null) => a === "refunded" || (a?.startsWith("none_") ?? false);

/** Apply one verified transaction update. Waits briefly for the ASA row (the ASA after-hook may still be writing it). */
export async function applyTransactionUpdate(deps: ReconcileDeps, tx: LithicTransaction, opts: { rowWaitMs?: number } = {}): Promise<ReconcileResult | { token: string; outcome: string; tag: string }> {
  let row = await deps.store.getAuthorization(tx.token);
  if (!row) {
    await deps.clock.sleep(opts.rowWaitMs ?? 3000);
    row = await deps.store.getAuthorization(tx.token);
  }
  if (!row) return recordWithoutAsa(deps, tx);
  if (SKIP(row.reconcile_action)) {
    if (row.lithic_final_status !== tx.status) {
      const { updated_at: _u, ...rest } = row;
      await deps.store.upsertAuthorization({ ...rest, lithic_final_status: tx.status });
    }
    return { token: tx.token, outcome: "skipped", tag: row.reconcile_action ?? "" };
  }
  return reconcileAuthorization(deps, row, tx.status);
}

/** Lithic decided without calling our ASA (amendment 4: outer spend-limit circuit breaker) → no settle, no row yet. */
async function recordWithoutAsa(deps: ReconcileDeps, tx: LithicTransaction) {
  const card = tx.card_token ? await deps.store.getCardByLithicToken(tx.card_token).catch(() => null) : null;
  const declined = LITHIC_TERMINAL_DECLINE.has(tx.status);
  const detail = tx.events?.flatMap((e) => e.detailed_results ?? []).find((r) => r !== "APPROVED") ?? null;
  const row: Omit<AuthorizationRow, "created_at" | "updated_at"> = {
    lithic_token: tx.token, auth_hash: toHex(authCommitment(tx.token)), card_pda: card?.card_pda ?? null, amount_cents: Math.abs(tx.amount ?? 0),
    merchant_descriptor: merchantDescriptor(tx), acceptor_id: null, decision: declined ? (tx.result && tx.result !== "APPROVED" ? tx.result : "DECLINED") : "NO_ASA",
    reason: declined ? `${SAFETY_LIMIT_REASON}${detail ? ` (${detail})` : ""}` : "Lithic transaction without an ASA request (anomaly)", settle_signature: null, confirmed_at: null, replied_at: null,
    timings: {}, lithic_final_status: tx.status, reconcile_action: declined ? "none_lithic_declined" : "anomaly_no_asa_request", refund_signature: null,
  };
  await deps.store.upsertAuthorization(row);
  if (declined && card) {
    await deps.store.insertFeedEvent({
      owner_wallet: card.owner_wallet, card_pda: card.card_pda, kind: "authorization_declined", amount_base: (BigInt(Math.abs(tx.amount ?? 0)) * 10_000n).toString(),
      remaining_base: null, signature: null, lithic_token: tx.token, merchant: merchantDescriptor(tx), reason: SAFETY_LIMIT_REASON, source: "lithic", slot: null,
    }).catch(() => false);
  }
  return { token: tx.token, outcome: declined ? "done" : "anomaly", tag: row.reconcile_action! };
}

const merchantDescriptor = (tx: LithicTransaction) => {
  const m = (tx as { merchant?: { descriptor?: unknown } }).merchant;
  return typeof m?.descriptor === "string" ? m.descriptor : null;
};
