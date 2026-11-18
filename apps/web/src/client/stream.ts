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

/** True once a QuickNode delivery for this transaction signature has been recorded. */
export function streamedBy(rows: readonly FeedRow[] | null | undefined, signature: string | null | undefined): boolean {
  return !!signature && !!rows?.some((r) => r.source === "quicknode" && r.signature === signature);
}

export type StreamState = "delivered" | "pending" | "not_delivered" | "none";
export interface StreamSummary { state: StreamState; lastDeliveryAt: string | null }

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
  if (!newest) return { state: "none", lastDeliveryAt };
  if (delivered.has(newest.signature!)) return { state: "delivered", lastDeliveryAt };
  return { state: nowMs - Date.parse(newest.at) < QN_LATE_MS ? "pending" : "not_delivered", lastDeliveryAt };
}
