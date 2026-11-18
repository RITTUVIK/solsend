// POST /api/wallet/setup → PreparedTx: create the USDC ATA (if missing) + Allowances SubscriptionAuthority.
// Needed once per wallet before the first card: Allowances sets SA init_id = creation slot, so the SA can't
// be created in the same tx as a delegation that must name that init_id (devnet simulation: Custom 136).
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { cardDeps } from "@/server/deps";
import { respond } from "@/server/lib/http";
import { prepareWalletSetup } from "@/server/cards/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    const deps = cardDeps();
    if (!(await deps.store.rateLimit(`setup:${wallet}`, 86_400, 5))) throw new HttpError(429, "too many setup attempts today", "rate_limited");
    return respond(api.PreparedTx, await prepareWalletSetup(deps, wallet));
  } catch (e) {
    return errorResponse(e);
  }
}
