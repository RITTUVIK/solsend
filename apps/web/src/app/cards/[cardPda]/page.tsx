"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { client, humanError, signAndSubmit } from "@/client/api";
import { displayStatus, isUsable, usd } from "@/client/format";
import { AppShell, useAppData } from "@/components/AppShell";
import { CardVisual, LimitBar } from "@/components/CardVisual";
import { FeedList, LiveDot } from "@/components/FeedList";
import { Stepper } from "@/components/Stepper";
import { ErrorNote, Icon, SigLink, Skeleton, Spinner } from "@/components/ui";

type Act = "freeze" | "unfreeze" | "close";
const ACT_DONE: Record<Act, string> = { freeze: "Card frozen. Nothing can be charged until you unfreeze it.", unfreeze: "Card unfrozen.", close: "Card closed. Its allowance was revoked onchain." };

function Embed({ cardPda }: { cardPda: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    const t = setTimeout(() => setUrl(null), 4 * 60_000); // Lithic sessions are short-lived: hide before they expire
    return () => clearTimeout(t);
  }, [url]);
  async function show() {
    setBusy(true); setErr(null);
    try { setUrl((await client.embed(cardPda)).iframeUrl); } catch (e) { setErr(humanError(e)); } finally { setBusy(false); }
  }
  return (
    <section className="surface" aria-labelledby="details-h">
      <h2 id="details-h" className="font-semibold">Card details</h2>
      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">The number, expiry and CVV are shown inside the card issuer&apos;s secure frame. SolSend never sees them.</p>
      {url ? (
        <div className="mt-3">
          <iframe src={url} title="Card details, hosted by Lithic (sandbox)" className="h-56 w-full rounded-xl border border-zinc-200 bg-zinc-900 dark:border-zinc-700"
            sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" data-testid="embed-frame" />
          <button type="button" onClick={() => setUrl(null)} className="btn-ghost mt-2 !min-h-9">Hide card details</button>
        </div>
      ) : (
        <button type="button" onClick={() => void show()} disabled={busy} className="btn-secondary mt-3 w-full sm:w-auto" data-testid="show-details">
          {busy ? <><Spinner />Opening…</> : "Show card details"}
        </button>
      )}
      {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
    </section>
  );
}

