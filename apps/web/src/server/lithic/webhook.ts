// Lithic webhook signatures (ASA + Events use the same Svix-style scheme; CP0b S2 verified on real
// sandbox ASA traffic): HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`, keyed with the
// BASE64-DECODED part after `whsec_`; header `webhook-signature: v1,<b64> [v1,<b64> …]`; ±5 min tolerance.
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_SECS = 300;

export type WebhookCheck = { ok: true; id: string; ts: number } | { ok: false; reason: "missing_signature_headers" | "stale_timestamp" | "bad_signature" };

const keyOf = (secret: string) => Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");

export function verifyLithicWebhook(secret: string, headers: Headers, rawBody: string, nowMs: number): WebhookCheck {
  const id = headers.get("webhook-id") ?? "";
  const tsRaw = headers.get("webhook-timestamp") ?? "";
  const sig = headers.get("webhook-signature") ?? "";
  if (!id || !tsRaw || !sig) return { ok: false, reason: "missing_signature_headers" };
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > WEBHOOK_TOLERANCE_SECS) return { ok: false, reason: "stale_timestamp" };
  const mac = createHmac("sha256", keyOf(secret)).update(`${id}.${tsRaw}.${rawBody}`).digest();
  const given = sig.split(" ").map((s) => s.split(",")[1]).filter((b): b is string => !!b).map((b) => Buffer.from(b, "base64"));
  return given.some((g) => g.length === mac.length && timingSafeEqual(g, mac)) ? { ok: true, id, ts } : { ok: false, reason: "bad_signature" };
}

/** Sign like Lithic (MOCK harness + tests only). */
export function signLikeLithic(secret: string, id: string, ts: string, body: string): string {
  return `v1,${createHmac("sha256", keyOf(secret)).update(`${id}.${ts}.${body}`).digest("base64")}`;
}
