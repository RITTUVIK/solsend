"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ApiCallError, client, humanError, signAndSubmit } from "@/client/api";
import { usePoll } from "@/client/hooks";
import { KIND_LABEL, isPresetStore, sandboxName, type CardView } from "@/client/format";
import { AppShell, useAppData } from "@/components/AppShell";
import { CardVisual, StoreTile } from "@/components/CardVisual";
import { Stepper, type Stage } from "@/components/Stepper";
import { WalletSetup } from "@/components/WalletSetup";
import { ErrorNote, Icon, Spinner, radioKeys } from "@/components/ui";

type Kind = keyof typeof KIND_LABEL;
const MIN_PER_DAY = 1440;
const STORES: { name: string; kind: Kind; dollars: string; expires: number | null; tag: string }[] = [
  { name: "Temu", kind: "STORE_LOCKED", dollars: "40", expires: null, tag: "First try" },
  { name: "Amazon", kind: "STORE_LOCKED", dollars: "50", expires: null, tag: "Everyday" },
  { name: "Netflix", kind: "SUBSCRIPTION", dollars: "15.49", expires: 7 * MIN_PER_DAY, tag: "Free trial" },
  { name: "Other", kind: "ONE_TIME", dollars: "25", expires: null, tag: "One-time" },
];
const KINDS: { kind: Kind; title: string; hint: string }[] = [
  { kind: "STORE_LOCKED", title: "Store-locked", hint: "One lifetime cap" },
  { kind: "ONE_TIME", title: "One-time", hint: "Dies after one purchase" },
  { kind: "SUBSCRIPTION", title: "Subscription", hint: "Monthly cap" },
];
const EXPIRY: { label: string; short: string; minutes: number | null }[] = [
  { label: "Never", short: "never", minutes: null },
  { label: "After a 7-day free trial", short: "in 7 days", minutes: 7 * MIN_PER_DAY },
  { label: "14 days", short: "in 14 days", minutes: 14 * MIN_PER_DAY },
  { label: "30 days", short: "in 30 days", minutes: 30 * MIN_PER_DAY },
  { label: "2 minutes (demo)", short: "in 2 minutes", minutes: 2 },
];

function previewCard(o: { label: string; merchantName: string; kind: Kind; cents: number; expires: number | null }): CardView {
  const base = String(Math.max(0, o.cents) * 10_000);
  return {
    cardPda: "preview", cardId: "preview", label: o.label, merchantName: o.merchantName || "Store", kind: o.kind, status: "ACTIVE", issueState: "issued",
    lithic: { cardToken: null, lastFour: null, state: null },
    limit: { type: o.kind === "SUBSCRIPTION" ? "per_period" : "lifetime", totalBase: base, remainingBase: base, periodSecs: o.kind === "SUBSCRIPTION" ? 30 * 86400 : null },
    totals: { settledBase: "0", refundedBase: "0" }, merchantLocked: isPresetStore(o.merchantName), delegationLive: true, delegation: "preview",
    createdAt: new Date().toISOString(), registerSignature: null,
    expiresAt: o.expires != null ? new Date(Date.now() + o.expires * 60_000).toISOString() : null, expired: false,
  };
}

