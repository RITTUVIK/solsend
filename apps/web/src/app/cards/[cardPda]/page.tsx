"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { z } from "zod";
import type { api } from "@solsend/shared";
import { client, humanError, signAndSubmit } from "@/client/api";
import { displayStatus, expiresIn, isPresetStore, isUsable, sandboxName, usd } from "@/client/format";
import { usePoll } from "@/client/hooks";
import { toast } from "@/client/toast";
import { AppShell, useAppData } from "@/components/AppShell";
import { CardVisual, LimitBar } from "@/components/CardVisual";
import { FeedList, LiveDot } from "@/components/FeedList";
import { Stepper } from "@/components/Stepper";
import { ErrorNote, Icon, InfoDisclosure, ProofRow, Sheet, Skeleton, Spinner } from "@/components/ui";

type Act = "freeze" | "unfreeze" | "close";
const ACT_DONE: Record<Act, string> = { freeze: "Card frozen. Nothing can be charged until you unfreeze it.", unfreeze: "Card unfrozen and ready to use.", close: "Card closed. Its allowance was revoked onchain." };
const LOCK_INFO = "Enforced onchain: each payment must match the store ID the card network reports for this card. SolSend's server relays that ID; Solana enforces the lock and the cap.";

/** Card back: Lithic's hosted iframes render the number/expiry/CVV inside Lithic's origin. We only hold the URLs. */
function CardBack({ session, onHide }: { session: z.infer<typeof api.EmbedSessionResponse>; onHide: () => void }) {
  const f = session.iframes ?? {};
  const frame = (k: "pan" | "cvv" | "expMonth" | "expYear", label: string, cls = "") => f[k] ? (
    <div className={cls}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">{label}</p>
      <iframe src={f[k]} title={`${label}, hosted by Lithic (sandbox)`} className="h-12 w-full rounded-[10px] bg-[#141416]" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" data-testid={`embed-${k}`} />
    </div>
  ) : null;
  return (
    <div className="anim-born rounded-[20px] bg-[#141416] p-4 text-white shadow-[0_14px_32px_-14px_rgb(11_12_14/.55)] ring-1 ring-white/10" data-testid="embed-fields">
      {Object.keys(f).length > 0 ? (
        <div className="grid grid-cols-3 gap-2.5">
          {frame("pan", "Card number", "col-span-3")}
          {frame("expMonth", "Exp. month")}
          {frame("expYear", "Exp. year")}
          {frame("cvv", "CVV")}
        </div>
      ) : (
        <iframe src={session.iframeUrl} title="Card details, hosted by Lithic (sandbox)" className="h-48 w-full rounded-[12px] bg-[#141416]" sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" data-testid="embed-frame" />
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[12px] leading-4 text-white/70">Shown by Lithic&apos;s secure frame · SolSend never sees these. <span className="font-semibold text-white/85">Sandbox</span></p>
        <button type="button" onClick={onHide} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/20">Hide</button>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, href, primary, busy, disabled, testId }: { icon: string; label: string; onClick?: () => void; href?: string; primary?: boolean; busy?: boolean; disabled?: boolean; testId?: string }) {
  const circle = `grid h-14 w-14 place-items-center rounded-full transition ${primary ? "bg-ink text-paper" : "bg-surface text-ink ring-1 ring-line ring-inset"} group-hover:scale-[1.04] group-active:scale-95`;
  const inner = <><span className={circle}>{busy ? <Spinner className="h-5 w-5" /> : <Icon name={icon} className="h-[22px] w-[22px]" />}</span><span className="text-[12px] font-semibold text-ink-2">{label}</span></>;
  const cls = "group flex min-w-[64px] flex-col items-center gap-1.5 disabled:opacity-50";
  return href ? <Link href={href} className={cls} data-testid={testId}>{inner}</Link>
    : <button type="button" className={cls} onClick={onClick} disabled={disabled || busy} data-testid={testId}>{inner}</button>;
}

function Content() {
  const { cardPda } = useParams<{ cardPda: string }>();
  const { cards, wallet } = useAppData();
  const card = cards.data?.find((c) => c.cardPda === cardPda) ?? null;
  const [busy, setBusy] = useState<Act | null>(null);
  const [more, setMore] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [session, setSession] = useState<z.infer<typeof api.EmbedSessionResponse> | null>(null);
  const [embedBusy, setEmbedBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => { // Lithic sessions are short-lived: hide before they expire
    if (!session) return;
    const t = setTimeout(() => setSession(null), 4 * 60_000);
    return () => clearTimeout(t);
  }, [session]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, []); // refresh "Expires in"

  // Idle detection: the newest relevant feed row decides (a decline with an "idle" reason, until an unfreeze/approval follows).
  const feed = usePoll(() => client.feed(cardPda), 3000, !!card);
  const idle = (() => {
    for (const r of feed.data ?? []) {
      if (r.kind === "unfrozen" || r.kind === "frozen" || r.kind === "settled" || r.kind === "closed") return false;
      if (r.kind === "authorization_declined") return /idle/i.test(r.reason ?? "");
    }
    return false;
  })();

  async function act(a: Act) {
    setBusy(a); setErr(null); setConfirmClose(false); setMore(false);
    try {
      const r = await signAndSubmit(() => client.cardAction(cardPda, a));
      toast({ title: ACT_DONE[a], sig: r.signature, testId: "action-done", linkLabel: "View on Solana Explorer (devnet)" });
      await Promise.all([cards.refresh(), wallet.refresh()]);
    } catch (e) { setErr(humanError(e)); } finally { setBusy(null); }
  }
  async function retry() {
    setRetrying(true); setErr(null);
    try { await client.retryIssue(cardPda); await cards.refresh(); } catch (e) { setErr(humanError(e)); } finally { setRetrying(false); }
  }
  async function showDetails() {
    setEmbedBusy(true); setErr(null);
    try { setSession(await client.embed(cardPda)); } catch (e) { setErr(humanError(e)); } finally { setEmbedBusy(false); }
  }

  if (!card) {
    if (cards.error && !cards.data) return <ErrorNote onRetry={() => void cards.refresh()}>{cards.error}</ErrorNote>;
    if (!cards.data) return <div className="mx-auto max-w-[380px] space-y-4"><Skeleton className="aspect-[1.586] !rounded-[20px]" /><Skeleton className="h-24" /></div>;
    return (
      <div className="surface text-center"><p className="text-[17px] font-semibold">We couldn&apos;t find that card.</p><p className="mt-1 text-[14px] text-ink-3">It may belong to a different wallet.</p><Link href="/home" className="btn-secondary mt-4">Back to wallet</Link></div>
    );
  }

  const status = displayStatus(card);
  const usable = isUsable(card);
  const ready = card.issueState === "issued";
  const preset = isPresetStore(card.merchantName);
  const ended = status === "Closed" || status === "Revoked" || status === "Used" || status === "Expired";
  const exp = expiresIn(card);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/home" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg pr-2 text-[15px] font-medium text-ink-2 hover:text-ink"><Icon name="back" className="h-4 w-4" />Wallet</Link>
      </div>

      <div className="mx-auto w-full max-w-[380px]">
        {session ? <CardBack session={session} onHide={() => setSession(null)} /> : <CardVisual card={card} idle={idle && card.status === "ACTIVE"} />}
      </div>

      {ready && !ended && (
        <div className="flex justify-center gap-5" role="group" aria-label="Card actions">
          {usable && !idle && <ActionButton icon="store" label="Pay" href={`/merchant?card=${card.cardPda}`} primary testId="spend" />}
          {usable && !idle && <ActionButton icon="eye" label={session ? "Hide" : "Details"} onClick={() => (session ? setSession(null) : void showDetails())} busy={embedBusy} testId="show-details" />}
          {card.status === "ACTIVE" && idle && <ActionButton icon="refund" label="Reactivate" primary onClick={() => void act("unfreeze")} busy={busy === "unfreeze"} testId="reactivate" />}
          {card.status === "ACTIVE" && !idle && <ActionButton icon="snow" label="Freeze" onClick={() => void act("freeze")} busy={busy === "freeze"} disabled={busy !== null} testId="freeze" />}
          {card.status === "FROZEN" && <ActionButton icon="snow" label="Unfreeze" primary onClick={() => void act("unfreeze")} busy={busy === "unfreeze"} disabled={busy !== null} testId="unfreeze" />}
          <ActionButton icon="more" label="More" onClick={() => setMore(true)} testId="more" />
        </div>
      )}
      {idle && card.status === "ACTIVE" && <p className="rounded-[14px] bg-warn-bg p-3 text-[14px] text-ink" data-testid="idle-note">This card went idle after a declined charge. Reactivate it to keep using it.</p>}
      {err && <ErrorNote>{err}</ErrorNote>}

      {!ready && (
        <section className="surface" aria-label="Setup progress">
          <h2 className="mb-2 text-[17px] font-semibold">{status === "Setting up" ? "Finishing setup" : "Setup needs attention"}</h2>
          <Stepper card={card} stage="sent" onRetry={() => void retry()} retrying={retrying} />
        </section>
      )}

      <section className="surface space-y-4" aria-labelledby="limit-h">
        <h2 id="limit-h" className="sr-only">Spending limit</h2>
        <LimitBar card={card} />
        <p className="text-[13px] leading-5 text-ink-3">The card holds $0 — it pulls from your wallet only at the moment you pay. Spent {usd(card.totals.settledBase)} · refunded {usd(card.totals.refundedBase)}. Refunds return USDC but never restore the limit.</p>
        {exp && <p className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-2" data-testid="expiry-line"><Icon name="clock" className="h-4 w-4" />{exp} — after that, every pull fails onchain.</p>}
        {status === "Expired" && <p className="rounded-[14px] bg-sunken p-3 text-[14px] text-ink-2" data-testid="expired-note">This card expired when its free trial ended. It can never pull again; your USDC stays in your wallet.</p>}
        <div className="border-t border-line pt-3">
          <p className="flex items-center gap-2 text-[15px] font-medium" data-testid="lock-badge">
            <Icon name="lock" className="h-4 w-4 shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">{preset ? `Locked to ${sandboxName(card.merchantName)}` : card.merchantLocked ? "Locked to the first store that charged it" : "Locks to the first store that charges it"}</span>
            <InfoDisclosure label="How is the store lock enforced?">{LOCK_INFO}{!preset && !card.merchantLocked ? " This card records that ID from its first payment." : ""}</InfoDisclosure>
          </p>
        </div>
      </section>

      {card.registerSignature && <ProofRow sig={card.registerSignature} title="Created on Solana" linkLabel="Card registration tx on Solana Explorer (devnet)" />}

      <section aria-labelledby="act-h">
        <div className="mb-2 flex items-center justify-between"><h2 id="act-h" className="text-[17px] font-semibold">Activity</h2><LiveDot /></div>
        <FeedList cardPda={card.cardPda} empty="No activity on this card yet." />
      </section>

      <Sheet open={more} onClose={() => { setMore(false); setConfirmClose(false); }} labelledBy="more-title" testId="more-sheet">
        <div className="space-y-3 pt-1">
          <h3 id="more-title" className="text-[22px] font-semibold tracking-[-0.02em]">{card.label}</h3>
          {!confirmClose ? (
            <>
              <p className="text-[15px] text-ink-2">Closing revokes this card&apos;s allowance onchain. It can never pull again.</p>
              {!ended && <button type="button" className="btn-danger w-full" onClick={() => setConfirmClose(true)} data-testid="close">Close card…</button>}
              <button type="button" className="btn-ghost w-full" onClick={() => setMore(false)}>Cancel</button>
            </>
          ) : (
            <div role="group" aria-label="Confirm close" className="space-y-3">
              <p className="text-[15px] text-ink-2">Close this card for good? Its allowance is revoked onchain. Your balance doesn&apos;t move.</p>
              <button type="button" className="btn-primary w-full !bg-no !text-paper" disabled={busy !== null} onClick={() => void act("close")} data-testid="confirm-close">{busy === "close" ? <><Spinner />Closing…</> : "Yes, close it"}</button>
              <button type="button" className="btn-ghost w-full" onClick={() => setConfirmClose(false)}>Keep card</button>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}

export default function CardDetailPage() {
  return <AppShell><Content /></AppShell>;
}
