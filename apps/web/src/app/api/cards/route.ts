// GET /api/cards → ListCardsResponse. Reconciles non-final rows against the chain first (F3 step 5).
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { respond } from "@/server/lib/http";
import { getStore } from "@/server/store";
import { waitUntil } from "@vercel/functions";
import { cardDeps, reconcileDeps } from "@/server/deps";
import { maybePiggybackSweep } from "@/server/reconcile/piggyback";
import { recoverAndList, toCardView } from "@/server/cards/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    if (!(await getStore().rateLimit(`read:cards:${wallet}`, 60, 60))) throw new HttpError(429, "too many card list requests, slow down", "rate_limited");
    try { waitUntil(maybePiggybackSweep(reconcileDeps, getStore())); } catch { /* never affects the request */ }
    const deps = cardDeps();
    const { rows, chain } = await recoverAndList(deps, wallet);
    const now = Date.now();
    return respond(api.ListCardsResponse, { cards: rows.map((r, i) => toCardView(r, chain[i], now)) });
  } catch (e) {
    return errorResponse(e);
  }
}
