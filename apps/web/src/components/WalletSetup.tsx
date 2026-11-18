"use client";
import { useState } from "react";
import { client, humanError, signAndSubmit } from "@/client/api";
import { useAppData } from "./AppShell";
import { ErrorNote, Icon, SigLink, Spinner } from "./ui";

/** One-time wallet setup (Allowances can't create the SubscriptionAuthority and a delegation in one tx).
 *  POST /api/wallet/setup → Privy sign → /api/tx/submit → explorer link. Cards come only after this confirms. */
export function WalletSetup({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { wallet } = useAppData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await signAndSubmit(() => client.walletSetup());
      setSig(r.signature);
      await wallet.refresh();
      onDone?.();
    } catch (e) { setErr(humanError(e)); } finally { setBusy(false); }
  }

  return (
    <section className={compact ? "" : "surface"} aria-labelledby="setup-h" data-testid="wallet-setup">
      {!compact && (
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-sunken text-ink"><Icon name="shield" className="h-5 w-5" /></span>
          <div>
            <h2 id="setup-h" className="text-[17px] font-semibold tracking-[-0.01em]">{sig ? "Wallet ready for cards" : "Set up your wallet for cards"}</h2>
            <p className="mt-0.5 text-[15px] leading-[22px] text-ink-2">One signature, free — we pay the fees. It lets your wallet grant spending allowances. Your USDC stays yours.</p>
          </div>
        </div>
      )}
      {compact && <h3 id="setup-h" className="sr-only">Set up your wallet</h3>}
      {!sig && (
        <button type="button" onClick={() => void go()} disabled={busy} className={`btn-primary w-full ${compact ? "" : "mt-4"}`} data-testid="setup-btn">
          {busy ? <><Spinner />Waiting for your signature…</> : "Set up wallet · free"}
        </button>
      )}
      {err && <div className="mt-3"><ErrorNote onRetry={() => void go()}>{err}</ErrorNote></div>}
      {sig && (
        <div className="anim-rise mt-3 space-y-2" role="status" data-testid="setup-done">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink"><span className="grid h-5 w-5 place-items-center rounded-full bg-ok text-white"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>Wallet ready for cards.</p>
          <SigLink sig={sig} title="Setup on Solana" />
        </div>
      )}
    </section>
  );
}
