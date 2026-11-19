"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { explorerAddress } from "@solsend/shared";
import { ApiCallError, client, humanError } from "@/client/api";
import { blastRadius, displayStatus, shortId, usd, type CardView } from "@/client/format";
import { useAppData } from "@/components/AppShell";
import { CardVisual } from "@/components/CardVisual";
import { OutagePanel } from "@/components/OutagePanel";
import { WalletSetup } from "@/components/WalletSetup";
import { ErrorNote, Icon, InfoDisclosure, SigLink, Skeleton, Spinner } from "@/components/ui";

const DEAD = ["Closed", "Revoked", "Used", "Expired", "Failed"];

function Faucet({ primary, hideWhenFunded = false }: { primary: boolean; hideWhenFunded?: boolean }) {
  const { wallet } = useAppData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; rate: boolean } | null>(null);
  const [got, setGot] = useState<{ sig: string; amount: string } | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await client.faucet();
      setGot({ sig: r.signature, amount: r.amountBase });
      await wallet.refresh();
    } catch (e) {
      setErr({ msg: humanError(e), rate: e instanceof ApiCallError && e.code === "rate_limited" }); setGot(null);
    } finally { setBusy(false); }
  }
  if (hideWhenFunded && !got && !busy && !err) return null;
  return (
    <div>
      {!(hideWhenFunded && got) && <button type="button" onClick={() => void go()} disabled={busy} className={primary ? "btn-primary w-full" : "btn-secondary !min-h-10 !px-4 !text-[14px]"} data-testid="faucet-btn">
        {busy ? <><Spinner />Sending test USDC…</> : <><Icon name="drop" className="h-4 w-4" />{primary ? "Get free test USDC" : "Add test USDC"}</>}
      </button>}
      {err && <div className="mt-3"><ErrorNote tone={err.rate ? "info" : "error"}>{err.msg}</ErrorNote></div>}
      {got && (
        <div className="anim-rise mt-3 space-y-2" role="status" data-testid="faucet-done">
          <p className="text-[15px] text-ink-2">Received <strong className="text-ink">{usd(got.amount)}</strong> devnet test USDC.</p>
          <SigLink sig={got.sig} title="Test money added" />
        </div>
      )}
    </div>
  );
}

function Balance() {
  const { wallet, cards } = useAppData();
  const [copied, setCopied] = useState(false);
  const w = wallet.data;
  const br = blastRadius(cards.data);
  const [dollars, cents] = w ? usd(w.usdcBase).split(".") : ["", ""];
  return (
    <section aria-labelledby="bal" className="pb-2 pt-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="bal" className="text-[13px] font-medium text-ink-3">Wallet balance</h2>
        {w && (
          <span className="inline-flex items-center gap-1">
            <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-sunken px-3 font-mono text-[12px] text-ink-2 hover:text-ink"
              onClick={() => { void navigator.clipboard?.writeText(w.wallet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }} aria-label="Copy wallet address" title={w.wallet}>
              {copied ? "Copied" : shortId(w.wallet, 4)}<Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
            </button>
            <a href={explorerAddress(w.wallet)} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label="View wallet on Solana Explorer (devnet)"><Icon name="ext" className="h-4 w-4" /></a>
          </span>
        )}
      </div>
      {w ? (
        <div className="mt-1 flex items-center gap-2.5">
          <p className="tnum text-[48px] font-semibold leading-[52px] tracking-[-0.04em]" data-testid="balance">{dollars}<span className="text-ink-3">.{cents}</span></p>
          <span className="rounded-full bg-sandbox px-2 py-0.5 text-[11px] font-semibold leading-4 text-sandbox-ink ring-1 ring-sandbox-line">devnet USDC</span>
        </div>
      ) : <Skeleton className="mt-2 h-[52px] w-48" />}
      {wallet.error && !w && <div className="mt-3"><ErrorNote onRetry={() => void wallet.refresh()}>{wallet.error}</ErrorNote></div>}
      {cards.data && (
        <div className="mt-2 text-[15px] leading-[22px] text-ink-2" data-testid="blast-radius">
          <span>
            {br.count > 0
              ? <>Most that can ever be pulled: <strong className="tnum font-semibold text-ink" data-testid="blast-amount">{usd(br.base)}</strong> across {br.count} live card{br.count === 1 ? "" : "s"} — even by SolSend.</>
              : <>Nothing can be pulled from this wallet: <strong className="tnum font-semibold text-ink" data-testid="blast-amount">{usd(0n)}</strong> across 0 live cards.</>}
          </span>
          <InfoDisclosure label="How is this enforced?">
            Each card is an onchain allowance. Nothing — not a hacked store, not a leaked number, not our server — can pull more than these caps. Revoke any of them in one transaction, even without SolSend.
          </InfoDisclosure>
        </div>
      )}
    </section>
  );
}

function Checklist() {
  const { wallet, cards } = useAppData();
  const w = wallet.data;
  if (!w || !cards.data || cards.data.length > 0) return null;
  const funded = BigInt(w.usdcBase) > 0n;
  const ready = w.subscriptionAuthorityReady;
  const current = !funded ? 1 : !ready ? 2 : 3;
  return (
    <section className="surface !py-1" aria-label="Get started">
      <ol className="divide-y divide-line">
        <Step n={1} done={funded} active={current === 1} title="Get test USDC" sub="Free devnet dollars, no real value." keep><Faucet primary hideWhenFunded={funded} /></Step>
        <Step n={2} done={ready} active={current === 2} title="Turn on cards" sub="One free approval. Your money stays in your wallet.">{!ready && <WalletSetup compact />}</Step>
        <Step n={3} done={false} active={current === 3} title="Create your first card" sub="Locked to one store, with a hard limit.">
          <Link href="/cards/new" className="btn-primary w-full" data-testid="checklist-create">Create a card</Link>
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, done, active, title, sub, children, keep }: { n: number; done: boolean; active: boolean; title: string; sub: string; children?: React.ReactNode; keep?: boolean }) {
  return (
    <li className="flex gap-3 py-3.5" aria-current={active ? "step" : undefined}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${done ? "bg-ink text-paper" : active ? "bg-mint text-[#04130d]" : "bg-sunken text-ink-3"}`}>
        {done ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-semibold ${!done && !active ? "text-ink-3" : ""}`}>{title}</p>
        <p className="text-[13px] text-ink-3">{sub}</p>
        {(active || keep) && children && <div className="mt-3 empty:hidden">{children}</div>}
      </div>
    </li>
  );
}

