// POST /api/lithic/events — Lithic `card_transaction.updated` (CP1 F5). HMAC with LITHIC_EVENTS_SECRET,
// dedupe on webhook-id, then reconcile in the background (voids → refunds via the program).
import { waitUntil } from "@vercel/functions";
import { env } from "@/server/env";
import { reconcileDeps } from "@/server/deps";
import { applyTransactionUpdate, intakeLithicEvent } from "@/server/reconcile/events";
import { safeErr } from "@/server/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const secret = env().LITHIC_EVENTS_SECRET;
  if (!secret) return Response.json({ error: "events not configured" }, { status: 503 });
  const raw = await req.text();
  const deps = reconcileDeps();
  let intake;
  try {
    intake = await intakeLithicEvent(deps, secret, req.headers, raw);
  } catch (e) {
    console.error(`[events] intake failed: ${safeErr(e)}`);
    return Response.json({ error: "temporarily unavailable" }, { status: 503 }); // Lithic retries
  }
  if (intake.status === 401) {
    console.warn(`[events] 401 ${intake.reason}`);
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (intake.kind !== "accepted") return Response.json({ ok: true, [intake.kind]: true });
  const tx = intake.tx;
  console.log(`[events] ${intake.eventType} token=${tx.token} status=${tx.status}`);
  waitUntil(applyTransactionUpdate(deps, tx)
    .then((r) => console.log(`[events] reconciled token=${r.token} ${r.outcome} ${r.tag}${"refundSignature" in r && r.refundSignature ? ` refund=${r.refundSignature}` : ""}`))
    .catch((e) => console.error(`[events] reconcile failed token=${tx.token}: ${safeErr(e)} (cron will retry)`)));
  return Response.json({ ok: true });
}
