"use client";
import { useCountTo, Icon } from "./ui";
import { StoreTile } from "./CardVisual";
import { usd } from "@/client/format";

/**
 * "Money never leaves your wallet until a swipe": wallet ─ ─ allowance ─ ─ ▶ store.
 * Dashed line = permission, not money. A single coin travels only when a payment actually settles.
 * Numbers shown are always server values (never animated toward a guess).
 */
export function AllowanceFlow({ walletBase, merchant, merchantLabel, state, capLabel }: {
  walletBase: bigint | null; merchant: string; merchantLabel: string; state: "idle" | "pulling" | "done" | "declined"; capLabel?: string;
}) {
  const shown = useCountTo(walletBase == null ? 0 : Number(walletBase) / 1e6, 650);
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-ink text-paper"><Icon name="wallet" className="h-5 w-5" /></span>
        <span className="tnum text-[12px] font-semibold text-ink">{walletBase == null ? "—" : `$${shown.toFixed(2)}`}</span>
      </div>
      <div className="relative mb-5 h-6 flex-1">
        <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-ink-3/50" />
        {capLabel && <span className="absolute inset-x-0 -top-3 text-center text-[11px] font-medium text-ink-3">{capLabel}</span>}
        {state === "pulling" && <span className="rm-hide absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint shadow-[0_0_12px_var(--mint)] [animation:coin_1.1s_var(--ease-out)_infinite]" />}
        {state === "done" && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint shadow-[0_0_12px_var(--mint)] [animation:coin_.9s_var(--ease-out)_1_both]" />}
        {state === "declined" && (
          <>
            <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-3 [animation:coin-stop_.6s_var(--ease-out)_1_both]" />
            <span className="anim-shake absolute left-[78%] top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-no-bg text-no"><Icon name="lock" className="h-3.5 w-3.5" strokeWidth={2.2} /></span>
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <StoreTile merchant={merchant} size={40} className="!rounded-[12px]" />
        <span className="max-w-[84px] truncate text-[12px] font-semibold text-ink">{merchantLabel}</span>
      </div>
    </div>
  );
}

export function WalletDelta({ before, after, approved }: { before: bigint | null; after: bigint | null; approved: boolean }) {
  const a = useCountTo(after == null ? (before == null ? 0 : Number(before)) / 1e6 : Number(after) / 1e6, 650);
  if (before == null) return null;
  const moved = after != null && after !== before;
  return (
    <p className="tnum text-[15px] text-ink-2" data-testid="wallet-delta">
      <span className="text-ink-3">Wallet</span> {usd(before)}
      {moved ? <> <span aria-hidden="true" className="text-ink-3">→</span><span className="sr-only">now</span> <strong className="font-semibold text-ink">${a.toFixed(2)}</strong></>
        : approved ? <span className="text-ink-3"> → updating…</span> : <span className="text-ink-3"> · didn&apos;t move</span>}
    </p>
  );
}
