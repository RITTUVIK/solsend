"use client";
import { Suspense, useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/client/session";
import type { CardView } from "@/client/format";
import { Logo } from "@/components/AppShell";
import { CardVisual, StoreTile } from "@/components/CardVisual";
import { GlyphField } from "@/components/GlyphField";
import { safeNext, useLoginThenGo } from "@/components/PublicChrome";
import { Icon, MockBadge, OnchainGlyph, Spinner } from "@/components/ui";

/** Pages reachable from the top nav. App pages need a session: logged out, a click logs in and then opens the page. */
const NAV = [
  { href: "/", label: "Home", app: false },
  { href: "/home", label: "Wallet", app: true },
  { href: "/merchant", label: "Demo store", app: true },
  { href: "/activity", label: "Activity", app: true },
  { href: "/status", label: "Status", app: false },
] as const;

const PAGE_NAME: Record<string, string> = { "/home": "your wallet", "/merchant": "the demo store", "/activity": "your activity", "/cards/new": "a new card" };

const STEPS = [
  { icon: "drop", title: "Get free test money", body: "Sign in with your email. We make you a Solana wallet and drop in free test dollars (devnet USDC)." },
  { icon: "card", title: "Make a card for one store", body: "Pick a store and a limit, like “Temu, $40 total” or “Netflix, $15.49 a month for 7 days”." },
  { icon: "chain", title: "Pay. The money moves first.", body: "Your dollars stay in your wallet until you buy. Solana moves exactly that amount, then the card says yes." },
] as const;

const WHY = [
  { icon: "wallet", title: "Holds $0", body: "Nothing sits on the card. It can only pull what you allowed, when you buy." },
  { icon: "lock", title: "Locked to one store", body: "If the number leaks, it gets declined everywhere else." },
  { icon: "shield", title: "A hard limit", body: "The limit is enforced by Solana itself, not just a setting in an app." },
] as const;

const DEMO_CARD: CardView = {
  cardPda: "demo", cardId: "demo", label: "Temu card", merchantName: "Temu", kind: "STORE_LOCKED", status: "ACTIVE", issueState: "issued",
  lithic: { cardToken: null, lastFour: "4242", state: "OPEN" },
  limit: { type: "lifetime", totalBase: "40000000", remainingBase: "40000000", periodSecs: null },
  totals: { settledBase: "0", refundedBase: "0" }, merchantLocked: true, delegationLive: true, delegation: "demo", createdAt: "2026-01-01T00:00:00Z",
  registerSignature: null, expiresAt: null, expired: false,
};

/** 7 s loop built from the real card component, captioned as an illustration (not live data). Starts when scrolled into view. */
function DemoLoop() {
  const [step, setStep] = useState(4);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return; // static final frame
    let t: ReturnType<typeof setTimeout> | undefined;
    const seq = [800, 1700, 1500, 2000, 1000];
    let i = 0;
    const next = () => { i = (i + 1) % seq.length; setStep(i); t = setTimeout(next, seq[i]); };
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && t === undefined) { i = 0; setStep(0); t = setTimeout(next, seq[0]); }
      else if (!e?.isIntersecting && t !== undefined) { clearTimeout(t); t = undefined; }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); if (t !== undefined) clearTimeout(t); };
  }, [el]);
  const card: CardView = step >= 1 ? { ...DEMO_CARD, limit: { ...DEMO_CARD.limit, remainingBase: "28000000" } } : DEMO_CARD;
  return (
    <figure ref={setEl} className="relative mx-auto w-full max-w-[360px]" aria-label="Illustration: a Temu card is approved for $12, then the same number is declined at Amazon">
      <div className="mb-3 flex justify-center">
        <span className="tnum inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[14px] font-semibold text-white ring-1 ring-white/15">
          <Icon name="wallet" className="h-4 w-4 text-white/60" />Your wallet
          <span key={step >= 2 ? "88" : "100"} className="anim-fade">{step >= 2 ? "$88.00" : "$100.00"}</span>
        </span>
      </div>
      <div className={`transition-transform duration-500 ${step === 3 ? "translate-x-3 rotate-[2deg]" : ""}`}><CardVisual card={card} showLimit /></div>
      <div className="relative mt-3 h-[60px] text-white" aria-hidden="true">
        {step >= 1 && step < 3 && (
          <div key="ok" className="anim-rise absolute inset-x-0 flex items-center gap-3 rounded-[16px] bg-[#1a0b3d] px-3.5 py-2.5 shadow-lg ring-1 ring-white/15">
            <span className="anim-pop grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#14f195] text-[#04130d]"><Icon name="check" className="h-4 w-4" strokeWidth={3} /></span>
            <div className="min-w-0 text-[14px] leading-5"><p className="font-semibold">Approved · $12.00 at Temu</p><p className="flex items-center gap-1 text-[13px] text-white/60"><OnchainGlyph className="h-3.5 w-3.5" />paid on Solana first · 0.7 s</p></div>
          </div>
        )}
        {step >= 3 && (
          <div key="no" className="anim-rise absolute inset-x-0 flex items-center gap-3 rounded-[16px] bg-[#1a0b3d] px-3.5 py-2.5 shadow-lg ring-1 ring-white/15">
            <StoreTile merchant="Amazon" size={32} />
            <div className="min-w-0 text-[14px] leading-5"><p className="font-semibold text-[#ff8a8a]">Declined at Amazon</p><p className="text-[13px] text-white/60">Locked to Temu, so a leaked number is useless here</p></div>
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-center text-[11px] font-medium text-white/45">Illustration of the sandbox demo</figcaption>
    </figure>
  );
}

export default function Landing() {
  return <Suspense fallback={null}><LandingInner /></Suspense>;
}

/** Height of the sticky sandbox banner from the root layout (it wraps to two lines on narrow phones). */
function useBannerHeight() {
  const [h, setH] = useState(32);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="sandbox-banner"]');
    if (!el) return;
    const read = () => setH(el.offsetHeight);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return h;
}

