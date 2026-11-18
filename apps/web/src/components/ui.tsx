"use client";
import type { ReactNode } from "react";
import { explorerAddress, explorerTx } from "@solsend/shared";
import { MOCK } from "@/client/config";
import { isMockSig, shortId } from "@/client/format";

const ICONS: Record<string, string> = {
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v10m-2.5-7.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6S13 12 12 12s-2.5.6-2.5 1.9S10.5 16 12 16s2.5-.5 2.5-1.5",
  refund: "M4 9h11a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4",
  snow: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  plus: "M12 5v14M5 12h14",
  drop: "M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.700 12 3.500 12 3.500Z",
  shield: "M12 3 5 6v5c0 4.500 3 8 7 10 4-2 7-5.500 7-10V6l-7-3Zm-3 9 2.500 2.500L15.500 10",
  bolt: "M13 3 5 13h6l-1 8 8-10h-6l1-8Z",
  ext: "M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  home: "M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z",
  store: "M4 9l1.500-5h13L20 9M4 9v10h16V9M4 9c0 1.700 1.300 3 2.700 3S9.300 10.700 9.300 9c0 1.700 1.300 3 2.700 3s2.700-1.300 2.700-3c0 1.700 1.300 3 2.700 3S20 10.700 20 9",
  pulse: "M3 12h4l2.500-6 4 12L16 12h5",
  warn: "M12 4 2.500 20h19L12 4Zm0 6v5m0 2.500v.01",
};
export function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof ICONS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.card} />
    </svg>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

export function MockBadge({ className = "" }: { className?: string }) {
  if (!MOCK) return null;
  return <span className={`chip bg-fuchsia-600 text-white ${className}`} title="Running against in-browser fixtures. Signatures are fake and not on devnet.">MOCK DATA</span>;
}

export function SandboxChip({ children = "SANDBOX" }: { children?: ReactNode }) {
  return <span className="sandbox-chip">{children}</span>;
}

/** Explorer link for a devnet signature. Mock signatures are flagged, never presented as real. */
export function SigLink({ sig, label = "View on Solana Explorer (devnet)", kind = "tx" }: { sig: string; label?: string; kind?: "tx" | "address" }) {
  const href = kind === "tx" ? explorerTx(sig) : explorerAddress(sig);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <a href={href} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-sm">
        {label}<Icon name="ext" className="h-3.5 w-3.5" />
      </a>
      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" title={sig}>{shortId(sig, 6)}</code>
      {isMockSig(sig) && <span className="chip bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-200">MOCK signature, not on devnet</span>}
    </span>
  );
}

export function ErrorNote({ children, onRetry, retryLabel = "Try again" }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
      <Icon name="warn" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onRetry && <button type="button" onClick={onRetry} className="btn-secondary !min-h-9 !px-3 !py-1">{retryLabel}</button>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
