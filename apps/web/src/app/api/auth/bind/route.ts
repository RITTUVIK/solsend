// F1: bind the Privy user to their embedded Solana wallet (ed25519 over BindMessage).
//   GET  /api/auth/bind?wallet=<pubkey> → { message } (the exact text to sign; nonce = Privy user + 10-min bucket)
//   POST /api/auth/bind { wallet, message, signatureBase64 } → BindWalletResponse
import { api } from "@solsend/shared";
import { HttpError, errorResponse, verifyBindSignature, verifyPrivyToken } from "@/server/auth";
import { getStore } from "@/server/store";
import { readJson, respond } from "@/server/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const privyUserId = await verifyPrivyToken(req);
    const wallet = new URL(req.url).searchParams.get("wallet") ?? "";
    if (!api.Pubkey.safeParse(wallet).success) throw new HttpError(400, "wallet query param required", "bad_request");
    return Response.json({ message: api.BindMessage(wallet, `${privyUserId}:${Math.floor(Date.now() / 600_000)}`) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const privyUserId = await verifyPrivyToken(req);
    const body = await readJson(req, api.BindWalletRequest);
    if (!verifyBindSignature(privyUserId, body)) throw new HttpError(401, "bind signature invalid or expired", "bad_signature");
    let user;
    try {
      user = await getStore().upsertUser(privyUserId, body.wallet);
    } catch {
      throw new HttpError(409, "wallet already bound to another account", "wallet_taken");
    }
    return respond(api.BindWalletResponse, { userId: user.id, wallet: user.wallet });
  } catch (e) {
    return errorResponse(e);
  }
}
