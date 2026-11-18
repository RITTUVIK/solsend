// POST /api/tx/submit {intentId, signedTxBase64} → SubmitTxResponse (confirmed: true).
// The fee payer cosigns only a message byte-identical to the stored, unexpired, atomically consumed intent
// with a valid owner signature (CP0b G0.8, docs/TRUST.md).
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { cardDeps } from "@/server/deps";
import { readJson, respond } from "@/server/lib/http";
import { submitTx } from "@/server/tx/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    const body = await readJson(req, api.SubmitTxRequest);
    const deps = cardDeps();
    if (!(await deps.store.rateLimit(`submit:${wallet}`, 3600, 30))) throw new HttpError(429, "too many transactions this hour", "rate_limited");
    return respond(api.SubmitTxResponse, await submitTx(deps, wallet, body));
  } catch (e) {
    return errorResponse(e);
  }
}
