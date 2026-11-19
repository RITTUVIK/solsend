"use client";
import { useState } from "react";
import { flushSync } from "react-dom";
import { client, humanError, signAndSubmit } from "@/client/api";
import { blastRadius, isExpired, usd } from "@/client/format";
import { isUserCancel } from "@/client/wallet-errors";
import { useAppData } from "./AppShell";
import { ErrorNote, Icon, Sheet, SigLink, Spinner } from "./ui";

/**
 * "Issuer outage" beat (F8), demoted from an alarm to a calm Safety row: the money never left the wallet; one confirmed
 * transaction revokes every card's allowance directly onchain. `outage` = the deliberate demo state (simulated issuer down).
 */
export function OutagePanel({ outage = false }: { outage?: boolean }) {
  const { wallet, cards } = useAppData();
  // preparing → signing (wallet approval window open) → submitting (server cosigns as fee payer, waits for `confirmed`).
  const [phase, setPhase] = useState<"preparing" | "signing" | "submitting" | null>(null);
  const busy = phase !== null;
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<{ text: string; sent: boolean; cancelled: boolean } | null>(null);
  const [done, setDone] = useState<{ sig: string; balance: string | null } | null>(null);
  // Allowance accounts that still exist onchain (what revoke-all closes) vs cards that can still pull (home's "live cards").
  // An expired free trial or a frozen card can't pull, but its allowance account exists until revoked.
  const onchain = (cards.data ?? []).filter((c) => c.delegationLive && c.status !== "CLOSED" && c.issueState !== "failed");
  const live = onchain.length;
  const canPull = blastRadius(cards.data).count;
  const expired = onchain.filter((c) => isExpired(c)).length;
  const frozen = onchain.filter((c) => !isExpired(c) && c.status === "FROZEN").length;
  const otherIdle = live - canPull - expired - frozen;
  const breakdown = live === canPull ? null : [
    `${canPull} live`,
    expired > 0 && `${expired} expired`, frozen > 0 && `${frozen} frozen`, otherIdle > 0 && `${otherIdle} inactive`,
  ].filter(Boolean).join(", ");

  async function revoke() {
    // Close OUR confirmation dialog BEFORE the wallet opens. A modal <dialog> sits in the browser's top layer and makes
    // the rest of the page inert, so Privy's approval window (a normal z-indexed element) would be covered and
    // unreachable by mouse or Tab. flushSync: the dialog is gone from the DOM before any signing starts.
    flushSync(() => { setConfirm(false); setErr(null); setDone(null); setPhase("preparing"); });
    let sent = false; // true once the owner-signed tx was handed to the server (it may land even if the reply is lost)
    try {
      const r = await signAndSubmit(() => client.revokeAll(), {
        // A fresh prepare = a new attempt (the automatic tx_expired retry only follows a send the network rejected).
        onPrepared: () => { sent = false; setPhase("signing"); },
        onSigned: () => { sent = true; setPhase("submitting"); },
      });
      setDone({ sig: r.signature, balance: wallet.data?.usdcBase ?? null });
    } catch (e) {
      setErr({ text: humanError(e), sent, cancelled: !sent && isUserCancel(e) });
    } finally {
      setPhase(null);
      // Always re-read: the live count below comes from the chain (delegation accounts), never from what we assume.
      void cards.refresh(); void wallet.refresh();
    }
  }

  if (live === 0 && !done && !err && !busy && !outage) return null;
  return (
    <section className={`rounded-[20px] p-4 ${outage ? "bg-warn-bg" : "bg-sunken/70"}`} aria-labelledby="outage-title" data-testid="safety">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] ${outage ? "bg-warn text-paper" : "bg-surface text-ink"}`}><Icon name="shield" className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 id="outage-title" className="text-[17px] font-semibold tracking-[-0.01em]">{outage ? "Card issuer unreachable (simulated)" : "If the card issuer goes down"}</h2>
          <p className="mt-0.5 text-[15px] leading-[22px] text-ink-2">Your money never left your wallet. Cards only pull at the moment of a swipe — and you can revoke every one of them in a single Solana transaction that you sign yourself, even if the issuer is down.</p>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 rounded-[14px] bg-surface px-3.5 py-3">
        <div><p className="text-[12px] font-medium text-ink-3">Live wallet balance</p><p className="tnum text-[22px] font-semibold tracking-[-0.02em]" data-testid="outage-balance">{wallet.data ? usd(wallet.data.usdcBase) : "—"} <span className="text-[12px] font-medium text-ink-3">devnet USDC</span></p></div>
        <p className="text-right text-[13px] font-medium text-ink-3" data-testid="allowance-count">
          {live} card{live === 1 ? "" : "s"} to revoke
          {breakdown && <span className="block text-[12px] font-normal">{breakdown}</span>}
        </p>
      </div>
      {busy && (
        <div className="mt-3 flex items-center gap-2.5 rounded-[14px] bg-surface px-3.5 py-3 text-[15px] font-medium" role="status" aria-live="polite" data-testid="revoke-progress" data-phase={phase}>
          <Spinner />
          {phase === "signing" ? "Approve the revoke in your wallet window" : phase === "submitting" ? "Revoking on Solana… waiting for confirmation" : "Preparing one revoke transaction…"}
        </div>
      )}
      {err && !busy && err.cancelled && (
        <p className="mt-3 rounded-[14px] bg-surface px-3.5 py-3 text-[15px] leading-[22px]" role="status" data-testid="revoke-cancelled">
          You cancelled in your wallet. Nothing was sent to Solana, and your cards are unchanged.
        </p>
      )}
      {err && !busy && !err.cancelled && (
        <div className="mt-3 space-y-1" data-testid="revoke-error">
          <ErrorNote>{err.text}</ErrorNote>
          <p className="text-[13px] text-ink-2">
            {err.sent
              ? `We couldn't confirm the result. The count above is re-read from Solana — ${live === 0 ? "every card is revoked." : `${live} card${live === 1 ? " is" : "s are"} still live.`}`
              : "Nothing was sent to Solana. Your cards are unchanged."}
          </p>
        </div>
      )}
      {live > 0 && (
        <button type="button" onClick={() => setConfirm(true)} disabled={busy} className="btn-danger mt-3 w-full" data-testid="revoke-open">{err ? "Try revoking again…" : "Revoke all cards…"}</button>
      )}
      {done && (
        <div className="anim-rise mt-3 space-y-2" role="status" data-testid="revoke-done">
          <p className="text-[15px] font-semibold">All cards revoked in one transaction.</p>
          <p className="text-[13px] text-ink-2">Balance still {done.balance ? usd(done.balance) : "unchanged"} — nothing was moved. No card can pull again.</p>
          <SigLink sig={done.sig} title="Revoked on Solana" />
        </div>
      )}

      <Sheet open={confirm} onClose={() => { if (!busy) setConfirm(false); }} labelledBy="revoke-title" dismissible={!busy} testId="revoke-sheet">
        <div className="space-y-4 pt-1">
          <h3 id="revoke-title" className="text-[22px] font-semibold tracking-[-0.02em]">Revoke {live} card{live === 1 ? "" : "s"}?</h3>
          <p className="text-[15px] leading-[22px] text-ink-2">One Solana transaction removes every card&apos;s allowance{live > canPull ? ", including expired and frozen ones" : ""}. It works even if the card issuer is down: you sign it yourself and it goes to Solana&apos;s Allowances program. Your balance doesn&apos;t move; the cards can never pull again.</p>
          <p className="text-[13px] leading-5 text-ink-3">Next, your wallet asks you to approve one transaction. Nothing is revoked until you approve it.</p>
          <div className="flex flex-col gap-2">
            <button type="button" className="btn-primary w-full !bg-no !text-paper" onClick={() => void revoke()} disabled={busy} data-testid="revoke-confirm">
              Revoke all cards
            </button>
            <button type="button" className="btn-ghost w-full" onClick={() => setConfirm(false)} disabled={busy}>Keep my cards</button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}
