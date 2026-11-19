"use client";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { api } from "@solsend/shared";
import { client } from "@/client/api";
import { FEED_POLL_MS } from "@/client/config";
import { usePoll } from "@/client/hooks";
import { declineCopy, declineStory, sandboxName, usd, type CardView, type DeclineFix } from "@/client/format";
import { voidErrorCopy, voidPurchase, type Voided } from "@/client/void";
import { QN_LATE_MS, QN_WATCH_MS, streamDetail, streamedRow } from "@/client/stream";
import type { FeedRow } from "@/client/format";
import { AllowanceFlow, WalletDelta } from "./AllowanceFlow";
import { CardVisual } from "./CardVisual";
import { ErrorNote, Icon, ProofField, ProofRow, QuickNodeBadge, Sheet, Spinner } from "./ui";

export const VOID_MESSAGE = "USDC returned to your wallet. This card's spending limit stays used — create a new card to spend more.";
type Checkout = z.infer<typeof api.DemoCheckoutResponse>;

export interface PayAttempt {
  card: CardView; merchant: string; merchantLabel: string; amountCents: number; walletBefore: bigint | null;
  res: Checkout | null; error: string | null;
}

/**
 * The hero moment. Opens the instant Pay is tapped (always in view: bottom sheet on mobile, right panel ≥1024px).
 * Phase A: one honest indeterminate indicator (the API is one call: no fake per-stage timings).
 * Phase B: Approved/Declined with outcome first (amount, wallet delta), then a single ProofRow.
 */
