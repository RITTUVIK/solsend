// POST /api/cards/prepare → PrepareCardResponse (one tx: re-arm SA if needed + delegation + register_card).
// Rate-limited per wallet (fee-payer rent protection). 409 setup_required → POST /api/wallet/setup first.
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { cardDeps, extraEnv } from "@/server/deps";
import { readJson, respond } from "@/server/lib/http";
import { prepareCard } from "@/server/cards/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    const body = await readJson(req, api.PrepareCardRequest);
    const deps = cardDeps();
    if (!(await deps.store.rateLimit(`cards:${wallet}`, 86_400, extraEnv().CARD_CREATE_DAILY_MAX))) throw new HttpError(429, "card creation limit reached for today", "rate_limited");
    if (!(await deps.store.rateLimit("cards:global", 3600, 120))) throw new HttpError(429, "card creation is busy, try later", "rate_limited");
    return respond(api.PrepareCardResponse, await prepareCard(deps, wallet, body));
  } catch (e) {
    return errorResponse(e);
  }
}
