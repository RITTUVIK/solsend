"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { explorerAddress, explorerTx } from "@solsend/shared";
import { MOCK } from "@/client/config";
import { isMockSig, shortId } from "@/client/format";

const ICONS: Record<string, string> = {
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v10m-2.5-7.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6S13 12 12 12s-2.5.6-2.5 1.9S10.5 16 12 16s2.5-.5 2.5-1.5",
  refund: "M4 9h11a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  snow: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  plus: "M12 5v14M5 12h14",
  drop: "M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5Z",
  shield: "M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Zm-3 9 2.5 2.5L15.5 10",
  bolt: "M13 3 5 13h6l-1 8 8-10h-6l1-8Z",
  ext: "M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  home: "M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z",
  store: "M4 9l1.5-5h13L20 9M4 9v10h16V9M4 9c0 1.7 1.3 3 2.7 3S9.3 10.7 9.3 9c0 1.7 1.3 3 2.7 3s2.7-1.3 2.7-3c0 1.7 1.3 3 2.7 3S20 10.7 20 9",
  pulse: "M3 12h4l2.5-6 4 12L16 12h5",
  warn: "M12 4 2.5 20h19L12 4Zm0 6v5m0 2.5v.01",
  copy: "M9 9h10v11H9zM5 15V4h10",
  chevron: "m6 9 6 6 6-6",
  chain: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9v.01",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  wallet: "M4 7a2 2 0 0 1 2-2h12v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2Zm12 7h.01",
  flask: "M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3M7.5 15h9",
  one: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-1.5-12.5L12 7.5v9",
};
export function Icon({ name, className = "h-5 w-5", strokeWidth = 1.8 }: { name: keyof typeof ICONS | string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.card} />
    </svg>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}

/** Mock mode marker: quiet outline pill next to the logo (never loud). */
export function MockBadge({ className = "" }: { className?: string }) {
  if (!MOCK) return null;
  return <span className={`chip px-2 text-mock ring-1 ring-mock-line ${className}`} title="Running against in-browser fixtures. Signatures are fake and not on devnet.">MOCK DATA</span>;
}

/** One local sandbox mark per surface (the global banner covers the rest). */
export function SandboxChip({ children = "Sandbox" }: { children?: ReactNode }) {
  return <span className="sandbox-chip">{children}</span>;
}

export function MockTag() {
  return <span className="chip shrink-0 px-1.5 text-[10px] leading-4 text-mock ring-1 ring-mock-line" title="MOCK signature, not on devnet">MOCK</span>;
}

