// POST /api/reconcile — cron (GitHub Actions, every 5 min) + manual. Bearer RECONCILE_CRON_SECRET.
// Body (optional): { tokens?: string[] } to reconcile specific authorizations regardless of sweep state;
// { items?: [{token, cardPda}] } to recover authorizations whose DB row is missing (rebuilt from chain).
import { z } from "zod";
import { env } from "@/server/env";
import { errorResponse } from "@/server/auth";
import { requireBearer } from "@/server/lib/http";
import { reconcileDeps } from "@/server/deps";
import { reconcileAuthorization, recoverMissingRow, sweep, type ReconcileResult } from "@/server/reconcile/reconciler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";
export const maxDuration = 60;

const Body = z.object({
  tokens: z.array(z.string().min(8).max(64)).max(20).optional(),
  /** recovery: authorization rows missing → rebuild from the onchain SettlementRecord */
  items: z.array(z.object({ token: z.string().min(8).max(64), cardPda: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) })).max(20).optional(),
}).default({});

export async function POST(req: Request): Promise<Response> {
  try {
    requireBearer(req, env().RECONCILE_CRON_SECRET, "reconcile");
    const text = await req.text();
    const body = Body.parse(text ? JSON.parse(text) : {});
    const deps = reconcileDeps();
    let results: ReconcileResult[] = [];
    if (body.items?.length) {
      for (const it of body.items) results.push(await recoverMissingRow(deps, it.token, it.cardPda));
    } else if (body.tokens?.length) {
      for (const t of body.tokens) {
        const row = await deps.store.getAuthorization(t);
        if (row) results.push(await reconcileAuthorization(deps, row));
      }
    } else {
      results = await sweep(deps, { olderThanSecs: 15, limit: 20 });
    }
    const counts = results.reduce<Record<string, number>>((m, r) => ((m[r.outcome] = (m[r.outcome] ?? 0) + 1), m), {});
    return Response.json({ ok: true, swept: results.length, counts, results });
  } catch (e) {
    return errorResponse(e);
  }
}
