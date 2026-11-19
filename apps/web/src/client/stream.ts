// QuickNode Stream evidence, derived ONLY from recorded deliveries (feed rows written by the QuickNode webhook,
// source "quicknode"). The UI must never claim an event was streamed unless such a row exists: the stream is paused
// outside demo windows (trial billing), and money decisions never depend on it (RPC reads at `confirmed` do).
import type { FeedRow } from "./format";

/** After this long without a delivery, an onchain event is reported as "not streamed (yet)". Measured delivery: ~0.6 s. */
export const QN_LATE_MS = 15_000;
/** Stop polling for a single settlement's delivery after this long. */
export const QN_WATCH_MS = 120_000;

/** Feed kinds that correspond to events emitted by the SolSend program (the only thing our Stream filter delivers).
 *  authorization_approved is delivered as its CardSettled event (a separate "settled" row with the same signature). */
const PROGRAM_EVENT_KINDS = new Set<FeedRow["kind"]>(["registered", "authorization_approved", "settled", "refunded", "frozen", "unfrozen", "closed"]);

/** The recorded QuickNode delivery for this transaction signature (its slot and cross-check text), or null. */
export function streamedRow(rows: readonly FeedRow[] | null | undefined, signature: string | null | undefined): FeedRow | null {
  return (signature && rows?.find((r) => r.source === "quicknode" && r.signature === signature)) || null;
}
/** True once a QuickNode delivery for this transaction signature has been recorded. */
export function streamedBy(rows: readonly FeedRow[] | null | undefined, signature: string | null | undefined): boolean {
  return !!streamedRow(rows, signature);
}
/** "Slot 523,539,100 · <cross-check>": what the Stream delivery itself carried (only Stream rows have a slot). */
export function streamDetail(r: FeedRow | null | undefined): string | null {
  if (!r || r.source !== "quicknode") return null;
  return [r.slot != null ? `Slot ${r.slot.toLocaleString("en-US")}` : null, r.reason].filter(Boolean).join(" · ") || null;
}

/** Settle signature → Lithic token, from the approval rows SolSend writes itself. */
export function approvalTokens(rows: readonly FeedRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.kind === "authorization_approved" && r.signature && r.lithicToken) m.set(r.signature, r.lithicToken);
  return m;
}
/** Token that groups a row into its purchase. A Stream-delivered CardSettled row can arrive before the server has written
 *  the authorization (then the webhook cannot resolve auth_hash → token): fall back to the approval with the same signature. */
export function purchaseToken(r: FeedRow, approvals: ReadonlyMap<string, string>): string | null {
  return r.lithicToken ?? (r.kind === "settled" && r.signature ? approvals.get(r.signature) ?? null : null);
}

export type StreamState = "delivered" | "pending" | "not_delivered" | "none";
export interface StreamSummary { state: StreamState; lastDeliveryAt: string | null; newestEventAt: string | null }

/**
 * Activity-level status: is the newest program event in this feed backed by a recorded QuickNode delivery?
 *  delivered      – yes (lastDeliveryAt = newest delivered event's time)
 *  pending        – not yet, and the event is younger than QN_LATE_MS
 *  not_delivered  – not after QN_LATE_MS: the stream is paused or delayed
 *  none           – no program events in this feed yet
 */
export function streamSummary(rows: readonly FeedRow[] | null | undefined, nowMs = Date.now()): StreamSummary {
  const list = rows ?? [];
  let lastDeliveryAt: string | null = null;
  const delivered = new Set<string>();
  for (const r of list) {
    if (r.source !== "quicknode") continue;
    if (r.signature) delivered.add(r.signature);
    if (!lastDeliveryAt || Date.parse(r.at) > Date.parse(lastDeliveryAt)) lastDeliveryAt = r.at;
  }
  let newest: FeedRow | null = null;
  for (const r of list) {
    if (!r.signature || !PROGRAM_EVENT_KINDS.has(r.kind)) continue;
    if (!newest || Date.parse(r.at) > Date.parse(newest.at)) newest = r;
  }
  if (!newest) return { state: "none", lastDeliveryAt, newestEventAt: null };
  if (delivered.has(newest.signature!)) return { state: "delivered", lastDeliveryAt, newestEventAt: newest.at };
  return { state: nowMs - Date.parse(newest.at) < QN_LATE_MS ? "pending" : "not_delivered", lastDeliveryAt, newestEventAt: newest.at };
}