/** Onchain glyph: violet = proof that lives on Solana. */
export function OnchainGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-[6px] bg-onchain text-white ${className}`} aria-hidden="true">
      <Icon name="chain" className="h-3/5 w-3/5" strokeWidth={2.2} />
    </span>
  );
}

/** "Streamed by QuickNode" badge: shown once per receipt / page header, never per row. */
export function QuickNodeBadge({ label = "Streamed by QuickNode" }: { label?: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-sunken px-2.5 text-[11px] font-semibold text-ink-2">
      <span className="relative flex h-1.5 w-1.5"><span className="dot-ping absolute inline-flex h-full w-full rounded-full bg-mint" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" /></span>
      {label}
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-ink-2 hover:bg-sunken"
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}
      aria-label={`Copy ${label}`}>
      <Icon name={done ? "check" : "copy"} className="h-3.5 w-3.5" />{done ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * ProofRow: the ONE way onchain evidence is shown. Collapsed: a 44px row linking to the devnet explorer.
 * `details` (optional) expands under a chevron; it's always in the DOM (hidden) so tests/readers can find it.
 */
export function ProofRow({ sig, title, linkLabel, kind = "tx", details, defaultOpen = false, testId }: {
  sig: string; title: string; linkLabel?: string; kind?: "tx" | "address"; details?: ReactNode; defaultOpen?: boolean; testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const href = kind === "tx" ? explorerTx(sig) : explorerAddress(sig);
  return (
    <div className="rounded-[14px] bg-sunken/70" data-testid={testId}>
      <div className="flex min-h-11 items-center gap-1 pr-1">
        <a href={href} target="_blank" rel="noreferrer" aria-label={linkLabel ?? `${title}: view on Solana Explorer (devnet)`}
          className="group flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] px-3 hover:bg-sunken">
          <OnchainGlyph className="h-5 w-5" />
          <span className="min-w-0 truncate text-[13px] font-medium text-ink-2">{title}</span>
          <code className={`ml-auto shrink-0 font-mono text-[12px] text-ink-3 ${isMockSig(sig) ? "max-[420px]:hidden" : ""}`} title={sig}>{shortId(sig, 4)}</code>
          <Icon name="ext" className="h-3.5 w-3.5 shrink-0 text-ink-3 group-hover:text-ink" />
        </a>
        {isMockSig(sig) && <MockTag />}
        {details && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label={open ? "Hide proof details" : "Show proof details"}>
            <Icon name="chevron" className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {details && (
        <div id={id} hidden={!open} className="border-t border-line px-3 pb-3 pt-2 text-[13px]">
          <dl className="space-y-2">
            <ProofField k="Signature"><span className="flex items-start gap-1"><code className="min-w-0 break-all font-mono text-[12px] text-ink-2">{sig}</code><CopyButton value={sig} label="signature" /></span></ProofField>
            {details}
          </dl>
        </div>
      )}
    </div>
  );
}
export function ProofField({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-baseline gap-2">
      <dt className="text-[12px] font-medium text-ink-3">{k}</dt>
      <dd className="min-w-0 break-words text-ink-2">{children}</dd>
    </div>
  );
}

/** Back-compat wrapper: every former SigLink is now a compact ProofRow. */
export function SigLink({ sig, label = "View on Solana Explorer (devnet)", kind = "tx", title }: { sig: string; label?: string; kind?: "tx" | "address"; title?: string }) {
  return <ProofRow sig={sig} kind={kind} title={title ?? "Recorded on Solana devnet"} linkLabel={label} />;
}

export function ErrorNote({ children, onRetry, retryLabel = "Try again", tone = "error" }: { children: ReactNode; onRetry?: () => void; retryLabel?: string; tone?: "error" | "warn" | "info" }) {
  const t = tone === "error" ? "bg-no-bg text-no" : tone === "warn" ? "bg-warn-bg text-warn" : "bg-sunken text-ink-2";
  return (
    <div role={tone === "info" ? "status" : "alert"} className={`rounded-[14px] p-3 text-sm ${t}`}>
      <div className="flex items-start gap-2.5">
        <Icon name={tone === "info" ? "clock" : "warn"} className="mt-0.5 h-4.5 w-4.5 shrink-0" />
        <div className="min-w-0 flex-1 text-ink-2 [&_strong]:text-ink">{children}</div>
      </div>
      {onRetry && <button type="button" onClick={onRetry} className="btn-primary mt-3 w-full !min-h-11">{retryLabel}</button>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.03em]">{title}</h1>
        {sub && <p className="mt-1 text-[15px] leading-[22px] text-ink-2">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** Native <dialog> sheet: bottom sheet on mobile; `side` = right panel / `center` = modal on ≥1024px. */
export function Sheet({ open, onClose, children, labelledBy, variant = "center", testId, dismissible = true, className = "" }: {
  open: boolean; onClose: () => void; children: ReactNode; labelledBy: string; variant?: "side" | "center"; testId?: string; dismissible?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => { e.preventDefault(); if (dismissible) closeRef.current(); };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [dismissible]);
  if (!open) return null;
  return (
    <dialog ref={ref} aria-labelledby={labelledBy} className={`sheet ${variant === "side" ? "sheet-side" : "sheet-center"}`}
      onClick={(e) => { if (e.target === e.currentTarget && dismissible) onClose(); }} data-testid={testId}>
      <div className={`sheet-body max-h-[92dvh] overflow-y-auto rounded-t-[28px] bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2.5 shadow-2xl ${className}`}>
        <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-line lg:hidden" aria-hidden="true" />
        {children}
      </div>
    </dialog>
  );
}

/** Small "ⓘ" disclosure (inline, no popover lib). */
export function InfoDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} aria-label={label}
        className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-full align-middle text-ink-3 hover:bg-sunken hover:text-ink">
        <Icon name="info" className="h-4 w-4" />
      </button>
      <div id={id} hidden={!open} className="anim-fade mt-2 rounded-[14px] bg-sunken p-3 text-[13px] leading-5 text-ink-2">{children}</div>
    </>
  );
}

export function useCountTo(target: number, ms = 600): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setV(target); from.current = target; return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(start + (target - start) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return v;
}