export function ApprovalSheet({ attempt, walletNow, onClose, onFix, onVoided }: {
  attempt: PayAttempt | null; walletNow: bigint | null; onClose: () => void; onFix: (f: DeclineFix | "try_amazon") => void; onVoided: () => void;
}) {
  const res = attempt?.res ?? null;
  const approved = res?.decision === "APPROVED";
  const [slow, setSlow] = useState(false);
  const [v, setV] = useState<Voided | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidErr, setVoidErr] = useState<string | null>(null);
  // Freeze the first post-payment wallet value so a later refund doesn't rewrite the "→ $88.00" story.
  const afterRef = useRef<bigint | null>(null);
  const key = attempt ? `${attempt.card.cardPda}:${attempt.amountCents}:${res?.lithicToken ?? "pending"}` : "";
  const keyRef = useRef(key);
  if (keyRef.current !== key) { keyRef.current = key; afterRef.current = null; }
  useEffect(() => { setV(null); setVoidErr(null); setSlow(false); }, [key]);
  if (res && approved && afterRef.current == null && walletNow != null && attempt?.walletBefore != null && walletNow !== attempt.walletBefore) afterRef.current = walletNow;

  useEffect(() => {
    if (!attempt || attempt.res || attempt.error) return;
    const t = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(t);
  }, [attempt]);

  // QuickNode evidence: claim "streamed" only once the webhook's delivery for THIS settle is recorded in the feed.
  const settleSig = approved ? res?.settleSignature ?? null : null;
  const [qnPhase, setQnPhase] = useState<"watch" | "late" | "stopped">("watch");
  useEffect(() => {
    setQnPhase("watch");
    if (!settleSig) return;
    const late = setTimeout(() => setQnPhase("late"), QN_LATE_MS);
    const stop = setTimeout(() => setQnPhase("stopped"), QN_WATCH_MS);
    return () => { clearTimeout(late); clearTimeout(stop); };
  }, [settleSig]);
  const refundPending = !!v && !v.refundSignature;
  const [qnSeen, setQnSeen] = useState<FeedRow | null>(null); // the recorded delivery itself (slot + cross-check)
  useEffect(() => { setQnSeen(null); }, [settleSig]);
  const watchQn = !!settleSig && !qnSeen && qnPhase !== "stopped";
  const feed = usePoll(() => client.feed(attempt?.card.cardPda), FEED_POLL_MS, (refundPending || watchQn) && !!attempt);
  useEffect(() => { const r = qnSeen ? null : streamedRow(feed.data, settleSig); if (r) setQnSeen(r); }, [feed.data, settleSig, qnSeen]);
  const fromFeed = feed.data?.find((r) => r.kind === "refunded" && r.lithicToken === res?.lithicToken && r.signature);
  const refundSig = v?.refundSignature ?? fromFeed?.signature ?? null;

  async function doVoid() {
    if (!res || voidBusy) return;
    setVoidBusy(true); setVoidErr(null);
    try { setV(await voidPurchase(res.lithicToken)); onVoided(); } catch (e) { setVoidErr(voidErrorCopy(e)); } finally { setVoidBusy(false); }
  }

  if (!attempt) return null;
  const amountBase = BigInt(attempt.amountCents) * 10_000n;
  const merchantName = sandboxName(attempt.merchantLabel);
  const lockedTo = attempt.card.kind !== "ONE_TIME" && /^(temu|amazon|netflix)$/i.test(attempt.card.merchantName.trim()) ? attempt.card.merchantName : null;
  const story = res && !approved ? declineStory({ lithicResult: res.lithicResult, reason: res.reason, amountBase, remainingBase: res.remainingBase != null ? BigInt(res.remainingBase) : null, lockedTo, walletBase: attempt.walletBefore }) : null;
  const flowState = !res ? "pulling" : approved ? "done" : "declined";
  const title = !res ? (attempt.error ? "Payment didn't go through" : "Paying…") : approved ? (refundSig ? "Refunded" : v ? "Voided" : "Approved") : "Declined";

  return (
    <Sheet open onClose={onClose} labelledBy="approval-title" variant="side" testId="approval-sheet" dismissible={!!res || !!attempt.error}>
      <div className="space-y-5 pb-1 pt-1">
        {/* Header: card + "Pay Temu (sandbox) $12.00" (Apple HIG: business name on the total line) */}
        <div className="flex items-center gap-3">
          <div className={`w-[92px] shrink-0 ${!res && !attempt.error ? "anim-breathe" : ""}`}><CardVisual card={attempt.card} size="mini" /></div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink-3">Pay {merchantName}</p>
            <p className="tnum text-[34px] font-semibold leading-[38px] tracking-[-0.03em]">{usd(amountBase)}</p>
            <p className="text-[13px] text-ink-3">with •••• {attempt.card.lithic.lastFour ?? "••••"}</p>
          </div>
        </div>

        <AllowanceFlow walletBase={(approved ? afterRef.current : null) ?? attempt.walletBefore}merchant={attempt.merchantLabel} merchantLabel={attempt.merchantLabel} state={attempt.error ? "idle" : flowState} />

        {!res && !attempt.error && (
          <div className="flex items-start gap-3 rounded-[16px] bg-sunken p-3.5" role="status">
            <Spinner className="mt-0.5 h-4.5 w-4.5 shrink-0 text-ink-2" />
            <div>
              <p id="approval-title" className="text-[15px] font-medium text-ink">Settling on Solana before approval…</p>
              {slow && <p className="mt-0.5 text-[13px] text-ink-3">Waiting for devnet confirmation</p>}
            </div>
          </div>
        )}

        {attempt.error && (
          <div className="space-y-3">
            <h2 id="approval-title" className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h2>
            <ErrorNote>{attempt.error}</ErrorNote>
            <button type="button" className="btn-primary w-full" onClick={onClose}>Close</button>
          </div>
        )}

        {res && (
          <section aria-labelledby="approval-title" data-testid="result" data-decision={res.decision} className="space-y-4">
            <div className="flex items-center gap-4">
              <span className={`anim-pop grid h-16 w-16 shrink-0 place-items-center rounded-full ${approved ? "anim-glow bg-ok text-white dark:text-[#04130d]" : `anim-shake ${story?.tone === "warn" ? "bg-warn-bg text-warn" : "bg-no-bg text-no"}`}`}>
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {approved ? <path className="anim-draw" d="m5 12.5 4.5 4.5L19 7.5" /> : <path className="anim-draw" d="M7 7l10 10M17 7 7 17" />}
                </svg>
              </span>
              <div className="min-w-0">
                <h2 id="approval-title" className="text-[28px] font-semibold leading-8 tracking-[-0.03em]" data-testid="decision">{title}</h2>
                <p className="text-[15px] font-medium text-ink-2" data-testid="reason">
                  {approved ? <>{usd(amountBase)} at {merchantName}</> : declineCopy(res.lithicResult, res.reason)}
                </p>
              </div>
            </div>

            {approved ? (
              <div className="stagger flex flex-wrap gap-2">
                <span className="chip h-7 bg-onchain-bg px-2.5 text-[12px] text-onchain-ink"><Icon name="chain" className="h-3.5 w-3.5" strokeWidth={2.2} />Settled onchain first</span>
                <span className="chip h-7 bg-sunken px-2.5 text-[12px] text-ink-2" data-testid="latency"><Icon name="bolt" className="h-3.5 w-3.5" />{res.latencyMs} ms</span>
                <span className="chip h-7 bg-sunken px-2.5 text-[12px] text-ink-2"><span data-testid="remaining" className="tnum">{usd(res.remainingBase)}</span>&nbsp;left on card</span>
              </div>
            ) : (
              <p className={`rounded-[14px] p-3 text-[15px] leading-[22px] ${story?.tone === "warn" ? "bg-warn-bg" : "bg-no-bg"} text-ink`} data-testid="decline-story">{story?.text}</p>
            )}

            <WalletDelta before={attempt.walletBefore} after={approved ? afterRef.current : attempt.walletBefore} approved={approved} />

            {res.settleSignature ? (
              <ProofRow sig={res.settleSignature} testId="proof-settle"
                title={approved ? "Settled on Solana" : "Rejected onchain"}
                linkLabel={approved ? "View settlement on Explorer (devnet)" : "View failed tx on Explorer (devnet)"}
                details={<ProofDetails res={res} />} />
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] text-ink-3" data-testid="no-onchain">No onchain transaction — stopped by the card network before reaching Solana.</p>
                <details className="text-[13px] text-ink-3"><summary className="cursor-pointer font-medium">Card network details</summary><dl className="mt-2 space-y-2"><ProofDetails res={res} /></dl></details>
              </div>
            )}
            {settleSig && (
              <div className="flex flex-col items-end gap-1" aria-live="polite" data-testid="qn-evidence" data-state={qnSeen ? "delivered" : qnPhase === "watch" ? "pending" : "not_delivered"}>
                {qnSeen ? <><QuickNodeBadge label="Settlement streamed by QuickNode" />{streamDetail(qnSeen) && <span className="tnum text-right text-[11px] leading-4 text-ink-3" data-testid="qn-detail">{streamDetail(qnSeen)}</span>}</>
                  : qnPhase === "watch" ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-sunken px-2.5 text-[11px] font-semibold text-ink-3"><Spinner className="h-3 w-3" />Waiting for QuickNode Stream…</span>
                  : <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-sunken px-2.5 text-[11px] font-semibold text-ink-3"><span className="h-1.5 w-1.5 rounded-full bg-ink-3" aria-hidden="true" />Not streamed yet · QuickNode Stream may be paused</span>}
              </div>
            )}

            {approved && v && (
              <ol className="space-y-2 rounded-[16px] bg-sunken p-3.5 text-[14px]" data-testid="void-done" role="status">
                <TimelineStep done label={`Approved ${usd(amountBase)}`} />
                <TimelineStep done label={`Voided by the store (card network status ${v.lithicStatus.toLowerCase()})`} />
                <TimelineStep done={!!refundSig} label={refundSig ? "Refunded to your wallet onchain" : "Refund on its way (sandbox voids are asynchronous, usually under a minute)"} />
                {refundSig && <li className="list-none pt-1"><ProofRow sig={refundSig} title="Refund on Solana" linkLabel="Refund transaction (devnet)" /></li>}
                {refundSig && <li className="list-none pt-1 font-medium text-ink" data-testid="void-message">{VOID_MESSAGE}</li>}
              </ol>
            )}
            {voidErr && <ErrorNote onRetry={() => void doVoid()}>{voidErr}</ErrorNote>}

            <div className="flex flex-col gap-2 pt-1">
              {!approved && story?.fix && <FixButton fix={story.fix} res={res} onFix={onFix} lockedTo={lockedTo} />}
              <button type="button" className={approved || !story?.fix ? "btn-primary w-full" : "btn-secondary w-full"} onClick={onClose} data-testid="sheet-done" autoFocus>Done</button>
              {approved && !v && (
                <button type="button" className="btn-ghost w-full" onClick={() => void doVoid()} disabled={voidBusy} data-testid="void-btn">
                  {voidBusy ? <><Spinner />Voiding…</> : "Void this purchase"}
                </button>
              )}
              {approved && !v && lockedTo && !/amazon/i.test(attempt.merchantLabel) && (
                <button type="button" className="mx-auto inline-flex min-h-10 items-center gap-1 text-[14px] font-semibold text-ink underline decoration-ink/30 underline-offset-4" onClick={() => onFix("try_amazon")} data-testid="try-amazon">
                  Try this card&apos;s number at Amazon<Icon name="arrow" className="h-4 w-4" />
                </button>
              )}
            </div>
            {approved && !v && <p className="text-center text-[12px] text-ink-3">Void simulates the store cancelling this {merchantName} order. The refund is sent onchain on devnet.</p>}
          </section>
        )}
      </div>
    </Sheet>
  );
}

