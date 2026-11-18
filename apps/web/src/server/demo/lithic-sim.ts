// Minimal Lithic SANDBOX client for the Demo Merchant (F7). SANDBOX ONLY: refuses any host but https://sandbox.lithic.com.
// PCI hygiene: the sandbox PAN is read into a closure, used for exactly one simulate call and dropped. It is never
// returned, logged, stored, or included in an error message (all error text is scrubbed).
import "server-only";
import { LITHIC_SANDBOX_BASE, LithicTransactionZ } from "@solsend/shared";
import { HttpError } from "../auth";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

/** Strip anything that looks like a card number (13-19 digits, optionally spaced/dashed) plus a known PAN. */
export function scrubText(s: string, knownPan?: string): string {
  let out = s;
  if (knownPan) out = out.split(knownPan).join("[redacted]");
  return out.replace(/\b(?:\d[ -]?){13,19}\b/g, "[redacted]");
}

export class LithicSimError extends HttpError {}

export class LithicSim {
  private readonly base: string;
  constructor(private readonly apiKey: string, opts: { base?: string; fetchImpl?: FetchLike } = {}) {
    const base = opts.base ?? LITHIC_SANDBOX_BASE;
    if (base !== LITHIC_SANDBOX_BASE) throw new Error("refusing non-sandbox Lithic host");
    this.base = base;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  }
  private readonly fetchImpl: FetchLike;

  private async call(method: "GET" | "POST", path: string, body?: unknown, pan?: string): Promise<any> {
    const url = this.base + path;
    if (!url.startsWith(LITHIC_SANDBOX_BASE + "/")) throw new Error("refusing non-sandbox Lithic host");
    let res;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { Authorization: this.apiKey, "content-type": "application/json", accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new LithicSimError(502, "lithic sandbox unreachable", "lithic_unreachable");
    }
    const text = await res.text();
    if (!res.ok) {
      let code = "";
      try { const j = JSON.parse(text) as { message?: unknown; code?: unknown }; code = String(j.code ?? j.message ?? ""); } catch { /* non-JSON */ }
      throw new LithicSimError(502, `lithic sandbox HTTP ${res.status}${code ? `: ${scrubText(code, pan).slice(0, 80)}` : ""}`, "lithic_error");
    }
    try { return text ? JSON.parse(text) : {}; } catch { throw new LithicSimError(502, "lithic sandbox returned invalid JSON", "lithic_error"); }
  }

  /** Reads the card number into a closure (the only reference). Callers must not store the result. */
  private async panOf(cardToken: string): Promise<() => string> {
    const card = await this.call("GET", `/v1/cards/${encodeURIComponent(cardToken)}`);
    const pan = typeof card?.pan === "string" ? card.pan : "";
    if (!pan) throw new LithicSimError(502, "lithic sandbox did not return a card number", "lithic_error");
    return () => pan;
  }

  /** simulate/authorize against a sandbox card. Returns the Lithic transaction token. */
  async authorize(cardToken: string, p: { amountCents: number; descriptor: string; mcc: string; acceptorId: string }): Promise<string> {
    const getPan = await this.panOf(cardToken);
    const r = await this.call("POST", "/v1/simulate/authorize", {
      amount: p.amountCents, descriptor: p.descriptor.slice(0, 25), pan: getPan(), mcc: p.mcc, merchant_acceptor_id: p.acceptorId,
    }, getPan());
    if (typeof r?.token !== "string") throw new LithicSimError(502, "lithic sandbox returned no transaction token", "lithic_error");
    return r.token;
  }

  async voidTransaction(txToken: string, amountCents?: number): Promise<void> {
    await this.call("POST", "/v1/simulate/void", { token: txToken, type: "AUTHORIZATION_REVERSAL", ...(amountCents ? { amount: amountCents } : {}) });
  }

  /** GET /v1/transactions/{token}; null if Lithic does not know it (yet). */
  async transaction(txToken: string) {
    try {
      const j = await this.call("GET", `/v1/transactions/${encodeURIComponent(txToken)}`);
      const r = LithicTransactionZ.safeParse(j);
      return r.success ? r.data : null;
    } catch { return null; }
  }
}
