// GET /api/wallet → WalletResponse (USDC + SOL balances, Allowances SA readiness, ATA delegate health).
import { api } from "@solsend/shared";
import { errorResponse, requireUser } from "@/server/auth";
import { connection } from "@/server/keys";
import { respond } from "@/server/lib/http";
import { walletView } from "@/server/wallet/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    return respond(api.WalletResponse, await walletView(connection(), wallet));
  } catch (e) {
    return errorResponse(e);
  }
}
