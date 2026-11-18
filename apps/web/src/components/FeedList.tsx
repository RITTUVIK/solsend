"use client";
import { useEffect, useMemo, useRef } from "react";
import { explorerTx } from "@solsend/shared";
import { client } from "@/client/api";
import { FEED_POLL_MS } from "@/client/config";
import { usePoll } from "@/client/hooks";
import { isMockSig, sandboxName, shortId, timeAgo, usd, type FeedRow } from "@/client/format";
import { ErrorNote, Icon, Skeleton } from "./ui";

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

export function FeedItem({ row, fresh }: { row: FeedRow; fresh: boolean }) {
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
  const rows = useMemo(() => {
    const byId = new Map<string, FeedRow>();
    for (const r of data ?? []) byId.set(r.id, r);
    return [...byId.values()].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, limit);
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
        <ul className="divide-y divide-zinc-200/70 dark:divide-zinc-800">{rows.map((r) => <FeedItem key={r.id} row={r} fresh={fresh.has(r.id)} />)}</ul>
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
