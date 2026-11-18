"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ApiCallError, client, humanError, signAndSubmit } from "@/client/api";
import { usePoll } from "@/client/hooks";
import { KIND_LABEL, isPresetStore } from "@/client/format";
import { AppShell, useAppData } from "@/components/AppShell";
import { Stepper, type Stage } from "@/components/Stepper";
import { WalletSetup } from "@/components/WalletSetup";
import { ErrorNote, PageTitle, Spinner } from "@/components/ui";

type Kind = keyof typeof KIND_LABEL;
const STORES = [
  { name: "Temu", kind: "STORE_LOCKED" as Kind, dollars: "40" },
  { name: "Amazon", kind: "STORE_LOCKED" as Kind, dollars: "50" },
  { name: "Netflix", kind: "SUBSCRIPTION" as Kind, dollars: "15.49" },
  { name: "Other", kind: "STORE_LOCKED" as Kind, dollars: "25" },
];
const KINDS: { kind: Kind; title: string; hint: string }[] = [
  { kind: "STORE_LOCKED", title: "Store-locked", hint: "Lifetime cap" },
  { kind: "ONE_TIME", title: "One-time", hint: "Dies after one purchase" },
  { kind: "SUBSCRIPTION", title: "Subscription", hint: "Monthly cap" },
];

function Content() {
  const { cards, wallet } = useAppData();
  const [store, setStore] = useState("Temu");
  const [custom, setCustom] = useState("");
  const [kind, setKind] = useState<Kind>("STORE_LOCKED");
  const [dollars, setDollars] = useState("40");
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
  const cardLabel = label.trim() || `${merchantName || "Store"} card`;
  const preset = isPresetStore(merchantName);
  // Allowances can't create the SubscriptionAuthority and a delegation in one tx: setup must confirm first.
  const setupNeeded = needSetup || wallet.data?.subscriptionAuthorityReady === false;
  const formOk = merchantName.length > 0 && merchantName.length <= 32 && limitOk && !setupNeeded;

  const polled = usePoll(client.listCards, 1200, cardPda != null);
  const card = useMemo(() => polled.data?.find((c) => c.cardPda === cardPda) ?? null, [polled.data, cardPda]);

  function pickStore(s: (typeof STORES)[number]) { setStore(s.name); setKind(s.kind); setDollars(s.dollars); }

  async function create() {
    setErr(null); setFailure(null); setStage("preparing");
    let prepared = false;
    try {
      const prep = await client.prepareCard({
        kind, label: cardLabel.slice(0, 32), merchantName, limitCents: cents, ...(kind === "SUBSCRIPTION" ? { periodDays: 30 } : {}),
      });
      prepared = true;
      setCardPda(prep.cardPda);
      setStage("signing");
      await signAndSubmit(prep, () => setStage("submitting"));
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

  // ── Progress screen ────────────────────────────────────────────────────────────
  if (stage) {
    const issued = card?.issueState === "issued";
    return (
      <div className="space-y-4">
        <PageTitle title={issued ? "Your card is ready" : "Creating your card"} sub={`${cardLabel} · limit $${(cents / 100).toFixed(2)}`} />
        <div className="surface"><Stepper card={card} stage={stage} onRetry={() => void retry()} retrying={retrying} failure={failure} /></div>
        {issued && card && (
          <div className="anim-rise flex flex-col gap-2 sm:flex-row">
            <Link href={`/cards/${card.cardPda}`} className="btn-primary flex-1" data-testid="open-card">Open card</Link>
            <Link href="/merchant" className="btn-secondary flex-1">Try it at the Demo store</Link>
          </div>
        )}
        {failure && !card && <button type="button" className="btn-secondary" onClick={() => { setStage(null); setFailure(null); }}>Back</button>}
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (formOk) void create(); }}>
      <PageTitle title="New card" sub="One card per store. Cap it, lock it, close it any time." />
      {(setupNeeded || setupDone) && <WalletSetup onDone={() => { setNeedSetup(false); setSetupDone(true); }} />}

      <fieldset>
        <legend className="label">Store</legend>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Store">
          {STORES.map((s) => (
            <button key={s.name} type="button" role="radio" aria-checked={store === s.name} onClick={() => pickStore(s)}
              className={`min-h-12 rounded-xl border px-2 text-sm font-semibold transition ${store === s.name ? "border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-600/30 dark:border-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-100" : "border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"}`}>
              {s.name}
            </button>
          ))}
        </div>
        {store === "Other" && (
          <div className="mt-2">
            <label className="label" htmlFor="custom-store">Store name</label>
            <input id="custom-store" className="input" value={custom} maxLength={32} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Corner Cafe" required />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="label">Card type</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Card type">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)}
              className={`rounded-xl border p-3 text-left transition ${kind === k.kind ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-600/30 dark:border-emerald-400 dark:bg-emerald-500/15" : "border-zinc-300 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"}`}>
              <span className="block text-sm font-semibold">{k.title}</span><span className="block text-xs text-zinc-600 dark:text-zinc-400">{k.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="limit">{kind === "SUBSCRIPTION" ? "Monthly limit (USD)" : "Lifetime limit (USD)"}</label>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-zinc-500" aria-hidden="true">$</span>
          <input id="limit" className="input tabular-nums" inputMode="decimal" type="number" min={1} max={500} step="0.01" value={dollars} onChange={(e) => setDollars(e.target.value)} aria-invalid={!limitOk} required />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {["10", "25", "40", "100"].map((v) => (
            <button key={v} type="button" onClick={() => setDollars(v)} className="chip bg-zinc-200 px-3 text-xs hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700">${v}</button>
          ))}
        </div>
        {!limitOk && <p className="mt-1 text-sm text-rose-600" role="alert">Pick a limit between $1.00 and $500.00.</p>}
      </div>

      <div>
        <label className="label" htmlFor="label">Card name</label>
        <input id="label" className="input" value={label} maxLength={32} placeholder={`${merchantName || "Store"} card`} onChange={(e) => setLabel(e.target.value)} />
      </div>

      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100" data-testid="explain">
        <p>
          <strong>Your USDC stays in your wallet.</strong> This card can pull at most <strong>${limitOk ? (cents / 100).toFixed(2) : "X"}</strong>
          {kind === "SUBSCRIPTION" ? " per month" : ""}, only at <strong>{merchantName ? (preset ? `${merchantName} (sandbox)` : "the first store that charges it") : "the store you pick"}</strong>.
        </p>
        <p className="mt-1 text-xs opacity-80">{preset ? `Locked onchain to ${merchantName} (sandbox) from the moment it's created, so a leaked number is useless anywhere else.` : "Other-store cards lock onchain to the first store that charges them."} You&apos;ll approve one signature in your wallet.</p>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}
      <button type="submit" disabled={!formOk} className="btn-primary w-full !min-h-12" data-testid="create-card">{stage === "preparing" ? <Spinner /> : null}Create card</button>
    </form>
  );
}

export default function NewCardPage() {
  return <AppShell><Content /></AppShell>;
}