function CardList({ list }: { list: CardView[] }) {
  const live = list.filter((c) => !DEAD.includes(displayStatus(c)));
  const dead = list.filter((c) => DEAD.includes(displayStatus(c)));
  const main = live.length > 0 ? live : dead;
  const rest = live.length > 0 ? dead : [];
  return (
    <>
      {/* Mobile: Wallet-style stack (each card peeks 72px; the last is fully visible). ≥sm: grid. */}
      <ul className="@container grid gap-3 sm:grid-cols-2 max-sm:gap-0 lg:@min-[1000px]/app-pane:grid-cols-3">
        {main.map((c, i) => (
          <li key={c.cardPda} className="relative transition-transform duration-200 hover:-translate-y-1 focus-within:-translate-y-1 max-sm:not-first:mt-[calc(72px-63.05cqw)]" style={{ zIndex: i }}>
            <Link href={`/cards/${c.cardPda}`} className="block rounded-[20px]" aria-label={`${c.label}, open card`} data-testid="card-tile">
              <CardVisual card={c} showLimit />
            </Link>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="mt-4 rounded-[16px] bg-sunken/60 px-4 py-2">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between text-[15px] font-medium text-ink-2">Closed cards ({rest.length})<Icon name="chevron" className="h-4 w-4" /></summary>
          <ul className="@container grid gap-3 pb-2 pt-2 sm:grid-cols-2 lg:@min-[1000px]/app-pane:grid-cols-3">{rest.map((c) => (
            <li key={c.cardPda}><Link href={`/cards/${c.cardPda}`} className="block rounded-[20px]" aria-label={`${c.label}, open card`} data-testid="card-tile"><CardVisual card={c} showLimit /></Link></li>
          ))}</ul>
        </details>
      )}
    </>
  );
}

function Content() {
  const { wallet, cards } = useAppData();
  const params = useSearchParams();
  const outage = params.get("demo") === "outage";
  const list = cards.data;
  const hasCards = !!list && list.length > 0;
  useEffect(() => { /* keep wallet fresh after returning from a sheet */ void wallet.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-7">
      <Balance />
      {hasCards && <div className="-mt-3"><Faucet primary={false} /></div>}
      <Checklist />

      <section aria-labelledby="cards-h">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="cards-h" className="text-[22px] font-semibold tracking-[-0.02em]">Cards</h2>
          <Link href="/cards/new" className="btn-primary !min-h-10 !rounded-full !px-4 !text-[14px]" data-testid="new-card" aria-label="New card"><Icon name="plus" className="h-4 w-4" strokeWidth={2.4} />New card</Link>
        </div>
        {cards.error && !list && <ErrorNote onRetry={() => void cards.refresh()}>{cards.error}</ErrorNote>}
        {!list && !cards.error && <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="aspect-[1.586] !rounded-[20px]" /><Skeleton className="aspect-[1.586] !rounded-[20px] max-sm:hidden" /></div>}
        {list && list.length === 0 && (
          <div className="rounded-[20px] border-2 border-dashed border-line p-6 text-center">
            <p className="text-[15px] font-semibold">No cards yet</p>
            <p className="mt-1 text-[14px] text-ink-3">Each card holds $0 and can only pull what you allow, at one store.</p>
          </div>
        )}
        {hasCards && <CardList list={list} />}
        {hasCards && (
          <Link href="/merchant" className="mt-4 flex min-h-14 items-center justify-between gap-3 rounded-[16px] bg-surface px-4 py-3 ring-1 ring-line ring-inset hover:bg-sunken">
            <span><span className="block text-[15px] font-semibold">Try a card at the sandbox store</span><span className="text-[13px] text-ink-3">Swipe, get declined on purpose, void.</span></span>
            <Icon name="arrow" className="h-5 w-5 shrink-0 text-ink-3" />
          </Link>
        )}
      </section>

      <OutagePanel outage={outage} />
    </div>
  );
}

export default function HomePage() {
  return <Suspense fallback={null}><Content /></Suspense>; // AppShell comes from the layout (SplitFrame)
}
