"use client";
import { cardArt } from "@/client/cardArt";
import { KIND_LABEL, displayStatus, expiresIn, limitSuffix, sandboxName, usd, type CardView, type DisplayStatus } from "@/client/format";
import { Icon } from "./ui";

const KIND_ICON = { STORE_LOCKED: "lock", ONE_TIME: "one", SUBSCRIPTION: "repeat" } as const;
const DEAD: DisplayStatus[] = ["Closed", "Revoked", "Used", "Expired", "Failed"];

/** A thin remaining-limit bar (on paper, below a card). */
export function LimitBar({ card }: { card: CardView }) {
  const status = displayStatus(card);
  const ended = status === "Expired" || status === "Revoked" || status === "Closed";
  const total = Number(card.limit.totalBase) || 1;
  const remaining = ended ? 0 : Number(card.limit.remainingBase);
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        {ended
          ? <p className="text-[15px] text-ink-2"><strong className="tnum text-[17px] font-semibold text-ink">{usd(0n)}</strong> can be pulled · {status.toLowerCase()}</p>
          : <p className="text-[15px] text-ink-2"><strong className="tnum text-[17px] font-semibold text-ink">{usd(card.limit.remainingBase)}</strong> of {usd(card.limit.totalBase)} left</p>}
        <p className="text-[13px] text-ink-3">{limitSuffix(card)}</p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Remaining limit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <div className="h-full rounded-full bg-ink transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The card. 1.586:1, per-store art, state ON the face. Never shows a PAN: only the last four from the API.
 * `showLimit` puts "$28 left" top-right (wallet list); the detail page shows the limit below the card instead.
 */
export function CardVisual({ card, showLimit = false, idle = false, born = false, size = "full", className = "" }: { card: CardView; showLimit?: boolean; idle?: boolean; born?: boolean; size?: "full" | "small" | "mini"; className?: string }) {
  const status = displayStatus(card);
  const art = cardArt(card.merchantName);
  const dead = DEAD.includes(status);
  const exp = expiresIn(card);
  const warnRing = status === "Needs retry" || (idle && status === "Active");
  if (size !== "full") {
    const mini = size === "mini";
    return (
      <div className={`relative aspect-[1.586] w-full overflow-hidden ${mini ? "rounded-[10px]" : "rounded-[16px]"} text-white shadow-[0_1px_0_rgb(255_255_255/.2)_inset,0_10px_22px_-12px_rgb(11_12_14/.55)] ${className}`} data-status={status}>
        <div className={`card-noise card-sheen absolute inset-0 rounded-[inherit] ${dead ? "opacity-75 grayscale" : status === "Frozen" ? "saturate-[.55]" : ""}`} style={{ background: art.background }} aria-hidden="true" />
        {art.accentBar && <div className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: art.accentBar }} aria-hidden="true" />}
        <div className={`card-ink relative flex h-full flex-col justify-between ${mini ? "p-2" : "p-3"}`}>
          <div className="flex items-start justify-between gap-2">
            <span className={`grid shrink-0 place-items-center rounded-[7px] bg-white/18 font-bold ring-1 ring-white/25 ${mini ? "h-5 w-5 text-[11px]" : "h-7 w-7 text-[14px]"}`} aria-hidden="true">{art.monogram}</span>
            {!mini && showLimit && !dead && <p className="tnum text-right text-[14px] font-semibold leading-4">{usd(card.limit.remainingBase)}<span className="block text-[10px] font-medium text-white">left</span></p>}
            {!mini && (dead || status === "Frozen") && <span className="rounded bg-black/40 px-1.5 text-[10px] font-bold uppercase tracking-[0.1em]">{status}</span>}
          </div>
          <div className="flex items-end justify-between gap-1">
            <p className={`tnum font-mono font-medium tracking-[0.1em] ${mini ? "text-[9px]" : "text-[12px]"}`}>•••• {card.lithic.lastFour ?? "••••"}</p>
            {!mini && <Icon name={KIND_ICON[card.kind]} className="h-3.5 w-3.5 text-white" strokeWidth={2.2} />}
          </div>
        </div>
        {!mini && <span className="sr-only">{card.label}, {sandboxName(card.merchantName)}, {status}</span>}
      </div>
    );
  }
  return (
    <div className={`@container relative aspect-[1.586] w-full overflow-hidden rounded-[20px] text-white shadow-[0_1px_0_rgb(255_255_255/.2)_inset,0_14px_32px_-14px_rgb(11_12_14/.55)] ${born ? "anim-born" : ""} ${className}`}
      data-status={status}>
      <div className={`card-noise card-sheen absolute inset-0 rounded-[inherit] transition-[filter,opacity] duration-300 ${dead ? "opacity-75 grayscale" : status === "Frozen" ? "saturate-[.55]" : ""}`} style={{ background: art.background }} aria-hidden="true" />
      {art.accentBar && <div className={`absolute inset-x-0 bottom-0 h-[3px] ${dead ? "opacity-40" : ""}`} style={{ background: art.accentBar }} aria-hidden="true" />}
      {born && <div className="card-sweep pointer-events-none absolute inset-0 rounded-[inherit]" aria-hidden="true" />}
      {status === "Setting up" && <div className="skeleton !absolute inset-0 !rounded-[inherit] !bg-transparent" aria-hidden="true" />}

      <div className="card-ink relative flex h-full flex-col justify-between p-[clamp(14px,5.2cqw,22px)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/18 text-[17px] font-bold ring-1 ring-white/25 backdrop-blur-sm" aria-hidden="true">{art.monogram}</span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-5 tracking-[-0.01em]">{card.label}</p>
              <p className="truncate text-[13px] font-medium leading-4 text-white">{sandboxName(card.merchantName)}</p>
            </div>
          </div>
          {showLimit && !dead ? (
            <div className="shrink-0 text-right">
              <p className="tnum text-[17px] font-semibold leading-5 tracking-[-0.02em]">{usd(card.limit.remainingBase)}</p>
              <p className="text-[12px] font-medium leading-4 text-white">left of {usd(card.limit.totalBase)}</p>
            </div>
          ) : (status === "Setting up" || warnRing) ? null : (
            <span className="shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">Sandbox</span>
          )}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {exp && <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold backdrop-blur-sm" data-testid="expiry-chip"><Icon name="clock" className="h-3 w-3" />{exp}</p>}
            <p className="tnum font-mono text-[clamp(14px,4.6cqw,18px)] font-medium tracking-[0.12em]">•••• {card.lithic.lastFour ?? "••••"}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white"><Icon name={KIND_ICON[card.kind]} className="h-3.5 w-3.5" strokeWidth={2.2} />{KIND_LABEL[card.kind]}</p>
            {showLimit && !dead && <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">Sandbox</p>}
          </div>
        </div>
      </div>

      {status === "Frozen" && (
        <div className="anim-fade absolute inset-0 grid place-items-center rounded-[inherit] bg-[linear-gradient(135deg,rgb(255_255_255/.28),rgb(200_225_255/.18))]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[13px] font-semibold"><Icon name="snow" className="h-4 w-4" />Frozen</span>
        </div>
      )}
      {dead && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="anim-stamp rounded-md border-2 border-white/80 bg-black/35 px-3 py-1 text-[13px] font-bold uppercase tracking-[0.16em]">{status}</span>
        </div>
      )}
      {(status === "Setting up" || warnRing) && (
        <div className={`absolute inset-0 rounded-[inherit] ${warnRing ? "ring-[3px] ring-inset ring-[#FFB547]" : ""}`}>
          <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-semibold ${warnRing ? "bg-[#FFB547] text-[#3A2400]" : "bg-black/40"}`}>
            {status === "Setting up" ? "Setting up…" : status === "Needs retry" ? "Needs retry" : "Idle"}
          </span>
        </div>
      )}
      <span className="sr-only">{card.label}, {sandboxName(card.merchantName)}, {status}, {usd(card.limit.remainingBase)} left of {usd(card.limit.totalBase)}</span>
    </div>
  );
}

/** Small swatch tile (monogram on store art) for lists, pickers and activity rows. */
export function StoreTile({ merchant, size = 36, className = "" }: { merchant: string; size?: number; className?: string }) {
  const art = cardArt(merchant);
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[10px] font-bold text-white ${className}`} style={{ width: size, height: size, background: art.background, fontSize: Math.round(size * 0.44) }} aria-hidden="true">
      {art.monogram}
      {art.accentBar && <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: art.accentBar }} />}
    </span>
  );
}
