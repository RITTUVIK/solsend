// QuickNode Streams webhook authentication (CP0b G0.7, verified live):
//   x-qn-signature = hex(HMAC-SHA256(security_token, x-qn-nonce + x-qn-timestamp + rawBody))
// Pure functions: no env or store access, so they are trivially unit-testable.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const QN_TOLERANCE_MS = 5 * 60_000;

export function signQuickNode(token: string, nonce: string, timestamp: string, body: string): string {
  return createHmac("sha256", Buffer.from(token)).update(Buffer.from(nonce + timestamp + body)).digest("hex");
}

/** Timing-safe HMAC check. Malformed / wrong-length signatures return false without throwing. */
export function verifyQuickNodeSignature(token: string, nonce: string, timestamp: string, body: string, signature: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", Buffer.from(token)).update(Buffer.from(nonce + timestamp + body)).digest();
  return timingSafeEqual(Buffer.from(signature, "hex"), expected);
}

/** Accepts unix seconds or milliseconds; rejects anything more than ±5 min from `nowMs`. */
export function timestampFresh(timestamp: string, nowMs = Date.now()): boolean {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return false;
  const ms = n > 1e12 ? n : n * 1000;
  return Math.abs(nowMs - ms) <= QN_TOLERANCE_MS;
}
