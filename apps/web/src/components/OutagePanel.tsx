"use client";
import { useState } from "react";
import { client, humanError, signAndSubmit } from "@/client/api";
import { usd } from "@/client/format";
import { useAppData } from "./AppShell";
import { ErrorNote, Icon, SigLink, Spinner } from "./ui";

/** "Issuer outage" beat (F8): the money never left the wallet; one tap revokes every card's allowance directly onchain. */
export function OutagePanel() {
  const { wallet, cards } = useAppData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ sig: string } | null>(null);
  const live = (cards.data ?? []).filter((c) => c.delegationLive && c.status !== "CLOSED").length;

  async function revoke() {
    setBusy(true); setErr(null); setDone(null);
    try {
      const r = await signAndSubmit(() => client.revokeAll());
      setDone({ sig: r.signature });
      void cards.refresh(); void wallet.refresh();
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface border-rose-200 dark:border-rose-500/30" aria-labelledby="outage-title">
      <h2 id="outage-title" className="flex items-center gap-2 font-semibold"><Icon name="shield" className="h-5 w-5 text-rose-600" />Card issuer down? Your money never left your wallet.</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Cards only pull funds at the moment of a swipe. If anything looks wrong, revoke every card&apos;s allowance in a single transaction. It works without SolSend or the issuer.</p>
      <div className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">
        <div><p className="text-xs text-zinc-500">Live wallet balance</p><p className="text-xl font-bold tabular-nums" data-testid="outage-balance">{wallet.data ? usd(wallet.data.usdcBase) : "—"} <span className="text-xs font-medium text-zinc-500">devnet USDC</span></p></div>
        <p className="text-xs text-zinc-500">{live} live card{live === 1 ? "" : "s"}</p>
      </div>
      <button type="button" onClick={() => void revoke()} disabled={busy || live === 0} className="btn-danger mt-3 w-full">
        {busy ? <><Spinner />Revoking…</> : "Revoke all cards"}
      </button>
      {err && <div className="mt-3"><ErrorNote onRetry={() => void revoke()}>{err}</ErrorNote></div>}
      {done && (
        <div className="anim-rise mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10" role="status" data-testid="revoke-done">
          <p className="font-semibold text-emerald-900 dark:text-emerald-200">All cards revoked in one transaction.</p>
          <div className="mt-1"><SigLink sig={done.sig} /></div>
        </div>
      )}
    </section>
  );
}
