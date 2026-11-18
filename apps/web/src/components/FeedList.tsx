"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { explorerTx } from "@solsend/shared";
import { client } from "@/client/api";
import { FEED_POLL_MS } from "@/client/config";
import { usePoll } from "@/client/hooks";
import { isMockSig, sandboxName, shortId, timeAgo, usd, type FeedRow } from "@/client/format";
import { voidErrorCopy, voidPurchase, type Voided } from "@/client/void";
import { ErrorNote, Icon, SigLink, Skeleton, Spinner } from "./ui";

const KIND: Record<FeedRow["kind"], { title: string; icon: string; tone: string }> = {
  registered: { title: "Card created onchain", icon: "card", tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  authorization_approved: { title: "Authorization approved", icon: "check", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  authorization_declined: { title: "Authorization declined", icon: "x", tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  settled: { title: "Settled onchain", icon: "coin", tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  refunded: { title: "Refunded to wallet", icon: "refund", tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300" },
  frozen: { title: "Card frozen", icon: "snow", tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300" },
  unfrozen: { title: "Card unfrozen", icon: "snow", tone: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
  closed: { title: "Card closed", icon: "lock", tone: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
  faucet: { title: "Test USDC received", icon: "drop", tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300" },
};
const SOURCE: Record<FeedRow["source"], string> = {
  quicknode: "onchain via QuickNode Streams",
  lithic: "Lithic sandbox webhook",
  reconciler: "SolSend reconciler",
  app: "SolSend app",
};

const VOID_COPY = "Simulates the store cancelling this sandbox order. The USDC returns to your wallet onchain; this card's spending limit stays used.";

/** Void from the feed: for an approved sandbox purchase that has no refunded row yet. Confirm sheet, then POST /api/demo-merchant/void. */
function RowVoid({ row, refund }: { row: FeedRow; refund: FeedRow | undefined }) {
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState<Voided | null>(null);
  const inflight = useRef(false); // never allow a double submit
  const token = row.lithicToken ?? "";

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !inflight.current) setSheet(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  async function confirm() {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setErr(null);
    try { setV(await voidPurchase(token)); } catch (e) { setErr(voidErrorCopy(e)); } finally { inflight.current = false; setBusy(false); setSheet(false); }
  }

  const sig = v?.refundSignature ?? refund?.signature ?? null;
  if (v) {
    return (
      <div className="mt-2 rounded-lg border border-sky-300 bg-sky-50 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10" role="status" data-testid="row-void-status">
        {sig ? (
          <><p className="font-semibold text-sky-900 dark:text-sky-200">Refunded</p><div className="mt-0.5"><SigLink sig={sig} label="Refund transaction (devnet)" /></div></>
        ) : (
          <p className="flex items-start gap-2 text-sky-900 dark:text-sky-200"><Spinner className="mt-0.5 h-3.5 w-3.5 shrink-0" />Refund on its way: Lithic sandbox voids are asynchronous (usually under a minute)</p>
        )}
      </div>
    );
  }
  if (refund) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setSheet(true)} disabled={busy} className="btn-secondary !min-h-8 !px-3 !py-1 !text-xs" data-testid="row-void-btn">{busy ? <><Spinner className="h-3 w-3" />Voiding…</> : "Void (sandbox store)"}</button>
      {err && <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-300" role="alert">{err}</p>}
      {sheet && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => { if (!inflight.current) setSheet(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`void-t-${row.id}`} onClick={(e) => e.stopPropagation()}
            className="anim-rise w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl dark:bg-zinc-900" data-testid="void-sheet">
            <h3 id={`void-t-${row.id}`} className="text-lg font-semibold">Void this purchase?</h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{VOID_COPY}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setSheet(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary flex-1" onClick={() => void confirm()} disabled={busy} autoFocus data-testid="void-confirm">{busy ? <><Spinner />Voiding…</> : "Void purchase"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FeedItem({ row, fresh, refund, voidable = false }: { row: FeedRow; fresh: boolean; refund?: FeedRow; voidable?: boolean }) {
  const k = KIND[row.kind];
  const sign = row.kind === "settled" ? "−" : row.kind === "refunded" || row.kind === "faucet" ? "+" : "";
  return (
    <li className={`flex gap-3 rounded-xl px-3 py-3 ${fresh ? "anim-row-in" : ""}`} data-testid="feed-row" data-kind={row.kind}>
      <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${k.tone}`}><Icon name={k.icon} className="h-4.5 w-4.5" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium leading-snug">{k.title}</p>
          {row.amountBase != null && <p className="shrink-0 font-semibold tabular-nums">{sign}{usd(row.amountBase)}</p>}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {row.merchant ? sandboxName(row.merchant) : "SolSend"}
          {row.reason ? <> · <span className="font-medium text-zinc-800 dark:text-zinc-200">{row.reason}</span></> : null}
          {row.remainingBase != null && <> · {usd(row.remainingBase)} left</>}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="chip bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{SOURCE[row.source]}</span>
          {row.signature && (
            <a href={row.explorer ?? explorerTx(row.signature)} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-0.5">
              Explorer<Icon name="ext" className="h-3 w-3" /><span className="font-mono text-[11px] font-normal text-zinc-500">{shortId(row.signature, 4)}</span>
            </a>
          )}
          {row.signature && isMockSig(row.signature) && <span className="chip bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-200">MOCK sig</span>}
          {!row.signature && row.kind === "authorization_declined" && <span className="text-zinc-500">no onchain transaction</span>}
          {row.lithicToken && <span className="inline-flex items-center gap-1 text-zinc-500">Lithic <code className="font-mono text-[11px]">{shortId(row.lithicToken, 4)}</code><span className="sandbox-chip">SANDBOX</span></span>}
          <time dateTime={row.at} className="ml-auto text-zinc-500">{timeAgo(row.at)}</time>
        </div>
        {voidable && row.kind === "authorization_approved" && row.lithicToken && <RowVoid row={row} refund={refund} />}
        {row.kind === "settled" && row.lithicToken && (
          <details className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <summary className="cursor-pointer font-medium hover:underline">Verify</summary>
            <p className="mt-1">Onchain commitment = <code className="font-mono">sha256(&apos;solsend:auth:v1:&apos; + token)</code>, shown in the CardSettled event on the explorer. The Lithic token itself is not written onchain.</p>
          </details>
        )}
      </div>
    </li>
  );
}

/** Live feed: polls GET /api/feed every 1.5 s. Rows that appear after the first load animate in. */
export function FeedList({ cardPda, limit = 50, empty }: { cardPda?: string; limit?: number; empty?: string }) {
  const { data, error, loading, refresh } = usePoll(() => client.feed(cardPda), FEED_POLL_MS);
  const seen = useRef<Set<string> | null>(null);
  const { rows, refunds } = useMemo(() => {
    const byId = new Map<string, FeedRow>();
    for (const r of data ?? []) byId.set(r.id, r);
    const all = [...byId.values()].sort((a, b) => +new Date(b.at) - +new Date(a.at));
    // Refund lookup spans the whole fetched window (not just the displayed slice) so a void button never reappears for a refunded purchase.
    const refunds = new Map<string, FeedRow>();
    for (const r of all) if (r.kind === "refunded" && r.lithicToken && !refunds.has(r.lithicToken)) refunds.set(r.lithicToken, r);
    return { rows: all.slice(0, limit), refunds };
  }, [data, limit]);

  const fresh = new Set<string>();
  if (data) {
    if (seen.current === null) seen.current = new Set(rows.map((r) => r.id));
    else for (const r of rows) if (!seen.current.has(r.id)) fresh.add(r.id);
  }
  useEffect(() => { if (seen.current) for (const r of rows) seen.current.add(r.id); }, [rows]);

  return (
    <section aria-label="Live activity" aria-live="polite">
      {error && <div className="mb-2"><ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote></div>}
      {loading && !data ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{empty ?? "Nothing yet. Activity shows up here the moment it happens."}</p>
      ) : (
        <ul className="divide-y divide-zinc-200/70 dark:divide-zinc-800">{rows.map((r) => <FeedItem key={r.id} row={r} fresh={fresh.has(r.id)} voidable refund={r.lithicToken ? refunds.get(r.lithicToken) : undefined} />)}</ul>
      )}
    </section>
  );
}

export function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <span className="relative flex h-2 w-2"><span className="dot-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
      Live · every 1.5 s
    </span>
  );
}
