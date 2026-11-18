// POST /api/cards/[cardPda]/embed → EmbedSessionResponse (+ `iframes` per field). Lithic's hosted iframe
// renders PAN/CVV/expiry in the browser; the card number never touches our server. The returned URLs are
// short-lived bearer capabilities for the owner only — never logged.
import { api } from "@solsend/shared";
import { HttpError, errorResponse, requireUser } from "@/server/auth";
import { cardDeps } from "@/server/deps";
import { ownedCard } from "@/server/cards/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMBED_TTL_SECS = 300;

function targetOrigin(req: Request): string | null {
  const o = req.headers.get("origin");
  if (!o) return null;
  try {
    const u = new URL(o);
    return u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1" ? u.origin : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ cardPda: string }> }): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    const { cardPda } = await ctx.params;
    const deps = cardDeps();
    const row = await ownedCard(deps.store, wallet, cardPda);
    if (row.issue_state !== "issued" || !row.lithic_card_token) throw new HttpError(409, "card is not issued yet", "not_issued");
    if (!(await deps.store.rateLimit(`embed:${wallet}`, 600, 20))) throw new HttpError(429, "too many card reveals", "rate_limited");
    const s = await deps.lithic.createEmbed(row.lithic_card_token, { targetOrigin: targetOrigin(req), ttlSecs: EMBED_TTL_SECS, nowMs: Date.now() });
    // Modern flow: the browser SDK (lithic-embed) needs the session itself to mount Lithic's iframes and reveal them
    // (they render MASKED until toggleMasking()). Same owner-only bearer capability as the iframe URLs; never logged.
    const body = api.EmbedSessionResponse.parse({ iframeUrl: s.iframeUrl, expiresAt: s.expiresAt, iframes: s.iframes, flow: s.flow, ...(s.session ? { session: s.session } : {}) });
    return Response.json({ ...body, sandbox: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
