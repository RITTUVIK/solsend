"use client";
// Lithic's hosted card fields via the official `lithic-embed` SDK (modern embed flow).
// Lithic renders these iframes MASKED by default (PAN shows only the last 4); the SDK's toggleMasking() asks the iframes
// (postMessage to Lithic's origin only) to fetch + reveal the details INSIDE Lithic's origin. PAN/CVV/expiry never touch
// SolSend's servers, this page's DOM, logs, or analytics. We only hold the short-lived, single-use session.
import { useEffect, useRef, useState } from "react";
import type { CardEmbed } from "lithic-embed";
import { Spinner } from "./ui";

type Phase = "loading" | "revealed" | "masked" | "error";
type FieldKey = "pan" | "expMonth" | "expYear" | "cvv";
const FIELDS: readonly { k: FieldKey; label: string; cls: string }[] = [
  { k: "pan", label: "Card number", cls: "col-span-3" },
  { k: "expMonth", label: "Exp. month", cls: "" },
  { k: "expYear", label: "Exp. year", cls: "" },
  { k: "cvv", label: "CVV", cls: "" },
];

/** Error text without any session/URL: SDK error class + Lithic's error code / request id (both non-sensitive). */
function describe(e: unknown): string {
  const x = e as { name?: string; code?: string; requestId?: string } | null;
  const code = x?.code ? ` (${x.code}${x.requestId ? ` · request ${x.requestId}` : ""})` : "";
  if (x?.name === "EmbedMountError") return "Lithic's secure frame didn't load in time. Tap Details to try again.";
  return `Lithic couldn't show the card details${code}. Tap Details to try again.`;
}

export function LithicSecureFields({ session, testIdPrefix = "embed" }: { session: string; testIdPrefix?: string }) {
  const pan = useRef<HTMLDivElement>(null), expMonth = useRef<HTMLDivElement>(null), expYear = useRef<HTMLDivElement>(null), cvv = useRef<HTMLDivElement>(null);
  const refs = { pan, expMonth, expYear, cvv };
  const embed = useRef<CardEmbed | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [err, setErr] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let card: CardEmbed | null = null;
    setPhase("loading"); setErr(null);
    (async () => {
      try {
        const { default: LithicEmbed, Environment } = await import("lithic-embed"); // own chunk: loaded only on "Details"
        if (cancelled) return;
        card = new LithicEmbed(Environment.SANDBOX).card(session, { timeoutMs: 15_000 });
        embed.current = card;
        await card.mount({ pan: { element: pan.current! }, expMonth: { element: expMonth.current! }, expYear: { element: expYear.current! }, cvv: { element: cvv.current! } });
        if (cancelled) return;
        // The owner explicitly tapped "Details": reveal immediately (first reveal fetches the details inside Lithic's frames).
        const changed = await card.toggleMasking();
        if (!cancelled) setPhase(changed ? "revealed" : "masked");
      } catch (e) {
        if (!cancelled) { setPhase("error"); setErr(describe(e)); }
      }
    })();
    return () => { cancelled = true; embed.current = null; void card?.unmount().catch(() => {}); };
  }, [session]);

  async function toggle() {
    const card = embed.current;
    if (!card || toggling) return;
    setToggling(true);
    try { if (await card.toggleMasking()) setPhase((p) => (p === "revealed" ? "masked" : "revealed")); }
    catch (e) { setPhase("error"); setErr(describe(e)); }
    finally { setToggling(false); }
  }

  return (
    <div data-testid={`${testIdPrefix}-sdk`} data-phase={phase}>
      <div className="grid grid-cols-3 gap-2.5" aria-busy={phase === "loading"}>
        {FIELDS.map(({ k, label, cls }) => (
          <div key={k} className={cls}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">{label}</p>
            {/* Mount target: the SDK appends Lithic's iframe here and syncs color/font/letter-spacing/line-height from it. */}
            <div ref={refs[k]} className="h-12 w-full overflow-hidden rounded-[10px] bg-white/[0.06] px-3 font-mono text-[17px] font-medium leading-[48px] tracking-[0.04em] text-white" data-testid={`${testIdPrefix}-${k}`} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex min-h-8 items-center justify-between gap-3" aria-live="polite">
        {phase === "loading" && <p className="flex items-center gap-2 text-[13px] text-white/75"><Spinner />Loading from Lithic&apos;s secure frame…</p>}
        {phase === "error" && <p className="text-[13px] text-[#ffb4a8]" role="alert" data-testid={`${testIdPrefix}-error`}>{err}</p>}
        {(phase === "revealed" || phase === "masked") && (
          <>
            <p className="text-[13px] text-white/75">{phase === "revealed" ? "Details shown." : "Details hidden."}</p>
            <button type="button" onClick={() => void toggle()} disabled={toggling} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/20 disabled:opacity-60" data-testid={`${testIdPrefix}-mask`}>
              {phase === "revealed" ? "Mask numbers" : "Show numbers"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
