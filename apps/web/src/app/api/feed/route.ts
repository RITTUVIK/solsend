// GET /api/feed?cardPda=&since=<iso> (alias: cursor) → FeedResponse, scoped to the caller's wallet.
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { getStore } from "@/server/store";
import { respond } from "@/server/lib/http";
import { waitUntil } from "@vercel/functions";
import { reconcileDeps } from "@/server/deps";
import { maybePiggybackSweep } from "@/server/reconcile/piggyback";
import { listFeed } from "@/server/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    if (!(await getStore().rateLimit(`read:feed:${wallet}`, 60, 120))) throw new HttpError(429, "too many feed requests, slow down", "rate_limited");
    try { waitUntil(maybePiggybackSweep(reconcileDeps, getStore())); } catch { /* never affects the request */ }
    const q = new URL(req.url).searchParams;
    const cardPda = q.get("cardPda");
    return respond(api.FeedResponse, await listFeed(getStore(), wallet, { cardPda: cardPda && api.Pubkey.safeParse(cardPda).success ? cardPda : null, since: q.get("since") ?? q.get("cursor") }));
  } catch (e) {
    return errorResponse(e);
  }
}
