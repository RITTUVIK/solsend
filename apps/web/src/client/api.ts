// Typed fetch wrapper over the FROZEN api.ROUTES contract. Every response is validated with the shared zod schemas.
// Adds the Privy bearer token and transparently runs the one-time wallet bind on 403 `wallet_unbound`.
import { api } from "@solsend/shared";
import type { z } from "zod";
import { MOCK } from "./config";
import { getBridge } from "./session";
import { mockRequest } from "./mock";
import { b64ToBytes, bytesToB64 } from "./format";
import { setSignNotice } from "./notice";

export class ApiCallError extends Error {
  constructor(public status: number, message: string, public code?: string, public body?: unknown) { super(message); this.name = "ApiCallError"; }
}

/** Human copy for any thrown value. Never leaks internals. */
export function humanError(e: unknown): string {
  if (e instanceof ApiCallError) {
    switch (e.code) {
      case "unauthenticated": return "Your session expired. Please log in again.";
      case "rate_limited": return e.message || "Too many tries. Please wait a bit and try again.";
      case "intent_expired": return "That request timed out before it was signed. Please try again.";
      case "tx_expired": return "The network moved on before you signed. Please try again.";
      case "setup_required": return "Your wallet needs a one-time setup before it can make cards.";
    }
    if (e.status === 0) return e.message;
    if (e.status >= 500) return "SolSend hit a snag on our side. Nothing was lost. Try again in a moment.";
    return e.message || "Something went wrong. Please try again.";
  }
  if (e instanceof Error && e.message) {
    if (/reject|denied|cancel/i.test(e.message)) return "Signing was cancelled. Nothing was sent.";
    return e.message;
  }
  return "Something went wrong. Please try again.";
}

interface CallOpts { params?: Record<string, string>; query?: Record<string, string | undefined>; body?: unknown; noAuth?: boolean }

let binding: Promise<void> | null = null;
/** F1: fetch the exact message from GET /api/auth/bind?wallet= (server owns the nonce format), sign THAT string, POST it. Deduped. */
async function ensureBound(): Promise<void> {
  binding ??= (async () => {
    const s = getBridge();
    if (!s.wallet) throw new ApiCallError(0, "Your wallet isn't ready yet. Give it a second and try again.");
    const m = api.BindMessageResponse.safeParse(await raw("bindMessage", { query: { wallet: s.wallet } }, false));
    if (!m.success) throw new ApiCallError(502, "SolSend sent a response we couldn't understand. Please try again.", "bad_response");
    const sig = await s.signMsg(new TextEncoder().encode(m.data.message));
    await raw("bindWallet", { body: { wallet: s.wallet, message: m.data.message, signatureBase64: bytesToB64(sig) } satisfies z.infer<typeof api.BindWalletRequest> }, false);
  })().finally(() => { binding = null; });
  return binding;
}

async function raw(route: keyof typeof api.ROUTES, o: CallOpts, allowBind: boolean): Promise<unknown> {
  const r = api.ROUTES[route];
  let path: string = r.path;
  for (const [k, v] of Object.entries(o.params ?? {})) path = path.replace(`[${k}]`, encodeURIComponent(v));
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(o.query ?? {})) if (v != null) qs.set(k, v);
  const token = o.noAuth ? null : await getBridge().getAccessToken();
  let status: number;
  let json: unknown;
  if (MOCK) {
    ({ status, json } = await mockRequest({ method: r.method, path, query: qs, body: o.body, hasToken: !!token || !!o.noAuth }));
  } else {
    const headers: Record<string, string> = {};
    if (o.body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(qs.size ? `${path}?${qs}` : path, { method: r.method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, cache: "no-store" });
    } catch {
      throw new ApiCallError(0, "Can't reach SolSend. Check your connection and try again.", "network");
    }
    status = res.status;
    json = await res.json().catch(() => null);
  }
  if (status >= 200 && status < 300) return json;
  const e = api.ApiError.safeParse(json);
  if (status === 403 && e.success && e.data.code === "wallet_unbound" && allowBind) {
    await ensureBound();
    return raw(route, o, false);
  }
  throw new ApiCallError(status, e.success ? e.data.error : "Request failed", e.success ? e.data.code : undefined, json);
}

