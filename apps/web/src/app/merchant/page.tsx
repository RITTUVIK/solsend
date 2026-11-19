"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { z } from "zod";
import type { api } from "@solsend/shared";
import { client, humanError } from "@/client/api";
import { STORE_ART_NAME, cardArt } from "@/client/cardArt";
import { MERCHANT_LABEL, displayStatus, isPresetStore, isUsable, sandboxName, usd, type DeclineFix } from "@/client/format";
import { defaultProductIndex } from "@/client/store-default";
import { useAppData } from "@/components/AppShell";
import { ApprovalSheet, type PayAttempt } from "@/components/ApprovalSheet";
import { CardVisual, StoreTile } from "@/components/CardVisual";
import { FeedList } from "@/components/FeedList";
import { Icon, radioKeys } from "@/components/ui";

type Merchant = z.infer<typeof api.DemoMerchantZ>;
const STORES: Merchant[] = ["TEMU", "AMAZON", "NETFLIX", "OTHER_STORE"];
const PRODUCTS: Record<Merchant, { name: string; dollars: string }[]> = {
  TEMU: [{ name: "Phone case", dollars: "5" }, { name: "Earbuds", dollars: "12" }, { name: "Drone", dollars: "45" }],
  AMAZON: [{ name: "USB cable", dollars: "5" }, { name: "Book", dollars: "12" }, { name: "Headphones", dollars: "25" }],
  NETFLIX: [{ name: "Monthly plan", dollars: "15.49" }, { name: "Premium", dollars: "22.99" }],
  OTHER_STORE: [{ name: "Latte", dollars: "5" }, { name: "Lunch", dollars: "12" }],
};
const STORE_TAGLINE: Record<Merchant, string> = {
  TEMU: "A store you're trying for the first time",
  AMAZON: "Where a thief would try a leaked number",
  NETFLIX: "Subscriptions and free trials",
  OTHER_STORE: "Your neighbourhood café",
};
const enumFor = (merchantName: string): Merchant | null => {
  const k = merchantName.trim().toUpperCase();
  return (STORES as string[]).includes(k) ? (k as Merchant) : null;
};

