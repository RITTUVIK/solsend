// GET /api/cards → ListCardsResponse. Reconciles non-final rows against the chain first (F3 step 5).
import { api } from "@solsend/shared";
import { errorResponse, requireUser } from "@/server/auth";
import { cardDeps } from "@/server/deps";
import { respond } from "@/server/lib/http";
import { recoverAndList, toCardView } from "@/server/cards/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    const deps = cardDeps();
    const { rows, chain } = await recoverAndList(deps, wallet);
    const now = Date.now();
    return respond(api.ListCardsResponse, { cards: rows.map((r, i) => toCardView(r, chain[i], now)) });
  } catch (e) {
    return errorResponse(e);
  }
}