function Content() {
  const { cardPda } = useParams<{ cardPda: string }>();
  const { cards, wallet } = useAppData();
  const card = cards.data?.find((c) => c.cardPda === cardPda) ?? null;
  const [busy, setBusy] = useState<Act | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ act: Act; sig: string } | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function act(a: Act) {
    setBusy(a); setErr(null); setDone(null); setConfirmClose(false);
    try {
      const p = await client.cardAction(cardPda, a);
      const r = await signAndSubmit(p);
      setDone({ act: a, sig: r.signature });
      await Promise.all([cards.refresh(), wallet.refresh()]);
    } catch (e) { setErr(humanError(e)); } finally { setBusy(null); }
  }
  async function retry() {
    setRetrying(true); setErr(null);
    try { await client.retryIssue(cardPda); await cards.refresh(); } catch (e) { setErr(humanError(e)); } finally { setRetrying(false); }
  }

  if (!card) {
    if (cards.error && !cards.data) return <ErrorNote onRetry={() => void cards.refresh()}>{cards.error}</ErrorNote>;
    if (!cards.data) return <div className="space-y-3"><Skeleton className="h-52" /><Skeleton className="h-24" /></div>;
    return (
      <div className="surface text-center"><p className="font-semibold">We couldn&apos;t find that card.</p><Link href="/home" className="btn-secondary mt-3">Back to wallet</Link></div>
    );
  }

  const status = displayStatus(card);
  const usable = isUsable(card);
  const ready = card.issueState === "issued";
  const busyAny = busy !== null;

  return (
    <div className="space-y-4">
      <Link href="/home" className="link inline-flex items-center gap-1 text-sm">← Wallet</Link>
      <CardVisual card={card} large />

      {!ready && (
        <section className="surface" aria-label="Setup progress">
          <h2 className="mb-2 font-semibold">{status === "Setting up" ? "Finishing setup" : "Setup needs attention"}</h2>
          <Stepper card={card} stage="sent" onRetry={() => void retry()} retrying={retrying} />
        </section>
      )}

      <section className="surface" aria-labelledby="limit-h">
        <h2 id="limit-h" className="font-semibold">Spending limit</h2>
        <div className="mt-2"><LimitBar card={card} tone="plain" /></div>
        <p className="mt-2 text-xs text-zinc-500">Spent {usd(card.totals.settledBase)} · refunded {usd(card.totals.refundedBase)}. Refunds return USDC to your wallet but never restore the limit.</p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-sm dark:bg-zinc-800" data-testid="lock-badge">
          <Icon name="lock" className="h-4 w-4 text-emerald-600" />
          <span>Locked to the first store that charges it</span>
          <span className={`chip ${card.merchantLocked ? "bg-emerald-200 text-emerald-900" : "bg-zinc-300 text-zinc-800"}`}>{card.merchantLocked ? "Locked" : "Not yet"}</span>
        </p>
      </section>

      {ready && usable && <Embed cardPda={card.cardPda} />}

      {ready && status !== "Closed" && status !== "Revoked" && status !== "Used" && (
        <section className="surface" aria-labelledby="ctl-h">
          <h2 id="ctl-h" className="font-semibold">Controls</h2>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">Each action is signed by your wallet and recorded on Solana devnet.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {card.status === "ACTIVE" && <button type="button" className="btn-secondary" disabled={busyAny} onClick={() => void act("freeze")} data-testid="freeze">{busy === "freeze" ? <><Spinner />Freezing…</> : <><Icon name="snow" className="h-4 w-4" />Freeze</>}</button>}
            {card.status === "FROZEN" && <button type="button" className="btn-secondary" disabled={busyAny} onClick={() => void act("unfreeze")} data-testid="unfreeze">{busy === "unfreeze" ? <><Spinner />Unfreezing…</> : "Unfreeze"}</button>}
            {!confirmClose
              ? <button type="button" className="btn-ghost text-rose-700 dark:text-rose-400" disabled={busyAny} onClick={() => setConfirmClose(true)} data-testid="close">Close card</button>
              : (
                <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10" role="group" aria-label="Confirm close">
                  <p className="min-w-full text-sm">Close this card for good? Its allowance is revoked onchain.</p>
                  <button type="button" className="btn-danger" disabled={busyAny} onClick={() => void act("close")} data-testid="confirm-close">{busy === "close" ? <><Spinner />Closing…</> : "Yes, close it"}</button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirmClose(false)}>Keep card</button>
                </div>
              )}
          </div>
          {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
          {done && (
            <div className="anim-rise mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10" role="status" data-testid="action-done">
              <p className="font-semibold text-emerald-900 dark:text-emerald-200">{ACT_DONE[done.act]}</p>
              <div className="mt-1"><SigLink sig={done.sig} /></div>
            </div>
          )}
        </section>
      )}
      {(!ready || status === "Closed" || status === "Revoked" || status === "Used") && err && <ErrorNote>{err}</ErrorNote>}
      {(status === "Closed" || status === "Revoked" || status === "Used") && done && (
        <div className="anim-rise rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10" role="status" data-testid="action-done">
          <p className="font-semibold text-emerald-900 dark:text-emerald-200">{ACT_DONE[done.act]}</p>
          <div className="mt-1"><SigLink sig={done.sig} /></div>
        </div>
      )}

      {ready && usable && (
        <Link href={`/merchant?card=${card.cardPda}`} className="btn-primary w-full" data-testid="spend">Spend it at the Demo store</Link>
      )}
      {card.registerSignature && <p className="text-sm text-zinc-600 dark:text-zinc-400">Created onchain: <SigLink sig={card.registerSignature} label="registration tx" /></p>}

      <section aria-labelledby="act-h">
        <div className="mb-1 flex items-center justify-between"><h2 id="act-h" className="font-semibold">Activity</h2><LiveDot /></div>
        <FeedList cardPda={card.cardPda} empty="No activity on this card yet." />
      </section>
    </div>
  );
}

export default function CardDetailPage() {
  return <AppShell><Content /></AppShell>;
}