const SECTION = "mx-auto w-full max-w-5xl px-5 sm:px-8";
const KICKER = "text-[12px] font-semibold uppercase tracking-[0.12em] text-[#14f195]";
const H2 = "mt-2 text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[36px]";
const TILE = "rounded-[20px] bg-white/[0.04] p-6 ring-1 ring-white/10";

/**
 * Home. First screen: a midnight-purple hero with a calm field of arrows (layout and field adapted from the MIT
 * "Onward Summit Template", see components/GlyphField.tsx). Below it, in plain words: how it works, why it's safer,
 * what's real, and a last call to action. The nav sticks to the top and frosts once you scroll.
 */
function LandingInner() {
  const s = useSession();
  const router = useRouter();
  // A logged-out deep link (e.g. /merchant) lands here as /?next=/merchant; log in and go back there.
  const next = safeNext(useSearchParams().get("next"));
  const { login, pending, authenticated } = useLoginThenGo(next);
  const bannerH = useBannerHeight();
  const [scrolled, setScrolled] = useState(false);
  // Signed in and sent here with ?next= (old link, back button): carry on to that page.
  useEffect(() => { if (s.ready && s.authenticated && next) router.replace(next); }, [s.ready, s.authenticated, next, router]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const onNav = (e: MouseEvent<HTMLAnchorElement>, href: string, app: boolean) => {
    if (!app || authenticated) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; // new tab: let the app page redirect
    e.preventDefault();
    login(href);
  };

  const navLinks = (compact: boolean) => NAV.map((n) => {
    const active = n.href === "/";
    return (
      <Link key={n.href} href={n.href} onClick={(e) => onNav(e, n.href, n.app)} aria-current={active ? "page" : undefined}
        className={`shrink-0 rounded-full font-medium transition-colors ${compact ? "px-3 py-1.5 text-[13px]" : "px-3.5 py-1.5 text-[14px]"} ${active ? "bg-white text-[#1a0b3d]" : "text-white/85 hover:bg-white/15 hover:text-white"}`}>
        {n.label}
      </Link>
    );
  });

  return (
    <div className="landing-page bg-[#0b0618] text-white" style={{ ["--banner-h" as string]: `${bannerH}px` }}>
      {/* Sticky top bar. It overlaps the hero (negative margin = its height) and frosts once the page scrolls. */}
      <div className={`sticky z-40 -mb-[104px] transition-[background-color,box-shadow] duration-300 lg:-mb-16 ${scrolled ? "bg-[#0b0618]/80 shadow-[0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md" : ""}`}
        style={{ top: bannerH }}>
        <header className="grid h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-lg" aria-label="SolSend home"><Logo className="text-white" /></Link>
            <MockBadge className="bg-white/90 max-sm:hidden" />
          </div>
          <nav aria-label="Primary" className="hidden items-center gap-1 rounded-full bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur-md lg:flex">
            {navLinks(false)}
          </nav>
          <div className="flex items-center justify-end gap-1.5">
            {authenticated ? (
              <>
                <button type="button" onClick={() => void s.logout().then(() => router.replace("/"))} title={s.email ?? undefined}
                  className="min-h-9 rounded-full px-3 text-[13.5px] font-medium text-white/85 hover:bg-white/15 hover:text-white">Log out</button>
                <Link href="/cards/new" className="landing-cta">New card</Link>
              </>
            ) : (
              <button type="button" onClick={() => login()} className="landing-cta" aria-label="Try the sandbox demo">
                {pending ? <Spinner /> : null}<span>Try the<span className="max-[399px]:hidden"> sandbox</span> demo</span>
              </button>
            )}
          </div>
        </header>
        {/* Phones and tablets: the same nav as a row under the header. */}
        <nav aria-label="Pages" className="flex h-10 items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:justify-center lg:hidden">
          {navLinks(true)}
        </nav>
      </div>

      {/* Hero: exactly the first screen. */}
      <section aria-label="SolSend" className="relative isolate flex flex-col overflow-hidden pt-[104px] lg:pt-16" style={{ height: `calc(100svh - ${bannerH}px)` }}>
        <div className="landing-bg absolute inset-0 -z-20" aria-hidden="true" />
        <GlyphField />
        <div className="flex min-h-0 flex-1 flex-col items-center px-5 pb-[6vh] text-center [justify-content:safe_center] short:pb-2">
          <h1 className="landing-title anim-rise">SolSend</h1>
          <p className="mt-2 text-[clamp(17px,1.95vw,24px)] font-medium leading-[1.25] tracking-[-0.02em] [text-shadow:0_2px_20px_rgba(11,6,24,0.6)]">
            A burner card for every store,<br />paid straight from your Solana wallet.
          </p>
          <div className="mt-6 short:mt-3 flex flex-wrap items-center justify-center gap-2">
            {authenticated
              ? <Link href="/home" className="landing-cta-2">Open your wallet</Link>
              : <button type="button" onClick={() => login("/cards/new")} className="landing-cta-2">Make your first card</button>}
          </div>
          <p className="mt-3 text-[13px] font-medium text-white/80 short:hidden [text-shadow:0_1px_8px_rgba(11,6,24,0.6)]">
            {!authenticated && next && PAGE_NAME[next] ? `Log in to open ${PAGE_NAME[next]}.` : "Each card holds $0 · test money only · free"}
          </p>
        </div>
        <a href="#how" className="mx-auto mb-4 inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-white/60 transition-colors hover:text-white short:hidden">
          How it works<Icon name="chevron" className="h-4 w-4" />
        </a>
      </section>

      {/* 1. How it works */}
      <section id="how" aria-labelledby="how-title" className={`${SECTION} landing-anchor pt-20 sm:pt-24`}>
        <p className={KICKER}>How it works</p>
        <h2 id="how-title" className={H2}>Three steps. About a minute.</h2>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map((st, i) => (
            <li key={st.title} className={TILE}>
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#14f195] text-[14px] font-bold text-[#04130d]">{i + 1}</span>
                <Icon name={st.icon} className="h-5 w-5 text-white/50" />
              </div>
              <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{st.title}</h3>
              <p className="mt-1.5 text-[15px] leading-[22px] text-white/65">{st.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 2. Why it's safer, with the card illustration */}
      <section aria-labelledby="why-title" className={`${SECTION} grid items-center gap-12 pt-24 lg:grid-cols-[1fr_380px]`}>
        <div>
          <p className={KICKER}>Why it&apos;s safer</p>
          <h2 id="why-title" className={H2}>One card per store.<br />Useless anywhere else.</h2>
          <ul className="mt-8 space-y-5">
            {WHY.map((w) => (
              <li key={w.title} className="flex gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/[0.06] text-[#14f195] ring-1 ring-white/10"><Icon name={w.icon} className="h-5 w-5" /></span>
                <div>
                  <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{w.title}</h3>
                  <p className="mt-0.5 text-[15px] leading-[22px] text-white/65">{w.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <DemoLoop />
      </section>

      {/* 3. Control + honesty */}
      <section aria-label="Control and what's real" className={`${SECTION} grid gap-3 pt-24 sm:grid-cols-2`}>
        <div className={TILE}>
          <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Icon name="shield" className="h-5 w-5 text-[#14f195]" />You stay in control</h2>
          <p className="mt-2 text-[15px] leading-[22px] text-white/65">Freeze or close any card, or shut off all of them at once. If the card company goes down, your money never left your wallet.</p>
        </div>
        <div className={TILE}>
          <h2 className="flex items-center gap-2 text-[17px] font-semibold"><Icon name="flask" className="h-5 w-5 text-[#14f195]" />What&apos;s real here?</h2>
          <p className="mt-2 text-[15px] leading-[22px] text-white/65">This is a test version. Cards are sandbox cards and the money is test USDC, so no real store is ever charged. The Solana transactions are real (on devnet) and you can look them up.</p>
        </div>
      </section>

      {/* 4. Last call to action */}
      <section aria-labelledby="cta-title" className={`${SECTION} pt-24`}>
        <div className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#2e1065,#4c1d95_55%,#0f5c43)] p-8 ring-1 ring-white/10 sm:flex sm:items-center sm:justify-between sm:p-10">
          <div>
            <h2 id="cta-title" className="text-[24px] font-semibold tracking-[-0.025em] sm:text-[28px]">Make your first card in a minute</h2>
            <p className="mt-1.5 text-[15px] text-white/70">{authenticated ? "Pick a store and a limit. Test money only." : "Sign in with an email. Test money only."}</p>
          </div>
          {authenticated
            ? <Link href="/cards/new" className="landing-cta-2 mt-6 shrink-0 sm:mt-0">Create a card</Link>
            : <button type="button" onClick={() => login()} className="landing-cta-2 mt-6 shrink-0 sm:mt-0">{pending ? <Spinner /> : null}Get started</button>}
        </div>
      </section>

      <footer className={`${SECTION} mt-20 flex flex-col gap-3 border-t border-white/10 py-8 text-[13px] text-white/50 sm:flex-row sm:items-center sm:justify-between`}>
        <p>Settles on Solana · Cards via Lithic sandbox · Events via QuickNode Streams</p>
        <nav aria-label="Footer" className="-mx-2 flex items-center">
          <a href="#how" className="inline-flex min-h-9 items-center px-2 hover:text-white">How it works</a>
          <Link href="/status" className="inline-flex min-h-9 items-center px-2 hover:text-white">System status</Link>
        </nav>
      </footer>
    </div>
  );
}
