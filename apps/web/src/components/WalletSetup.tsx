"use client";
import { useState } from "react";
import { client, humanError, signAndSubmit } from "@/client/api";
import { useAppData } from "./AppShell";
import { ErrorNote, Icon, SigLink, Spinner } from "./ui";

/** One-time wallet setup (Allowances can't create the SubscriptionAuthority and a delegation in one tx).
 *  POST /api/wallet/setup → Privy sign → /api/tx/submit → explorer link. Cards come only after this confirms. */
export function WalletSetup({ onDone }: { onDone?: () => void }) {
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
    <section className="surface border-emerald-300 dark:border-emerald-500/40" aria-labelledby="setup-h" data-testid="wallet-setup">
      <h2 id="setup-h" className="flex items-center gap-2 font-semibold"><Icon name="shield" className="h-5 w-5 text-emerald-600" />Set up your wallet for SolSend cards</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">One signature, free: we pay the fees. This lets your wallet issue spending allowances. Your USDC stays yours.</p>
      {!sig && (
        <button type="button" onClick={() => void go()} disabled={busy} className="btn-primary mt-3 w-full sm:w-auto" data-testid="setup-btn">
          {busy ? <><Spinner />Setting up…</> : "Set up wallet"}
        </button>
      )}
      {err && <div className="mt-3"><ErrorNote onRetry={() => void go()}>{err}</ErrorNote></div>}
      {sig && (
        <div className="anim-rise mt-3 text-sm" role="status" data-testid="setup-done">
          <p className="font-semibold text-emerald-800 dark:text-emerald-300">Wallet ready for cards.</p>
          <div className="mt-1"><SigLink sig={sig} /></div>
        </div>
      )}
    </section>
  );
}
