// POST /api/lithic/asa — Lithic Auth Stream Access (hot path, CP1 F4). Lithic → us.
// Reply APPROVED only after the settle is CONFIRMED on devnet (docs/TRUST.md invariant 1).
import { waitUntil } from "@vercel/functions";
import { asaEngine, reconcileDeps } from "@/server/deps";
import { afterAsaReply } from "@/server/asa/after";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const receivedAt = Date.now();
  let raw = "";
  try {
    raw = await req.text(); // raw bytes for the HMAC — never logged (may be card-adjacent data)
  } catch {
    return Response.json({ result: "SUSPECTED_FRAUD" });
  }
  let engine;
  try {
    engine = asaEngine();
  } catch {
    console.error("[asa] engine unavailable (env/keys) — declining");
    return Response.json({ result: "SUSPECTED_FRAUD" }); // fail closed; Lithic only sees a decline
  }
  const out = await engine.handle(raw, req.headers, receivedAt);
  if (out.status === 401) {
    console.warn(`[asa] 401 ${out.reason}`);
    return Response.json(out.body, { status: 401 });
  }
  const repliedAt = new Date().toISOString();
  const d = out.decision;
  console.log(`[asa] ${d.result} ${d.reason} token=${d.token} total_ms=${d.timings.total_ms}${d.signature ? ` sig=${d.signature}` : ""}${out.deduped ? " (inflight dedupe)" : ""}`);
  try {
    waitUntil(afterAsaReply(reconcileDeps(), d, repliedAt, { deduped: out.deduped }).catch(() => {}));
  } catch { /* persistence is best effort; correctness lives onchain + in the reconciler */ }
  return Response.json(out.body);
}
