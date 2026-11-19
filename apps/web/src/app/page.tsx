"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/client/session";
import type { CardView } from "@/client/format";
import { CardVisual, StoreTile } from "@/components/CardVisual";
import { HowItWorksLink, PublicHeader, SiteFooter, revealHowItWorks, safeNext, useLoginThenGo } from "@/components/PublicChrome";
import { Icon, OnchainGlyph, Spinner } from "@/components/ui";

const DEMO_CARD: CardView = {
  cardPda: "demo", cardId: "demo", label: "Temu card", merchantName: "Temu", kind: "STORE_LOCKED", status: "ACTIVE", issueState: "issued",
  lithic: { cardToken: null, lastFour: "4242", state: "OPEN" },
  limit: { type: "lifetime", totalBase: "40000000", remainingBase: "40000000", periodSecs: null },
  totals: { settledBase: "0", refundedBase: "0" }, merchantLocked: true, delegationLive: true, delegation: "demo", createdAt: "2026-01-01T00:00:00Z",
  registerSignature: null, expiresAt: null, expired: false,
};

/** 7 s loop built from the real card component. Captioned as an illustration (it is not live data). */
function DemoLoop() {
  const [step, setStep] = useState(4);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return; // static final frame
    setStep(0);
    const seq = [800, 1700, 1500, 2000, 1000];
    let i = 0;
    let t: ReturnType<typeof setTimeout>;
    const next = () => { i = (i + 1) % seq.length; setStep(i); t = setTimeout(next, seq[i]); };
    t = setTimeout(next, seq[0]);
    return () => clearTimeout(t);
  }, []);
  const card: CardView = step >= 1 ? { ...DEMO_CARD, limit: { ...DEMO_CARD.limit, remainingBase: "28000000" } } : DEMO_CARD;
  return (
    <figure className="relative mx-auto w-full max-w-[360px]" aria-label="Illustration: a Temu card is approved for $12, then the same number is declined at Amazon">
      <div className="mb-3 flex justify-center">
        <span className="tnum inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-[14px] font-semibold shadow-sm ring-1 ring-line">
          <Icon name="wallet" className="h-4 w-4 text-ink-3" />Your wallet
          <span key={step >= 2 ? "88" : "100"} className="anim-fade">{step >= 2 ? "$88.00" : "$100.00"}</span>
        </span>
      </div>
      <div className={`transition-transform duration-500 ${step === 3 ? "translate-x-3 rotate-[2deg]" : ""}`}><CardVisual card={card} showLimit /></div>
      <div className="relative mt-3 h-[60px]" aria-hidden="true">
        {step >= 1 && step < 3 && (
          <div key="ok" className="anim-rise absolute inset-x-0 flex items-center gap-3 rounded-[16px] bg-surface px-3.5 py-2.5 shadow-lg ring-1 ring-line">
            <span className="anim-pop anim-glow grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ok text-white"><Icon name="check" className="h-4 w-4" strokeWidth={3} /></span>
            <div className="min-w-0 text-[14px] leading-5"><p className="font-semibold">Approved · $12.00 at Temu</p><p className="flex items-center gap-1 text-[13px] text-ink-3"><OnchainGlyph className="h-3.5 w-3.5" />settled on Solana first · 0.7 s</p></div>
          </div>
        )}
        {step >= 3 && (
          <div key="no" className="anim-rise absolute inset-x-0 flex items-center gap-3 rounded-[16px] bg-surface px-3.5 py-2.5 shadow-lg ring-1 ring-line">
            <StoreTile merchant="Amazon" size={32} />
            <div className="min-w-0 text-[14px] leading-5"><p className="font-semibold text-no">Declined at Amazon</p><p className="text-[13px] text-ink-3">Locked to Temu — a leaked number is useless here</p></div>
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-center text-[11px] font-medium text-ink-3">Illustration of the sandbox demo</figcaption>
    </figure>
  );
}

const STEPS = [
  { icon: "drop", title: "Get test USDC", body: "Sign in with an email. We create a Solana wallet and drop in free devnet dollars." },
  { icon: "card", title: "Make a card per store", body: "“Temu, $40 total.” “Netflix free trial, $15.49 a month, expires in 7 days.” Each card has a hard limit that Solana enforces." },
  { icon: "chain", title: "Pay — the money moves first", body: "Your USDC stays in your wallet until a swipe. Each purchase settles on Solana before the card network is told yes." },
] as const;

export default function Landing() {
  return <Suspense fallback={null}><LandingInner /></Suspense>;
}

function LandingInner() {
  const s = useSession();
  const router = useRouter();
  // A logged-out deep link (e.g. /cards/new) lands here as /?next=/cards/new; go back there after login.
  const next = safeNext(useSearchParams().get("next"));
  const { login, pending, authenticated } = useLoginThenGo(next);
  // Signed-in users may visit Home (this page) from the tabs. Only a deep link (/?next=…) sends them on; logging in
  // from this page goes to the wallet via useLoginThenGo.
  useEffect(() => { if (s.ready && s.authenticated && next) router.replace(next); }, [s.ready, s.authenticated, next, router]);
  // Arriving at /#how (link from another page, or a fresh load): this page renders after the browser's own hash jump,
  // so reveal the section once it exists.
  useEffect(() => {
    if (location.hash !== "#how") return;
    const t = window.setTimeout(() => revealHowItWorks(), 60);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-10">
      <PublicHeader next={next} />

      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.1fr_1fr] lg:pt-14">
        <div>
          <h1 className="text-[44px] font-semibold leading-[46px] tracking-[-0.045em] sm:text-[64px] sm:leading-[64px] lg:text-[72px] lg:leading-[72px]">A burner card for every store.</h1>
          <p className="mt-5 max-w-xl text-[17px] leading-[26px] text-ink-2">Each card holds <strong className="font-semibold text-ink">$0</strong>. It can pull only what you allow, only at the store you pick — straight from your Solana wallet.</p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row">
            {authenticated
              ? <Link href="/home" className="btn-primary !min-h-[52px] !px-7 !text-[17px]">Open your wallet</Link>
              : <button type="button" onClick={login} className="btn-primary !min-h-[52px] !px-7 !text-[17px]">
                  {pending ? <Spinner /> : null}Try the sandbox demo
                </button>}
            <HowItWorksLink className="btn-ghost !min-h-[52px]">How it works<Icon name="chevron" className="h-4 w-4" /></HowItWorksLink>
          </div>
          <p className="mt-3 text-[13px] text-ink-3">Free to try · test money only · no real merchants.</p>
        </div>
        <DemoLoop />
      </section>

      <p className="mt-12 text-center text-[13px] font-medium text-ink-3">Settles on <span className="text-ink-2">Solana</span> · Cards via <span className="text-ink-2">Lithic</span> sandbox · Events via <span className="text-ink-2">QuickNode</span> Streams</p>

      <section aria-labelledby="how-title" className="mt-14 scroll-mt-16" id="how">
        <h2 id="how-title" tabIndex={-1} className="text-[22px] font-semibold tracking-[-0.02em] focus:outline-none">How it works</h2>
        <ol className="-mx-4 mt-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
          {STEPS.map((st, i) => (
            <li key={st.title} className="surface w-[78%] shrink-0 snap-start sm:w-auto">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-sunken text-ink"><Icon name={st.icon} /></span>
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Step {i + 1}</span>
              </div>
              <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.01em]">{st.title}</h3>
              <p className="mt-1 text-[15px] leading-[22px] text-ink-2">{st.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 grid gap-3 sm:grid-cols-2">
        <div className="surface">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Icon name="shield" className="h-5 w-5" />You stay in control</h2>
          <p className="mt-1 text-[15px] leading-[22px] text-ink-2">Freeze or close any card, or revoke all of them in one transaction. If the card issuer goes down, your money never left your wallet.</p>
        </div>
        <details className="surface group">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[17px] font-semibold">
            <span className="flex items-center gap-2"><Icon name="flask" className="h-5 w-5" />What&apos;s real here?</span>
            <Icon name="chevron" className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-2 text-[15px] leading-[22px] text-ink-2">Cards come from a sandbox issuer and money is devnet test USDC. No real merchant is ever charged and no real card network settles anything. The &ldquo;Demo store&rdquo; is a sandbox simulator, not a real shop. The Solana transactions are real devnet transactions you can inspect.</p>
        </details>
      </section>

      <section className="mt-12 flex flex-col items-start gap-4 rounded-[20px] bg-surface p-6 ring-1 ring-line ring-inset sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Make your first card in about a minute</h2>
          <p className="mt-1 text-[15px] text-ink-2">{authenticated ? "Pick a store and a limit. Test money only." : "Sign in with an email. Test money only."}</p>
        </div>
        {authenticated
          ? <Link href="/cards/new" className="btn-primary shrink-0">New card</Link>
          : <button type="button" onClick={login} className="btn-primary shrink-0">{pending ? <Spinner /> : null}Get started</button>}
      </section>

      <SiteFooter />
    </div>
  );
}
