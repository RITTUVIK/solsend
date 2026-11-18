// POST /api/cards/[cardPda]/action {action: freeze|unfreeze|close} → PreparedTx (owner signs; close also
// revokes the Allowances delegation in the same tx).
import { api } from "@solsend/shared";
import { errorResponse, requireUser } from "@/server/auth";
import { cardDeps } from "@/server/deps";
import { readJson, respond } from "@/server/lib/http";
import { ownedCard, prepareCardAction } from "@/server/cards/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ cardPda: string }> }): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    const { cardPda } = await ctx.params;
    const { action } = await readJson(req, api.CardActionRequest);
    const deps = cardDeps();
    const row = await ownedCard(deps.store, wallet, cardPda);
    return respond(api.PreparedTx, await prepareCardAction(deps, wallet, row, action));
  } catch (e) {
    return errorResponse(e);
  }
}
