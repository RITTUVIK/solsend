"use client";
import { KIND_LABEL, displayStatus, limitSuffix, usd, type CardView, type DisplayStatus } from "@/client/format";
import { Icon } from "./ui";

const THEMES: Record<string, string> = {
  temu: "from-orange-600 via-orange-700 to-rose-700",
  amazon: "from-zinc-800 via-zinc-900 to-black",
  netflix: "from-red-700 via-red-800 to-zinc-950",
  default: "from-indigo-600 via-violet-700 to-fuchsia-800",
};
export const themeFor = (name: string): string => THEMES[name.trim().toLowerCase()] ?? THEMES.default!;

const STATUS_STYLE: Record<DisplayStatus, string> = {
  Active: "bg-emerald-400/90 text-emerald-950",
  Frozen: "bg-sky-300 text-sky-950",
  Used: "bg-zinc-300 text-zinc-900",
  Closed: "bg-zinc-400 text-zinc-950",
  Revoked: "bg-rose-300 text-rose-950",
  "Setting up": "bg-amber-300 text-amber-950",
  "Needs retry": "bg-amber-300 text-amber-950",
  Failed: "bg-rose-300 text-rose-950",
};

export function StatusPill({ status }: { status: DisplayStatus }) {
  return <span className={`chip ${STATUS_STYLE[status]}`}>{status}</span>;
}

export function LimitBar({ card, tone = "light" }: { card: CardView; tone?: "light" | "plain" }) {
  const total = Number(card.limit.totalBase) || 1;
  const remaining = Number(card.limit.remainingBase);
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const track = tone === "light" ? "bg-white/25" : "bg-zinc-200 dark:bg-zinc-700";
  const fill = tone === "light" ? "bg-white" : "bg-emerald-500";
  const text = tone === "light" ? "text-white/90" : "text-zinc-600 dark:text-zinc-400";
  return (
    <div>
      <div className={`flex items-baseline justify-between text-xs ${text}`}>
        <span><strong className="text-sm tabular-nums">{usd(card.limit.remainingBase)}</strong> left</span>
        <span className="tabular-nums">of {usd(card.limit.totalBase)} {limitSuffix(card)}</span>
      </div>
      <div className={`mt-1.5 h-2 w-full overflow-hidden rounded-full ${track}`} role="progressbar" aria-label="Remaining limit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className={`h-full rounded-full ${fill} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The visual card. Never shows a PAN: only the last four from the API. */
export function CardVisual({ card, large = false }: { card: CardView; large?: boolean }) {
  const status = displayStatus(card);
  const dim = status === "Closed" || status === "Revoked" || status === "Used" || status === "Failed";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${themeFor(card.merchantName)} p-4 text-white shadow-lg ${large ? "min-h-52 sm:p-6" : "min-h-44"} ${dim ? "saturate-0 opacity-80" : ""} ${status === "Frozen" ? "saturate-50 brightness-110" : ""}`}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-16 -left-8 h-44 w-44 rounded-full bg-black/10" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold leading-tight">{card.label}</p>
          <p className="truncate text-xs text-white/80">{card.merchantName} (sandbox)</p>
        </div>
        <StatusPill status={status} />
      </div>
      <div className="relative mt-4 flex items-center gap-2 text-white/90">
        <Icon name={card.kind === "SUBSCRIPTION" ? "refund" : card.kind === "ONE_TIME" ? "bolt" : "lock"} className="h-4 w-4" />
        <span className="chip bg-black/25 text-white">{KIND_LABEL[card.kind]}</span>
        {status === "Frozen" && <Icon name="snow" className="h-4 w-4" />}
      </div>
      <div className="relative mt-3 flex items-end justify-between gap-2">
        <p className="font-mono text-base tracking-[.18em] tabular-nums">•••• {card.lithic.lastFour ?? "••••"}</p>
        <span className="chip bg-amber-300 text-amber-950">SANDBOX</span>
      </div>
      <div className="relative mt-3"><LimitBar card={card} /></div>
    </div>
  );
}
