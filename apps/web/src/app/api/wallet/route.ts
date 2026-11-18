// GET /api/wallet → WalletResponse (USDC + SOL balances, Allowances SA readiness, ATA delegate health).
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { getStore } from "@/server/store";
import { connection } from "@/server/keys";
import { respond } from "@/server/lib/http";
import { walletView } from "@/server/wallet/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    if (!(await getStore().rateLimit(`read:wallet:${wallet}`, 60, 30))) throw new HttpError(429, "too many wallet requests, slow down", "rate_limited");
    return respond(api.WalletResponse, await walletView(connection(), wallet));
  } catch (e) {
    return errorResponse(e);
  }
}
