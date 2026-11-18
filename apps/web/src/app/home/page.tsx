"use client";
import { useState } from "react";
import Link from "next/link";
import { explorerAddress } from "@solsend/shared";
import { client, humanError } from "@/client/api";
import { shortId, usd } from "@/client/format";
import { AppShell, useAppData } from "@/components/AppShell";
import { CardVisual } from "@/components/CardVisual";
import { OutagePanel } from "@/components/OutagePanel";
import { ErrorNote, Icon, SigLink, Skeleton, Spinner } from "@/components/ui";

function Faucet() {
  const { wallet } = useAppData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [got, setGot] = useState<{ sig: string; amount: string } | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await client.faucet();
      setGot({ sig: r.signature, amount: r.amountBase });
      await wallet.refresh();
    } catch (e) {
      setErr(humanError(e)); setGot(null);
    } finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" onClick={() => void go()} disabled={busy} className="btn-primary w-full sm:w-auto" data-testid="faucet-btn">
        {busy ? <><Spinner />Sending test USDC…</> : <><Icon name="drop" className="h-4 w-4" />Get test USDC</>}
      </button>
      {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
      {got && (
        <p className="anim-rise mt-3 text-sm" role="status" data-testid="faucet-done">
          Received <strong>{usd(got.amount)}</strong> devnet test USDC. <SigLink sig={got.sig} />
        </p>
      )}
    </>
  );
}

function Content() {
  const { wallet, cards } = useAppData();
  const list = cards.data;
  return (
    <div className="space-y-6">
      <section className="surface" aria-labelledby="bal">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="bal" className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Your wallet balance</h2>
            {wallet.data ? (
              <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums" data-testid="balance">{usd(wallet.data.usdcBase)}<span className="ml-2 text-sm font-semibold text-zinc-500">USDC</span></p>
            ) : <Skeleton className="mt-1 h-10 w-40" />}
            <p className="mt-1 text-xs text-zinc-500">Solana <strong>devnet</strong> test USDC, no real value</p>
          </div>
          {wallet.data && (
            <a href={explorerAddress(wallet.data.wallet)} target="_blank" rel="noreferrer" className="link shrink-0 text-xs" title={wallet.data.wallet}>{shortId(wallet.data.wallet, 4)}</a>
          )}
        </div>
        {wallet.error && !wallet.data && <div className="mt-3"><ErrorNote onRetry={() => void wallet.refresh()}>{wallet.error}</ErrorNote></div>}
        <div className="mt-4"><Faucet /></div>
      </section>

      <section aria-labelledby="cards-h">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="cards-h" className="text-lg font-bold">Your cards</h2>
          <Link href="/cards/new" className="btn-primary !min-h-10" data-testid="new-card"><Icon name="plus" className="h-4 w-4" />New card</Link>
        </div>
        {cards.error && !list && <ErrorNote onRetry={() => void cards.refresh()}>{cards.error}</ErrorNote>}
        {!list && !cards.error && <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>}
        {list && list.length === 0 && (
          <div className="surface text-center">
            <p className="font-semibold">No cards yet</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Make a burner card for one store. Your USDC stays in your wallet until it&apos;s used.</p>
            <Link href="/cards/new" className="btn-secondary mt-3">Create your first card</Link>
          </div>
        )}
        {list && list.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((c) => (
              <li key={c.cardPda}>
                <Link href={`/cards/${c.cardPda}`} className="block rounded-2xl transition hover:-translate-y-0.5 focus-visible:-translate-y-0.5" aria-label={`${c.label}, open card`} data-testid="card-tile">
                  <CardVisual card={c} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {list && list.length > 0 && (
          <Link href="/merchant" className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-4 text-white shadow-sm">
            <span><span className="block font-semibold">Try a card at the Demo store</span><span className="text-sm text-white/85">A sandbox shop. Swipe, decline, void.</span></span>
            <Icon name="store" className="h-6 w-6 shrink-0" />
          </Link>
        )}
      </section>

      <OutagePanel />
    </div>
  );
}

export default function HomePage() {
  return <AppShell><Content /></AppShell>;
}
