"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { z } from "zod";
import type { api } from "@solsend/shared";
import { client, humanError } from "@/client/api";
import { MERCHANT_LABEL, displayStatus, isUsable, sandboxName, usd } from "@/client/format";
import { AppShell, useAppData } from "@/components/AppShell";
import { CheckoutResult } from "@/components/CheckoutResult";
import { FeedList } from "@/components/FeedList";
import { ErrorNote, Icon, SandboxChip, Spinner } from "@/components/ui";

type Merchant = z.infer<typeof api.DemoMerchantZ>;
const MERCHANTS: { id: Merchant; tone: string; blurb: string }[] = [
  { id: "TEMU", tone: "from-orange-600 to-rose-700", blurb: "Gadgets, cheap" },
  { id: "AMAZON", tone: "from-zinc-700 to-black", blurb: "Everything store" },
  { id: "NETFLIX", tone: "from-red-700 to-zinc-950", blurb: "Streaming" },
  { id: "OTHER_STORE", tone: "from-indigo-600 to-violet-800", blurb: "A different shop" },
];

function Content() {
  const { cards, wallet } = useAppData();
  const params = useSearchParams();
  const wanted = params.get("card");
  const issued = (cards.data ?? []).filter((c) => c.issueState === "issued");
  const [cardPda, setCardPda] = useState<string>("");
  const [merchant, setMerchant] = useState<Merchant>("TEMU");
  const [amount, setAmount] = useState("12");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<{ res: z.infer<typeof api.DemoCheckoutResponse>; cardPda: string; merchant: Merchant; cents: number } | null>(null);

  useEffect(() => {
    if (cardPda || issued.length === 0) return;
    setCardPda(issued.find((c) => c.cardPda === wanted)?.cardPda ?? issued.find(isUsable)?.cardPda ?? issued[0]!.cardPda);
  }, [issued, cardPda, wanted]);

  const cents = Math.round(Number(amount) * 100);
  const amountOk = Number.isFinite(cents) && cents >= 1 && cents <= 5000;
  const selected = issued.find((c) => c.cardPda === cardPda);

  async function pay() {
    if (!selected || !amountOk) return;
    setBusy(true); setErr(null); setOut(null);
    try {
      const res = await client.checkout({ cardPda: selected.cardPda, merchant, amountCents: cents });
      setOut({ res, cardPda: selected.cardPda, merchant, cents });
      void cards.refresh(); void wallet.refresh();
    } catch (e) { setErr(humanError(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-4">
        <div className="mb-1 flex flex-wrap items-center gap-2"><SandboxChip>SANDBOX STORE</SandboxChip><span className="text-xs text-zinc-500">Not a real merchant. No one is charged.</span></div>
        <h1 className="text-2xl font-bold tracking-tight">Demo store checkout</h1>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">Pay with your SolSend card. The swipe is settled on Solana devnet before it&apos;s approved.</p>
      </div>

      {cards.data && issued.length === 0 ? (
        <div className="surface text-center">
          <p className="font-semibold">You need a ready card to check out.</p>
          <Link href="/cards/new" className="btn-primary mt-3">Create a card</Link>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void pay(); }}>
          <div>
            <label className="label" htmlFor="card-select">Card</label>
            <select id="card-select" className="input" value={cardPda} onChange={(e) => setCardPda(e.target.value)} data-testid="card-select" disabled={!cards.data}>
              {issued.map((c) => <option key={c.cardPda} value={c.cardPda}>{c.label} · {displayStatus(c)} · {usd(c.limit.remainingBase)} left</option>)}
            </select>
          </div>

          <fieldset>
            <legend className="label">Store</legend>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Store">
              {MERCHANTS.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={merchant === m.id} onClick={() => setMerchant(m.id)} data-testid={`store-${m.id}`}
                  className={`rounded-xl bg-gradient-to-br ${m.tone} p-3 text-left text-white transition ${merchant === m.id ? "ring-4 ring-emerald-500/60 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-zinc-950" : "opacity-80 hover:opacity-100"}`}>
                  <span className="block font-bold">{MERCHANT_LABEL[m.id]}</span>
                  <span className="block text-xs text-white/80">(sandbox) · {m.blurb}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="amount">Amount (USD, max $50)</label>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-zinc-500" aria-hidden="true">$</span>
              <input id="amount" className="input tabular-nums" type="number" inputMode="decimal" min={0.01} max={50} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!amountOk} required />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {["5", "12", "25", "45"].map((v) => <button key={v} type="button" onClick={() => setAmount(v)} className="chip bg-zinc-200 px-3 text-xs hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700">${v}</button>)}
            </div>
            {!amountOk && <p className="mt-1 text-sm text-rose-600" role="alert">Enter an amount between $0.01 and $50.00.</p>}
          </div>

          {err && <ErrorNote>{err}</ErrorNote>}
          <button type="submit" disabled={busy || !selected || !amountOk} className="btn-primary w-full !min-h-14 !text-base" data-testid="pay">
            {busy ? <><Spinner />Settling onchain…</> : <><Icon name="bolt" className="h-5 w-5" />Pay with SolSend card</>}
          </button>
          <p className="text-xs text-zinc-500">Tip: an amount above a card&apos;s remaining limit (up to 2× its limit) is declined by the onchain rules. Try $45 on a $40 card.</p>
          <p className="text-center text-xs text-zinc-500">Paying {amountOk ? usd(BigInt(cents) * 10_000n) : "—"} at {sandboxName(MERCHANT_LABEL[merchant] ?? merchant)}</p>
        </form>
      )}

      {out && <CheckoutResult res={out.res} cardPda={out.cardPda} merchant={MERCHANT_LABEL[out.merchant] ?? out.merchant} amountCents={out.cents} onVoided={() => { void cards.refresh(); void wallet.refresh(); }} />}
      {selected && (
        <section className="mt-8" aria-labelledby="recent-h">
          <h2 id="recent-h" className="font-semibold">Recent sandbox purchases</h2>
          <p className="mb-1 text-sm text-zinc-600 dark:text-zinc-400">On {selected.label}. You can void an approved purchase here any time.</p>
          <FeedList key={selected.cardPda} cardPda={selected.cardPda} limit={8} empty="No purchases on this card yet." />
        </section>
      )}
    </div>
  );
}

export default function MerchantPage() {
  return <AppShell><Suspense fallback={null}><Content /></Suspense></AppShell>;
}