function ProofDetails({ res }: { res: Checkout }) {
  return (
    <>
      <ProofField k="Card network">Lithic sandbox · auth <code className="break-all font-mono text-[12px]" data-testid="lithic-token">{res.lithicToken}</code></ProofField>
      <ProofField k="Decision time">{res.latencyMs} ms</ProofField>
      <ProofField k="Remaining on this card"><span className="tnum">{usd(res.remainingBase)}</span></ProofField>
      {res.settleSignature && <ProofField k="Commitment"><code className="font-mono text-[12px]">sha256(&apos;solsend:auth:v1:&apos; + token)</code> in the CardSettled event; the token itself is never written onchain.</ProofField>}
      <ProofField k="Result">{res.decision === "APPROVED" ? "Approved" : "Declined"} · sandbox · no real merchant was charged</ProofField>
    </>
  );
}

function TimelineStep({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${done ? "bg-ink text-paper" : "bg-surface ring-1 ring-line"}`}>
        {done ? <Icon name="check" className="h-3 w-3" strokeWidth={3} /> : <Spinner className="h-3 w-3 text-ink-3" />}
      </span>
      <span className={done ? "text-ink" : "text-ink-2"}>{label}</span>
    </li>
  );
}

function FixButton({ fix, res, onFix, lockedTo }: { fix: DeclineFix; res: Checkout; onFix: (f: DeclineFix) => void; lockedTo: string | null }) {
  const label = fix === "use_locked_store" ? `Pay at ${lockedTo ?? "its store"} instead` : fix === "pay_remaining" ? `Pay ${usd(res.remainingBase)} instead` : fix === "add_usdc" ? "Add test USDC" : fix === "lower_amount" ? "Choose a smaller amount" : fix === "reactivate" ? "Reactivate this card" : "Open card controls";
  return <button type="button" className="btn-primary w-full" onClick={() => onFix(fix)} data-testid="decline-fix">{label}</button>;
}
