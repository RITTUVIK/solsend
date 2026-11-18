// LEAD-OWNED CONTRACT (W2 may harden internals; signatures are frozen).
// Privy access token (ES256 JWT) verified against Privy's JWKS; wallet bound once via an ed25519
// signature over BindMessage. Routes get `wallet` from here — NEVER from the request body.
import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { api } from "@solsend/shared";
import { getStore } from "./store";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const appId = () => {
  const id = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!id) throw new HttpError(500, "auth not configured");
  return id;
};

/** Verifies `Authorization: Bearer <privy access token>`; returns the Privy user id (DID). */
export async function verifyPrivyToken(req: Request): Promise<string> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "missing bearer token", "unauthenticated");
  const id = appId();
  jwks ??= createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${id}/jwks.json`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: "privy.io", audience: id });
    if (typeof payload.sub !== "string") throw new Error("no sub");
    return payload.sub;
  } catch {
    throw new HttpError(401, "invalid session", "unauthenticated");
  }
}

/** Authenticated + wallet-bound user. 403 `wallet_unbound` → client must call POST /api/auth/bind. */
export async function requireUser(req: Request): Promise<{ userId: string; privyUserId: string; wallet: string }> {
  const privyUserId = await verifyPrivyToken(req);
  const user = await getStore().getUserByPrivyId(privyUserId);
  if (!user) throw new HttpError(403, "wallet not bound", "wallet_unbound");
  return { userId: user.id, privyUserId, wallet: user.wallet };
}

/** Verify the bind signature (ed25519 over the exact BindMessage). Nonce = Privy user id + 10-min time bucket. */
export function verifyBindSignature(privyUserId: string, body: { wallet: string; message: string; signatureBase64: string }): boolean {
  const bucket = Math.floor(Date.now() / 600_000);
  const valid = [bucket, bucket - 1].some((b) => body.message === api.BindMessage(body.wallet, `${privyUserId}:${b}`));
  if (!valid) return false;
  try {
    const sig = Uint8Array.from(atob(body.signatureBase64), (c) => c.charCodeAt(0));
    return nacl.sign.detached.verify(new TextEncoder().encode(body.message), sig, new PublicKey(body.wallet).toBytes());
  } catch {
    return false;
  }
}

/** Uniform JSON error response for route handlers (never leaks internals/secrets). */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  console.error("[api] unhandled:", e instanceof Error ? e.message : "unknown");
  return Response.json({ error: "internal error" }, { status: 500 });
}
