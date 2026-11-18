// POST /api/wallet/faucet → FaucetResponse ("devnet test USDC", 1/wallet/hour + global cap).
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { connection, faucetKey } from "@/server/keys";
import { getStore } from "@/server/store";
import { respond } from "@/server/lib/http";
import { realClock } from "@/server/solana/rpc";
import { claimFaucet } from "@/server/wallet/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    let faucet;
    try { faucet = faucetKey(); } catch { throw new HttpError(503, "faucet not configured", "not_configured"); }
    return respond(api.FaucetResponse, await claimFaucet({ rpc: connection(), store: getStore(), faucet, clock: realClock, amountBase: env().FAUCET_AMOUNT_BASE }, wallet));
  } catch (e) {
    return errorResponse(e);
  }
}
