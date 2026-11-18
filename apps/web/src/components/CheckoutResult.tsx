"use client";
import { useEffect, useState } from "react";
import type { z } from "zod";
import type { api } from "@solsend/shared";
import { client, humanError } from "@/client/api";
import { FEED_POLL_MS } from "@/client/config";
import { usePoll } from "@/client/hooks";
import { declineCopy, sandboxName, usd } from "@/client/format";
import { ErrorNote, SandboxChip, SigLink, Spinner } from "./ui";

export const VOID_MESSAGE = "USDC returned to your wallet. This card's spending limit stays used — create a new card to spend more.";
type Checkout = z.infer<typeof api.DemoCheckoutResponse>;
type Voided = z.infer<typeof api.DemoVoidResponse>;

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{k}</dt>
      <dd className="min-w-0 break-words text-sm sm:text-right">{children}</dd>
    </div>
  );
}

function VoidPanel({ res, cardPda, merchant, onVoided }: { res: Checkout; cardPda: string; merchant: string; onVoided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState<Voided | null>(null);
  const [waited, setWaited] = useState(false);
  // The refund arrives through the reconciler/Lithic webhook, so its signature may come via the live feed.
  const pending = !!v && !v.refundSignature;
  const feed = usePoll(() => client.feed(cardPda), FEED_POLL_MS, pending);
  const fromFeed = feed.data?.find((r) => r.kind === "refunded" && r.lithicToken === res.lithicToken && r.signature);
  const refundSig = v?.refundSignature ?? fromFeed?.signature ?? null;

  useEffect(() => {
    if (!pending || refundSig) return;
    const t = setTimeout(() => setWaited(true), 20_000);
    return () => clearTimeout(t);
  }, [pending, refundSig]);

  async function doVoid() {
    setBusy(true); setErr(null);
    try { setV(await client.void(res.lithicToken)); onVoided(); } catch (e) { setErr(humanError(e)); } finally { setBusy(false); }
  }

  if (!v) {
    return (
      <div className="mt-4">
        <button type="button" onClick={() => void doVoid()} disabled={busy} className="btn-secondary w-full" data-testid="void-btn">
          {busy ? <><Spinner />Voiding…</> : "Void this purchase"}
        </button>
        <p className="mt-1.5 text-center text-xs text-zinc-500">Simulates the store cancelling this {sandboxName(merchant)} order. The refund is sent onchain on devnet.</p>
        {err && <div className="mt-3"><ErrorNote onRetry={() => void doVoid()}>{err}</ErrorNote></div>}
      </div>
    );
  }
  return (
    <div className="anim-rise mt-4 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-500/30 dark:bg-sky-500/10" role="status" data-testid="void-done">
      <p className="font-semibold text-sky-900 dark:text-sky-200">Purchase voided <span className="font-normal">(Lithic status {v.lithicStatus}, sandbox)</span></p>
      {refundSig ? (
        <>
          <div className="mt-1"><SigLink sig={refundSig} label="Refund transaction (devnet)" /></div>
          <p className="mt-2 font-medium text-sky-950 dark:text-sky-100" data-testid="void-message">{VOID_MESSAGE}</p>
        </>
      ) : (
        <p className="mt-1 flex items-center gap-2 text-sky-900 dark:text-sky-200"><Spinner />{waited ? "Still waiting. Refunds can take a few minutes; it will appear in Activity when sent." : "Waiting for the refund transaction…"}</p>
      )}
      <p className="mt-1 text-xs text-sky-900/70 dark:text-sky-200/70">{v.note}</p>
    </div>
  );
}

export function CheckoutResult({ res, cardPda, merchant, amountCents, onVoided }: { res: Checkout; cardPda: string; merchant: string; amountCents: number; onVoided: () => void }) {
  const approved = res.decision === "APPROVED";
  const reason = declineCopy(res.lithicResult, res.reason);
  return (
    <section className={`surface anim-rise mt-5 ${approved ? "border-emerald-300 dark:border-emerald-500/40" : "border-rose-300 dark:border-rose-500/40"}`} aria-live="polite" data-testid="result" data-decision={res.decision}>
      <div className="flex items-center gap-3">
        <span className={`anim-pop grid h-14 w-14 shrink-0 place-items-center rounded-full text-white ${approved ? "bg-emerald-600" : "anim-shake bg-rose-600"}`}>
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {approved ? <path className="anim-draw" d="m5 12.500 4.500 4.500L19 7.500" /> : <path className="anim-draw" d="M6 6l12 12M18 6 6 18" />}
          </svg>
        </span>
        <div className="min-w-0">
          <p className={`text-2xl font-extrabold tracking-tight ${approved ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`} data-testid="decision">{res.decision === "APPROVED" ? "APPROVED" : "DECLINED"}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300" data-testid="reason">
            {approved ? <>{usd(BigInt(amountCents) * 10_000n)} at {sandboxName(merchant)}, settled onchain before approval.</> : <strong>{reason}</strong>}
          </p>
        </div>
      </div>

      <dl className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        <Row k={approved ? "Settle signature (devnet)" : "Onchain evidence (failed settle tx)"}>
          {res.settleSignature
            ? <SigLink sig={res.settleSignature} label={approved ? "View settlement on Explorer" : "View failed tx on Explorer"} />
            : <span className="text-zinc-500" data-testid="no-onchain">{approved ? "Not available" : "No onchain transaction"}</span>}
        </Row>
        <Row k="Lithic token"><span className="inline-flex flex-wrap items-center gap-2"><code className="break-all font-mono text-xs" data-testid="lithic-token">{res.lithicToken}</code><SandboxChip /></span></Row>
        <Row k="Latency"><span className="font-semibold tabular-nums" data-testid="latency">{res.latencyMs} ms</span></Row>
        <Row k="Remaining limit"><span className="font-semibold tabular-nums" data-testid="remaining">{usd(res.remainingBase)}</span></Row>
      </dl>

      {approved && <VoidPanel res={res} cardPda={cardPda} merchant={merchant} onVoided={onVoided} />}
      <p className="mt-3 text-center text-xs text-zinc-500">Sandbox result · no real merchant was charged</p>
    </section>
  );
}
