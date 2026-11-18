// Demo Merchant core (F7). SANDBOX ONLY. Pure orchestration with injected deps so it is unit-testable.
// Flow: guard -> rate-limit -> Lithic simulate/authorize (PAN in memory only) -> poll our `authorizations` row
// (written by the ASA path) -> fall back to the Lithic transaction -> DemoCheckoutResponse (label SANDBOX).
import "server-only";
import { api, DEMO_MERCHANTS, explorerTx } from "@solsend/shared";
import type { z } from "zod";
import { HttpError } from "../auth";
import type { Store } from "../store";
import type { LithicSim } from "./lithic-sim";

type Sim = Pick<LithicSim, "authorize" | "voidTransaction" | "transaction">;
export type DemoDeps = {
  store: Store; sim: Sim; wallet: string; enabled: boolean; maxCents: number;
  /** Settlement-authority balance in lamports (cached ~30 s by the caller); null = unknown. Omitted in unit tests. */
  settlerLamports?: () => Promise<number | null>;
  sleep?: (ms: number) => Promise<void>; now?: () => number; pollMs?: number;
};
const defSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const VOID_NOTE = "USDC returned to your wallet. This card's spending limit stays used.";
export const CHECKOUT_POLL_MS = 6_000;
export const VOID_POLL_MS = 8_000;

/** audit M4: each approved demo swipe costs the settlement authority a permanent SettlementRecord rent. */
export const DEMO_MIN_CENTS = 100;
export const DEMO_MIN_SETTLER_LAMPORTS = 30_000_000; // 0.03 SOL: below this the demo pauses; the ASA path keeps working

async function limits(store: Store, wallet: string) {
  if (!(await store.rateLimit(`demo:w:${wallet}`, 60, 10))) throw new HttpError(429, "too many demo checkouts, slow down", "rate_limited");
  if (!(await store.rateLimit("demo:global", 60, 60))) throw new HttpError(429, "demo merchant is busy, try again shortly", "rate_limited");
}
/** Checkout-only caps on top of the per-minute ones: 30/day per wallet, 120/hour globally. */
async function checkoutLimits(store: Store, wallet: string) {
  await limits(store, wallet);
  if (!(await store.rateLimit(`demo:wd:${wallet}`, 86_400, 30))) throw new HttpError(429, "daily demo checkout limit reached for this wallet", "rate_limited");
  if (!(await store.rateLimit("demo:gh", 3600, 120))) throw new HttpError(429, "demo merchant hourly limit reached, try later", "rate_limited");
}