function Content() {
  const { cards, wallet } = useAppData();
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("card");
  const issued = (cards.data ?? []).filter((c) => c.issueState === "issued");
  const [cardPda, setCardPda] = useState<string>("");
  const [merchant, setMerchant] = useState<Merchant>("TEMU");
  const [amount, setAmount] = useState("12");
  const [attempt, setAttempt] = useState<PayAttempt | null>(null);
  const [announce, setAnnounce] = useState("");

  const selected = issued.find((c) => c.cardPda === cardPda);
  // Preselect a product the wallet can cover (client/store-default.ts): a new wallet holds one faucet claim, less than
  // the usual $12 pick, and its first try should be an approval, not a decline for wallet balance.
  const walletBase = wallet.data ? BigInt(wallet.data.usdcBase) : null;
  const affordablePick = (m: Merchant, base: bigint | null) => {
    const prices = PRODUCTS[m].map((p) => p.dollars);
    return prices[defaultProductIndex(prices, base)]!;
  };
  /** An automatic pick made before the wallet balance loaded; corrected once when it arrives (effect below). */
  const blindPick = useRef<{ merchant: Merchant; amount: string } | null>(null);
  function pickCard(pda: string) {
    setCardPda(pda);
    const c = issued.find((x) => x.cardPda === pda);
    const m = c && isPresetStore(c.merchantName) ? enumFor(c.merchantName) : c ? "OTHER_STORE" : null;
    if (m) {
      const pick = affordablePick(m, walletBase);
      setMerchant(m); setAmount(pick);
      blindPick.current = walletBase === null ? { merchant: m, amount: pick } : null;
    }
  }
  useEffect(() => {
    const blind = blindPick.current;
    if (!blind || walletBase === null) return;
    blindPick.current = null;
    // Only if the shopper hasn't changed the store or the amount since the automatic pick.
    if (merchant === blind.merchant && amount === blind.amount) setAmount(affordablePick(blind.merchant, walletBase));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletBase]);
  // ?card= ("Pay at the sandbox store" right after creating a card): the shared cards list lives in the app shell and
  // persists across pages, so it can be a poll behind and not list that card as issued yet. Refresh and wait for it
  // instead of preselecting another card; fall back only if it still hasn't appeared after a few polls.
  const wantedIssued = !!wanted && issued.some((c) => c.cardPda === wanted);
  const [awaitWanted, setAwaitWanted] = useState(!!wanted);
  useEffect(() => {
    setAwaitWanted(!!wanted);
    if (!wanted) return;
    void cards.refresh();
    const t = setTimeout(() => setAwaitWanted(false), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  useEffect(() => {
    if (cardPda || issued.length === 0) return;
    if (wanted && !wantedIssued && awaitWanted) return;
    pickCard(issued.find((c) => c.cardPda === wanted)?.cardPda ?? issued.find(isUsable)?.cardPda ?? issued[0]!.cardPda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issued.length, cardPda, wanted, wantedIssued, awaitWanted]);

  const cents = Math.round(Number(amount) * 100);
  const amountOk = Number.isFinite(cents) && cents >= 1 && cents <= 5000;
  const storeLabel = MERCHANT_LABEL[merchant] ?? merchant;
  const lockedStore = selected && selected.kind !== "ONE_TIME" && isPresetStore(selected.merchantName) ? enumFor(selected.merchantName) : null;
  const leaked = !!lockedStore && lockedStore !== merchant;

  async function pay() {
    if (!selected || !amountOk) return;
    const walletBefore = wallet.data ? BigInt(wallet.data.usdcBase) : null;
    const base: PayAttempt = { card: selected, merchant, merchantLabel: storeLabel, amountCents: cents, walletBefore, res: null, error: null };
    setAttempt(base); setAnnounce("");
    try {
      const res = await client.checkout({ cardPda: selected.cardPda, merchant, amountCents: cents });
      setAttempt({ ...base, res });
      setAnnounce(res.decision === "APPROVED" ? `Approved: ${usd(BigInt(cents) * 10_000n)} at ${sandboxName(storeLabel)}` : `Declined: ${res.reason ?? "blocked by the card's rules"}`);
      void cards.refresh(); void wallet.refresh();
    } catch (e) {
      setAttempt({ ...base, error: humanError(e) });
      setAnnounce(`Payment failed: ${humanError(e)}`);
    }
  }

  function onFix(f: DeclineFix | "try_amazon") {
    const a = attempt;
    setAttempt(null);
    if (f === "try_amazon") { setMerchant("AMAZON"); setAmount("5"); return; }
    if (f === "use_locked_store" && lockedStore) { setMerchant(lockedStore); return; }
    if (f === "pay_remaining" && a?.res?.remainingBase) { setAmount((Number(a.res.remainingBase) / 1e6).toFixed(2)); return; }
    if (f === "lower_amount") { setAmount("5"); return; }
    if (f === "add_usdc") { router.push("/home"); return; }
    if ((f === "reactivate" || f === "unfreeze") && a) router.push(`/cards/${a.card.cardPda}`);
  }

  return (
    <div>
      <div className="sr-only" aria-live="assertive" role="status">{announce}</div>

      {cards.data && issued.length === 0 ? (
        <div className="surface text-center">
          <div className="mx-auto mb-3 w-40 opacity-60"><div className="aspect-[1.586] rounded-[14px] border-2 border-dashed border-line" /></div>
          <p className="text-[17px] font-semibold">You need a card to check out</p>
          <p className="mt-1 text-[15px] text-ink-2">Make a burner card for one store, then try it here.</p>
          <Link href="/cards/new" className="btn-primary mt-4">Create a card</Link>
        </div>
      ) : (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); void pay(); }}>
          {/* Storefront strip */}
          <div className="relative overflow-hidden rounded-[20px] p-4 text-white">
            <StoreBanner merchant={merchant} />
            <div className="relative flex items-center gap-3">
              <StoreTile merchant={STORE_ART_NAME[merchant]!} size={44} className="ring-2 ring-white/40" />
              <div className="min-w-0 flex-1">
                <span className="chip mb-1 bg-black/35 px-2 text-white">sandbox store</span>
                <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.02em]">{storeLabel} <span className="text-white/85">(sandbox)</span></h1>
                <p className="text-[13px] font-medium leading-[18px] text-white/90">{STORE_TAGLINE[merchant]}</p>
              </div>
            </div>
          </div>

          <fieldset className="min-w-0">
            <legend className="label">Pay with</legend>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 pt-1" role="radiogroup" onKeyDown={radioKeys} aria-label="Card" data-testid="card-select">
              {!cards.data && <div className="skeleton aspect-[1.586] w-[150px] shrink-0" />}
              {issued.map((c) => (
                <button key={c.cardPda} type="button" role="radio" aria-checked={c.cardPda === cardPda} onClick={() => pickCard(c.cardPda)}
                  aria-label={`${c.label}, ${displayStatus(c)}, ${usd(c.limit.remainingBase)} left`}
                  className={`w-[150px] shrink-0 snap-start text-left transition ${c.cardPda === cardPda ? "" : "opacity-70 hover:opacity-100"}`}>
                  <span className={`block rounded-[19px] p-[3px] ${c.cardPda === cardPda ? "ring-2 ring-ink" : ""}`}><CardVisual card={c} showLimit size="small" /></span>
                  <span className="mt-1 block truncate px-1 text-[12px] font-semibold text-ink-2">{c.label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="label">Shop at</legend>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" onKeyDown={radioKeys} aria-label="Store">
              {STORES.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={merchant === m} onClick={() => setMerchant(m)} data-testid={`store-${m}`}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-[16px] px-1 text-[12px] font-semibold transition ${merchant === m ? "bg-surface text-ink ring-2 ring-ink" : "bg-surface/60 text-ink-2 ring-1 ring-line ring-inset hover:bg-surface"}`}>
                  <StoreTile merchant={STORE_ART_NAME[m]!} size={28} />
                  <span className="max-w-full truncate">{MERCHANT_LABEL[m]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {leaked && (
            <div className="flex gap-3 rounded-[16px] bg-warn-bg p-3.5 text-[14px] leading-5 text-ink" data-testid="leak-callout">
              <Icon name="lock" className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
              <p>This card is locked to <strong>{sandboxName(MERCHANT_LABEL[lockedStore!]!)}</strong>. Paying at {storeLabel} simulates a thief using a <strong>leaked card number</strong>.</p>
            </div>
          )}

          <div>
            <p className="label" id="products-h">Add to cart</p>
            <div className="flex flex-wrap gap-2" aria-labelledby="products-h">
              {PRODUCTS[merchant].map((p) => (
                <button key={p.name} type="button" className="pick" aria-pressed={Number(amount) === Number(p.dollars)} onClick={() => setAmount(p.dollars)}>
                  {p.name} <span className="tnum font-medium opacity-70">${p.dollars}</span>
                </button>
              ))}
            </div>
            <label className="label mt-4" htmlFor="amount">Amount (USD, max $50)</label>
            <div className="flex items-center gap-1 rounded-[14px] bg-surface px-3.5 ring-1 ring-line ring-inset focus-within:ring-2 focus-within:ring-ink">
              <span className="text-[22px] font-semibold text-ink-3" aria-hidden="true">$</span>
              <input id="amount" className="tnum min-h-14 w-full bg-transparent text-[22px] font-semibold outline-none" type="number" inputMode="decimal" min={0.01} max={50} step="0.01"
                value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} aria-describedby={!amountOk ? "amount-err" : undefined} required />
            </div>
            {!amountOk && <p id="amount-err" className="mt-1.5 text-sm text-no" role="alert">Enter an amount between $0.01 and $50.00.</p>}
          </div>

          <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] z-10 -mx-4 bg-gradient-to-t from-paper from-70% to-transparent px-4 pb-3 pt-4 sm:static sm:mx-0 sm:bg-none sm:p-0">
            <button type="submit" disabled={!selected || !amountOk || (!!attempt && !attempt.res && !attempt.error)} className="btn-primary w-full !min-h-14 !text-[17px]" data-testid="pay">
              {leaked ? <>Try the leaked number at {storeLabel}</> : <>Pay {amountOk ? usd(BigInt(cents) * 10_000n) : ""}{selected?.lithic.lastFour ? <span className="font-medium opacity-70">&nbsp;with •••• {selected.lithic.lastFour}</span> : null}</>}
            </button>
          </div>
        </form>
      )}

      <ApprovalSheet attempt={attempt} walletNow={wallet.data ? BigInt(wallet.data.usdcBase) : null} onClose={() => setAttempt(null)} onFix={onFix}
        onVoided={() => { void cards.refresh(); void wallet.refresh(); }} />

      {selected && (
        <section className="mt-10" aria-labelledby="recent-h">
          <h2 id="recent-h" className="text-[17px] font-semibold">Recent sandbox purchases</h2>
          <p className="mb-2 text-[13px] text-ink-3">On {selected.label}. You can void an approved purchase here any time.</p>
          <FeedList key={selected.cardPda} cardPda={selected.cardPda} limit={8} empty="No purchases on this card yet." />
        </section>
      )}
    </div>
  );
}

/** Re-uses the card art so the store and its card read as one identity. */
function StoreBanner({ merchant }: { merchant: Merchant }) {
  return <div className="card-noise absolute inset-0" style={{ background: cardArt(STORE_ART_NAME[merchant]!).background }} aria-hidden="true" />;
}

export default function MerchantPage() {
  return <Suspense fallback={null}><Content /></Suspense>; // AppShell comes from the layout (SplitFrame)
}
