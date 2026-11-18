// POST /api/cards/[cardPda]/retry-issue → RetryIssueResponse (re-runs Lithic issuance for lithic_failed /
// onchain_confirmed cards; the CAS on issue_state prevents double issuance).
import { PublicKey } from "@solana/web3.js";
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { cardDeps } from "@/server/deps";
import { respond } from "@/server/lib/http";
import { issueLithicCard, ownedCard, toCardView } from "@/server/cards/service";
import { readChainCards } from "@/server/cards/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ cardPda: string }> }): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    const { cardPda } = await ctx.params;
    const deps = cardDeps();
    let row = await ownedCard(deps.store, wallet, cardPda);
    const owner = new PublicKey(row.owner_wallet);
    let [chain] = await readChainCards(deps.rpc, [{ owner, cardId: BigInt(row.card_id) }]);
    if (!chain?.card) throw new HttpError(409, "card is not registered onchain", "not_onchain");
    if (row.issue_state === "onchain_pending" || row.issue_state === "failed") await deps.store.updateCard(cardPda, { issue_state: "onchain_confirmed" }, row.issue_state);
    row = await ownedCard(deps.store, wallet, cardPda);
    if (row.issue_state !== "onchain_confirmed" && row.issue_state !== "lithic_failed") throw new HttpError(409, `nothing to retry (${row.issue_state})`, "invalid_state");
    if (!(await deps.store.rateLimit(`retry:${wallet}`, 3600, 10))) throw new HttpError(429, "too many retries", "rate_limited");
    await issueLithicCard(deps, row);
    row = await ownedCard(deps.store, wallet, cardPda);
    return respond(api.RetryIssueResponse, { card: toCardView(row, chain, Date.now()) });
  } catch (e) {
    return errorResponse(e);
  }
}