export async function demoCheckout(input: unknown, d: DemoDeps): Promise<api.TDemoCheckoutResponse> {
  const now = d.now ?? Date.now, sleep = d.sleep ?? defSleep;
  if (!d.enabled) throw new HttpError(403, "demo merchant disabled", "demo_disabled");
  const parsed = api.DemoCheckoutRequest.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "invalid request", "bad_request");
  const { cardPda, merchant, amountCents } = parsed.data;
  if (amountCents > d.maxCents) throw new HttpError(400, `amount exceeds demo maximum (${d.maxCents} cents)`, "amount_too_large");
  if (amountCents < DEMO_MIN_CENTS) throw new HttpError(400, `amount below demo minimum (${DEMO_MIN_CENTS} cents)`, "amount_too_small");

  const card = await d.store.getCard(cardPda);
  if (!card || card.owner_wallet !== d.wallet) throw new HttpError(404, "card not found", "not_found");
  if (card.issue_state !== "issued" || !card.lithic_card_token) throw new HttpError(409, "card is not issued yet", "card_not_issued");
  if (d.settlerLamports) {
    const l = await d.settlerLamports().catch(() => null);
    if (l === null || l < DEMO_MIN_SETTLER_LAMPORTS) throw new HttpError(503, "demo merchant paused: settlement authority low on devnet SOL", "demo_paused_low_sol");
  }
  await checkoutLimits(d.store, d.wallet);

  const m = DEMO_MERCHANTS[merchant];
  const started = now();
  const txToken = await d.sim.authorize(card.lithic_card_token, { amountCents, descriptor: m.descriptor, mcc: m.mcc, acceptorId: m.acceptorId });

  // Poll the row the ASA path writes after it replies (Vercel waitUntil), then fall back to Lithic.
  let row = await d.store.getAuthorization(txToken);
  const deadline = started + (d.pollMs ?? CHECKOUT_POLL_MS);
  while ((!row || row.decision === "PENDING") && now() < deadline) { await sleep(250); row = await d.store.getAuthorization(txToken); }

  let decision: "APPROVED" | "DECLINED" = "DECLINED";
  let reason: string | null = null, lithicResult: string | null = null, settleSig: string | null = null;
  if (row && row.decision !== "PENDING") {
    decision = row.decision === "APPROVED" ? "APPROVED" : "DECLINED";
    reason = decision === "APPROVED" ? null : (row.reason || row.decision);
    settleSig = row.settle_signature;
  }
  if (!row || row.decision === "PENDING") {
    const tx = await d.sim.transaction(txToken);
    lithicResult = tx?.result ?? null;
    decision = tx?.result === "APPROVED" ? "APPROVED" : "DECLINED";
    reason = decision === "APPROVED" ? null : (tx?.events?.[0]?.detailed_results?.find((r) => r !== "APPROVED") ?? (lithicResult && lithicResult !== "APPROVED" ? lithicResult : "Declined by card-network safety limit (sandbox)"));
  } else {
    // authorizations.decision is the ASA result code we replied with (APPROVED | INSUFFICIENT_FUNDS | VELOCITY_EXCEEDED |
    // CARD_PAUSED | UNAUTHORIZED_MERCHANT | SUSPECTED_FRAUD); the UI maps these codes to human copy.
    lithicResult = row.decision;
  }

  let remaining: string | null = null;
  if (settleSig) {
    try { remaining = (await d.store.listFeed({ cardPda, limit: 10 })).find((f) => f.signature === settleSig && f.remaining_base)?.remaining_base ?? null; } catch { /* feed is best-effort */ }
  }
  return api.DemoCheckoutResponse.parse({
    lithicToken: txToken, decision, lithicResult, reason, settleSignature: settleSig, explorer: settleSig ? explorerTx(settleSig) : null,
    remainingBase: remaining, latencyMs: now() - started, label: "SANDBOX",
  });
}

export async function demoVoid(input: unknown, d: DemoDeps): Promise<z.infer<typeof api.DemoVoidResponse>> {
  const now = d.now ?? Date.now, sleep = d.sleep ?? defSleep;
  if (!d.enabled) throw new HttpError(403, "demo merchant disabled", "demo_disabled");
  const parsed = api.DemoVoidRequest.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "invalid request", "bad_request");
  const { lithicToken } = parsed.data;

  const row = await d.store.getAuthorization(lithicToken);
  const card = row?.card_pda ? await d.store.getCard(row.card_pda) : null;
  if (!row || !card || card.owner_wallet !== d.wallet) throw new HttpError(404, "authorization not found", "not_found");
  await limits(d.store, d.wallet);

  await d.sim.voidTransaction(lithicToken);
  const deadline = now() + (d.pollMs ?? VOID_POLL_MS);
  let cur = await d.store.getAuthorization(lithicToken);
  while (!cur?.refund_signature && now() < deadline) { await sleep(400); cur = await d.store.getAuthorization(lithicToken); }
  const status = (await d.sim.transaction(lithicToken))?.status ?? cur?.lithic_final_status ?? "UNKNOWN";
  const sig = cur?.refund_signature ?? null;
  return api.DemoVoidResponse.parse({ lithicStatus: status, refundSignature: sig, explorer: sig ? explorerTx(sig) : null, note: VOID_NOTE });
}
