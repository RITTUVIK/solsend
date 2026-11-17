// Minimal raw-HTTP clients for Stripe (form-encoded) and Bridge (JSON).
// Raw HTTP on purpose: `crypto_wallet` / `crypto_transactions` are private-preview
// fields that the public stripe-node SDK does not type, and we need explicit
// control over the Stripe-Version header to find which version exposes them.
import { randomUUID } from "node:crypto";
import { BRIDGE_BASE_URL, bridgeKey, optEnv, stripeKey } from "./env.js";
import { saveRaw } from "./evidence.js";

export class ProviderError extends Error {
  constructor(
    readonly provider: "stripe" | "bridge",
    readonly status: number,
    readonly body: unknown,
    readonly requestId: string | null,
  ) {
    super(`${provider} HTTP ${status}: ${JSON.stringify(body).slice(0, 600)}`);
  }
}

// ── Stripe ──────────────────────────────────────────────────────────────────
type Params = Record<string, unknown>;

function formEncode(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") formEncode(item as Params, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === "object") {
      formEncode(v as Params, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

export const STRIPE_API_VERSION = optEnv("STRIPE_API_VERSION"); // unset = account default
export const STRIPE_PREVIEW_VERSION = optEnv("STRIPE_PREVIEW_VERSION") ?? "2026-10-28.preview";

export async function stripe<T = Record<string, any>>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Params = {},
  opts: { version?: string | null; idempotencyKey?: string; label?: string } = {},
): Promise<T> {
  const version = opts.version === null ? undefined : (opts.version ?? STRIPE_API_VERSION);
  const headers: Record<string, string> = { Authorization: `Bearer ${stripeKey()}` };
  if (version) headers["Stripe-Version"] = version;
  let url = `https://api.stripe.com${path}`;
  let body: string | undefined;
  if (method === "GET") {
    const qs = formEncode(params).toString();
    if (qs) url += `?${qs}`;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    headers["Idempotency-Key"] = opts.idempotencyKey ?? randomUUID();
    body = formEncode(params).toString();
  }
  const res = await fetch(url, { method, headers, body });
  const json = (await res.json()) as T;
  saveRaw(`stripe-${opts.label ?? path.replace(/\W+/g, "_")}`, { method, path, version: version ?? "(account default)", status: res.status, json });
  if (!res.ok) throw new ProviderError("stripe", res.status, json, res.headers.get("request-id"));
  return json;
}

// ── Bridge ─────────────────────────────────────────────────────────────────
export async function bridge<T = Record<string, any>>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string; label?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Api-Key": bridgeKey(), Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = opts.idempotencyKey ?? randomUUID();
  }
  const res = await fetch(`${BRIDGE_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { non_json_body: text.slice(0, 2000) };
  }
  saveRaw(`bridge-${opts.label ?? path.replace(/\W+/g, "_")}`, { method, path, status: res.status, json });
  if (!res.ok) throw new ProviderError("bridge", res.status, json, res.headers.get("x-request-id"));
  return json as T;
}

// ── Stripe Issuing helpers shared by G0.3–G0.6 ────────────────────────────
export type CryptoTx = {
  type?: string;
  crypto_transaction_confirmed?: { transaction_hash?: string; amount?: string; from_address?: string; to_address?: string; confirmed_at?: number; chain?: string };
  crypto_transaction_failed?: { transaction_hash?: string | null; failure_reason?: string; failed_at?: number };
};

/** Retrieve an authorization, trying the configured version, then the preview version, for crypto_transactions. */
export async function getAuthorizationWithCrypto(id: string) {
  const plain = await stripe("GET", `/v1/issuing/authorizations/${id}`, {}, { label: "get_auth" });
  if (Array.isArray(plain.crypto_transactions)) return { auth: plain, versionUsed: STRIPE_API_VERSION ?? "(account default)" };
  const preview = await stripe("GET", `/v1/issuing/authorizations/${id}`, {}, { version: STRIPE_PREVIEW_VERSION, label: "get_auth_preview" });
  return { auth: preview, versionUsed: STRIPE_PREVIEW_VERSION };
}

export function confirmedHashes(auth: Record<string, any>): string[] {
  const txs = (auth.crypto_transactions ?? []) as CryptoTx[];
  return txs
    .filter((t) => t.type === "crypto_transaction_confirmed" && t.crypto_transaction_confirmed?.transaction_hash)
    .map((t) => t.crypto_transaction_confirmed!.transaction_hash!);
}

export function failedCrypto(auth: Record<string, any>) {
  return ((auth.crypto_transactions ?? []) as CryptoTx[]).filter((t) => t.type === "crypto_transaction_failed");
}

/** Sandbox merchant for every simulated purchase. Labeled "(sandbox)" per hard rule 3. */
export const SANDBOX_MERCHANT = {
  name: "SolSend G0 Test Merchant (sandbox)",
  category: "computer_software_stores", // no reserve category (avoid 20% hold uplift)
  city: "Vancouver",
  country: "CA",
};

export async function simulateAuthorization(cardId: string, amountCents: number, label: string) {
  return stripe(
    "POST",
    "/v1/test_helpers/issuing/authorizations",
    { card: cardId, amount: amountCents, currency: "usd", merchant_data: SANDBOX_MERCHANT },
    { label },
  );
}

/** Create a virtual card backed by a Solana USDC wallet. Tries account default, then preview version. */
export async function createCryptoCard(cardholder: string, walletAddress: string, nickname: string) {
  const params = {
    cardholder,
    currency: "usd",
    type: "virtual",
    status: "active",
    crypto_wallet: { chain: "solana", currency: "usdc", type: "standard", address: walletAddress },
    metadata: { solsend_spike: "gate0", nickname },
  };
  const attempts: { version: string; ok: boolean; error?: string }[] = [];
  for (const version of [STRIPE_API_VERSION ?? null, STRIPE_PREVIEW_VERSION] as const) {
    try {
      const card = await stripe("POST", "/v1/issuing/cards", params, { version, label: `create_card_${nickname}` });
      attempts.push({ version: version ?? "(account default)", ok: true });
      return { card, attempts };
    } catch (e) {
      const msg = e instanceof ProviderError ? JSON.stringify(e.body).slice(0, 400) : String(e);
      attempts.push({ version: version ?? "(account default)", ok: false, error: msg });
    }
  }
  return { card: undefined, attempts };
}

/** Public, non-sensitive card fields only (hard rule 7: never PAN/CVC). */
export function cardSummary(card: Record<string, any>) {
  return {
    id: card.id,
    last4: card.last4,
    exp: `${card.exp_month}/${card.exp_year}`,
    status: card.status,
    cardholder: typeof card.cardholder === "string" ? card.cardholder : card.cardholder?.id,
    crypto_wallet: card.crypto_wallet ?? "(field not returned)",
  };
}