async function call<S extends z.ZodType>(route: keyof typeof api.ROUTES, schema: S, o: CallOpts = {}): Promise<z.infer<S>> {
  const json = await raw(route, o, true);
  const p = schema.safeParse(json);
  if (!p.success) throw new ApiCallError(502, "SolSend sent a response we couldn't understand. Please try again.", "bad_response");
  return p.data;
}

const pda = (cardPda: string) => ({ cardPda });

export const client = {
  wallet: () => call("wallet", api.WalletResponse),
  /** One-time: creates the Allowances SubscriptionAuthority. Must confirm before the first card. */
  walletSetup: () => call("walletSetup", api.PreparedTx, { body: {} }),
  faucet: () => call("faucet", api.FaucetResponse, { body: {} }),
  listCards: async () => (await call("listCards", api.ListCardsResponse)).cards,
  prepareCard: (body: z.infer<typeof api.PrepareCardRequest>) => call("prepareCard", api.PrepareCardResponse, { body }),
  cardAction: (cardPda: string, action: z.infer<typeof api.CardActionRequest>["action"]) => call("cardAction", api.PreparedTx, { params: pda(cardPda), body: { action } }),
  revokeAll: () => call("revokeAll", api.RevokeAllResponse, { body: {} }),
  retryIssue: async (cardPda: string) => (await call("retryIssue", api.RetryIssueResponse, { params: pda(cardPda), body: {} })).card,
  embed: (cardPda: string) => call("embed", api.EmbedSessionResponse, { params: pda(cardPda), body: {} }),
  submitTx: (body: z.infer<typeof api.SubmitTxRequest>) => call("submitTx", api.SubmitTxResponse, { body }),
  feed: async (cardPda?: string) => (await call("feed", api.FeedResponse, { query: { cardPda } })).rows,
  checkout: (body: z.infer<typeof api.DemoCheckoutRequest>) => call("demoCheckout", api.DemoCheckoutResponse, { body }),
  void: (lithicToken: string) => call("demoVoid", api.DemoVoidResponse, { body: { lithicToken } }),
  status: () => call("status", api.StatusResponse, { noAuth: true }),
};

export const SIGN_RETRY_NOTICE = "Signing took a little long — please approve once more";
type Prepared = z.infer<typeof api.PreparedTx>;
const retryable = (e: unknown): boolean => e instanceof ApiCallError && (e.code === "tx_expired" || e.code === "intent_expired");

/**
 * prepare → Privy owner-sign → server cosigns + sends (waits for `confirmed`).
 * If the network moved on before the user signed (409 tx_expired, or our local intent expiry), the SAME prepare call is re-run
 * ONCE (new intent + fresh blockhash) and the user signs again. Max one automatic retry; then the error surfaces.
 */
export async function signAndSubmit<P extends Prepared>(
  prepare: () => Promise<P>,
  o: { onPrepared?: (p: P) => void; onSigned?: () => void } = {},
): Promise<z.infer<typeof api.SubmitTxResponse> & { prepared: P }> {
  const attempt = async () => {
    const p = await prepare();
    o.onPrepared?.(p);
    if (Date.now() > new Date(p.expiresAt).getTime()) throw new ApiCallError(410, "That request timed out before it was signed. Please try again.", "intent_expired");
    const signed = await getBridge().signTx(b64ToBytes(p.txBase64));
    o.onSigned?.();
    const r = await client.submitTx({ intentId: p.intentId, signedTxBase64: bytesToB64(signed) });
    return { ...r, prepared: p };
  };
  try {
    return await attempt();
  } catch (e) {
    if (!retryable(e)) throw e;
    setSignNotice(SIGN_RETRY_NOTICE);
    try { return await attempt(); } finally { setSignNotice(null); }
  }
}