function Content() {
  const { cards, wallet } = useAppData();
  const [store, setStore] = useState("Temu");
  const [custom, setCustom] = useState("");
  const [kind, setKind] = useState<Kind>("STORE_LOCKED");
  const [dollars, setDollars] = useState("40");
  const [expires, setExpires] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [cardPda, setCardPda] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [needSetup, setNeedSetup] = useState(false);
  const [setupDone, setSetupDone] = useState(false);

  const merchantName = (store === "Other" ? custom.trim() : store) || "";
  const cents = Math.round(Number(dollars) * 100);
  const limitOk = Number.isFinite(cents) && cents >= 100 && cents <= 50_000;
  const cardLabel = label.trim() || (store === "Netflix" && expires != null ? "Netflix free trial" : `${merchantName || "Store"} card`);
  const preset = isPresetStore(merchantName);
  // Allowances can't create the SubscriptionAuthority and a delegation in one tx: setup must confirm first.
  const setupNeeded = needSetup || wallet.data?.subscriptionAuthorityReady === false;
  const formOk = merchantName.length > 0 && merchantName.length <= 32 && limitOk && !setupNeeded;
  const blocker = setupNeeded ? "Set up your wallet first ↑" : !merchantName ? "Name the store first" : !limitOk ? "Pick a limit between $1 and $500" : null;
  const exp = EXPIRY.find((e) => e.minutes === expires) ?? EXPIRY[0]!;

  const polled = usePoll(client.listCards, 2000, cardPda != null); // + AppShell 3 s poll = 50/min < 60/min server limit
  const card = useMemo(() => polled.data?.find((c) => c.cardPda === cardPda) ?? null, [polled.data, cardPda]);
  const preview = previewCard({ label: cardLabel, merchantName: merchantName || (store === "Other" ? "Your store" : store), kind, cents, expires });

  function pickStore(s: (typeof STORES)[number]) { setStore(s.name); setKind(s.kind); setDollars(s.dollars); setExpires(s.expires); }

  async function create() {
    setErr(null); setFailure(null); setStage("preparing");
    let prepared = false;
    try {
      await signAndSubmit(
        () => client.prepareCard({ kind, label: cardLabel.slice(0, 32), merchantName, limitCents: cents, ...(kind === "SUBSCRIPTION" ? { periodDays: 30 } : {}), ...(expires != null ? { expiresInMinutes: expires } : {}) }),
        // An automatic tx_expired retry re-runs prepare: it yields a NEW card, so track the latest cardPda.
        { onPrepared: (p) => { prepared = true; setCardPda(p.cardPda); setStage("signing"); }, onSigned: () => setStage("submitting") },
      );
      setStage("sent");
      void cards.refresh(); void polled.refresh();
    } catch (e) {
      if (!prepared && e instanceof ApiCallError && e.code === "setup_required") { setStage(null); setNeedSetup(true); return; }
      setFailure(humanError(e));
      if (!prepared) { setStage(null); setErr(humanError(e)); }
    }
  }

  async function retry() {
    if (!cardPda) return;
    setRetrying(true); setFailure(null);
    try { await client.retryIssue(cardPda); await polled.refresh(); void cards.refresh(); }
    catch (e) { setFailure(humanError(e)); }
    finally { setRetrying(false); }
  }

  // ── Progress / reveal ────────────────────────────────────────────────────────────
  if (stage) {
    const issued = card?.issueState === "issued";
    const shown: CardView = card ?? { ...preview, issueState: "onchain_pending" };
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.03em]" aria-live="polite">{issued ? `Your ${merchantName} card is ready` : "Creating your card"}</h1>
          <p className="mt-1 text-[15px] text-ink-2">{cardLabel} · up to ${(cents / 100).toFixed(2)}{kind === "SUBSCRIPTION" ? " a month" : ""} · only at {preset ? sandboxName(merchantName) : "its first store"}</p>
        </div>
        <div className="mx-auto w-full max-w-[380px]" key={issued ? "born" : "pending"}>
          <CardVisual card={shown} born={issued} />
        </div>
        <div className="surface"><Stepper card={card} stage={stage} onRetry={() => void retry()} retrying={retrying} failure={failure} /></div>
        {issued && card && (
          <div className="anim-rise flex flex-col gap-2 sm:flex-row-reverse">
            <Link href={`/merchant?card=${card.cardPda}`} className="btn-primary flex-1">Pay at the sandbox store</Link>
            <Link href={`/cards/${card.cardPda}`} className="btn-secondary flex-1" data-testid="open-card">View card</Link>
          </div>
        )}
        {failure && !card && <button type="button" className="btn-secondary w-full" onClick={() => { setStage(null); setFailure(null); }}>Back</button>}
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (formOk) void create(); }}>
      <div>
        <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.03em]">New card</h1>
        <p className="mt-1 text-[15px] text-ink-2">One card per store. It holds $0 and can only pull what you allow.</p>
      </div>

      {/* Live preview: what you configure is what you get */}
      <div className="-mt-1">
        <div className="mx-auto w-full max-w-[290px]"><CardVisual card={preview} showLimit /></div>
      </div>

      {(setupNeeded || setupDone) && <WalletSetup onDone={() => { setNeedSetup(false); setSetupDone(true); }} />}

      <fieldset className="min-w-0">
        <legend className="label">Store</legend>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" onKeyDown={radioKeys} aria-label="Store">
          {STORES.map((s) => (
            <button key={s.name} type="button" role="radio" aria-checked={store === s.name} onClick={() => pickStore(s)}
              className={`flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-[16px] px-1 transition ${store === s.name ? "bg-surface ring-2 ring-ink" : "bg-surface/60 ring-1 ring-line ring-inset hover:bg-surface"}`}>
              <StoreTile merchant={s.name === "Other" ? (custom.trim() || "Corner Cafe") : s.name} size={32} />
              <span className="text-[13px] font-semibold">{s.name}</span>
              <span className="text-[11px] leading-3 text-ink-3">{s.tag}</span>
            </button>
          ))}
        </div>
        {store === "Other" && (
          <div className="mt-3">
            <label className="label" htmlFor="custom-store">Store name</label>
            <input id="custom-store" className="input" value={custom} maxLength={32} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Corner Cafe" required />
          </div>
        )}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="label">Card type</legend>
        <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-sunken p-1" role="radiogroup" onKeyDown={radioKeys} aria-label="Card type">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)}
              className={`min-h-11 rounded-[11px] px-1 text-[14px] font-semibold transition ${kind === k.kind ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>{k.title}</button>
          ))}
        </div>
        <p className="mt-1.5 text-[13px] text-ink-3">{KINDS.find((k) => k.kind === kind)!.hint}</p>
      </fieldset>

      <div>
        <label className="label" htmlFor="limit">{kind === "SUBSCRIPTION" ? "Monthly limit (USD)" : "Lifetime limit (USD)"}</label>
        <div className="flex items-center gap-1 rounded-[14px] bg-surface px-3.5 ring-1 ring-line ring-inset focus-within:ring-2 focus-within:ring-ink">
          <span className="text-[22px] font-semibold text-ink-3" aria-hidden="true">$</span>
          <input id="limit" className="tnum min-h-14 w-full bg-transparent text-[22px] font-semibold outline-none" inputMode="decimal" type="number" min={1} max={500} step="0.01"
            value={dollars} onChange={(e) => setDollars(e.target.value)} aria-invalid={!limitOk} aria-describedby={!limitOk ? "limit-err" : undefined} required />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {["10", "25", "40", "100"].map((v) => <button key={v} type="button" className="pick" aria-pressed={Number(dollars) === Number(v)} onClick={() => setDollars(v)}>${v}</button>)}
        </div>
        {!limitOk && <p id="limit-err" className="mt-1.5 text-sm text-no" role="alert">Pick a limit between $1.00 and $500.00.</p>}
      </div>

      <fieldset className="min-w-0">
        <legend className="label">Auto-expire this card</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" onKeyDown={radioKeys} aria-label="Auto-expire this card">
          {EXPIRY.map((e) => (
            <button key={e.label} type="button" role="radio" aria-checked={expires === e.minutes} onClick={() => setExpires(e.minutes)} className="pick aria-checked:bg-ink aria-checked:text-paper aria-checked:ring-ink"
              data-testid={`expiry-${e.minutes ?? "never"}`}>{e.label}</button>
          ))}
        </div>
        <p className="mt-1.5 text-[13px] text-ink-3">Enforced onchain: after expiry, every pull fails — a free trial can&apos;t quietly roll into a paid plan.</p>
      </fieldset>

      <div>
        <label className="label" htmlFor="label">Card name</label>
        <input id="label" className="input" value={label} maxLength={32} placeholder={cardLabel} onChange={(e) => setLabel(e.target.value)} />
      </div>

      <div className="rounded-[16px] bg-surface p-4 text-[15px] leading-[22px] text-ink-2 ring-1 ring-line ring-inset" data-testid="explain">
        <p>
          <strong className="text-ink">Your USDC stays in your wallet.</strong> This card can pull at most <strong className="tnum text-ink">${limitOk ? (cents / 100).toFixed(2) : "X"}</strong>
          {kind === "SUBSCRIPTION" ? " per month" : ""}, only at <strong className="text-ink">{merchantName ? (preset ? `${merchantName} (sandbox)` : "the first store that charges it") : "the store you pick"}</strong>
          {expires != null ? <>, and it expires <strong className="text-ink">{exp.short}</strong></> : null}.
        </p>
        <p className="mt-1.5 text-[13px] text-ink-3">{preset ? `Locked to ${merchantName} (sandbox) from the moment it's created, so a leaked number is useless anywhere else.` : "Other-store cards lock to the first store that charges them."} You&apos;ll approve one signature in your wallet.</p>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] z-10 -mx-4 bg-gradient-to-t from-paper from-70% to-transparent px-4 pb-3 pt-4 sm:static sm:mx-0 sm:bg-none sm:p-0">
        <button type="submit" disabled={!formOk} className="btn-primary w-full !min-h-14 !text-[17px]" data-testid="create-card" aria-describedby={blocker ? "create-blocker" : undefined}>
          {stage === "preparing" ? <Spinner /> : <Icon name="plus" className="h-5 w-5" strokeWidth={2.4} />}Create {merchantName || "store"} card · ${limitOk ? (cents / 100).toFixed(2) : "—"}
        </button>
        {blocker && <p id="create-blocker" className="mt-1.5 text-center text-[13px] text-ink-3">{blocker}</p>}
      </div>
    </form>
  );
}

export default function NewCardPage() {
  return <AppShell><Content /></AppShell>;
}
