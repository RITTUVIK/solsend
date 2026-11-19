"use client";
import { Suspense, useEffect, useState, type MouseEvent, type ReactNode } from "react";
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
  { title: "Get free test money", body: "Sign in with your email. You get a Solana wallet with free test dollars." },
  { title: "Make a card for one store", body: "Pick a store and a limit, like “Temu, $40 total”." },
  { title: "Pay. The money moves first.", body: "Dollars stay in your wallet until you buy. Solana pays, then the card says yes." },
] as const;

const WHY = [
  { icon: "wallet", title: "Holds $0", body: "It only pulls what you allowed, when you buy." },
  { icon: "lock", title: "Locked to one store", body: "A leaked number gets declined everywhere else." },
  { icon: "shield", title: "You stay in control", body: "Hard limits enforced by Solana. Freeze or close any card." },
] as const;

const REAL = [
  { icon: "flask", title: "Test version", body: "Sandbox cards and test USDC. No real store is ever charged." },
  { icon: "chain", title: "Real Solana transactions", body: "Every payment is a real devnet transaction you can look up." },
] as const;

const DEMO_CARD: CardView = {
  cardPda: "demo", cardId: "demo", label: "Temu card", merchantName: "Temu", kind: "STORE_LOCKED", status: "ACTIVE", issueState: "issued",
  lithic: { cardToken: null, lastFour: "4242", state: "OPEN" },
  limit: { type: "lifetime", totalBase: "40000000", remainingBase: "40000000", periodSecs: null },
  totals: { settledBase: "0", refundedBase: "0" }, merchantLocked: true, delegationLive: true, delegation: "demo", createdAt: "2026-01-01T00:00:00Z",
  registerSignature: null, expiresAt: null, expired: false,
};

/** 7 s loop built from the real card component, captioned as an illustration (not live data). */
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
    <figure className="relative mx-auto w-[min(360px,46vh)]" aria-label="Illustration: a Temu card is approved for $12, then the same number is declined at Amazon">
      <div className="mb-3 flex justify-center">
        <span className="tnum inline-flex items-center gap-2 rounded-full bg-[#0b0618]/60 px-3.5 py-1.5 text-[14px] font-semibold text-white ring-1 ring-white/15 backdrop-blur-sm">
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
            <div className="min-w-0 text-[14px] leading-5"><p className="font-semibold text-[#ff8a8a]">Declined at Amazon</p><p className="text-[13px] text-white/60">Locked to Temu, so a leaked number is useless</p></div>
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-center text-[11px] font-medium text-white/45">Illustration of the sandbox demo</figcaption>
    </figure>
  );
}

/** One row: icon or number badge, title, one-line explanation. */
function Point({ badge, title, body, className = "" }: { badge: ReactNode; title: string; body: string; className?: string }) {
  return (
    <li className={`flex gap-3 ${className}`}>
      {badge}
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-5 tracking-[-0.01em]">{title}</p>
        <p className="mt-0.5 text-[13.5px] leading-[19px] text-white/65">{body}</p>
      </div>
    </li>
  );
}
const iconBadge = (name: string) => (
  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-[#14f195] ring-1 ring-white/10"><Icon name={name} className="h-[18px] w-[18px]" /></span>
);
const numBadge = (n: number) => (
  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#14f195] text-[13px] font-bold text-[#04130d]">{n}</span>
);

const TABS = [
  { id: "how", label: "How it works" },
  { id: "why", label: "Why it's safer" },
  { id: "real", label: "What's real" },
] as const;

/** Phones and tablets: the same explanations as the desktop layout, one topic at a time, so nothing needs scrolling. */
function InfoTabs() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("how");
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-md flex-col rounded-[20px] bg-[#0b0618]/60 p-3 ring-1 ring-white/10 backdrop-blur-md">
      <div role="tablist" aria-label="About SolSend" className="grid shrink-0 grid-cols-3 gap-1 rounded-full bg-white/[0.06] p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="info-panel" onClick={() => setTab(t.id)}
            className={`min-h-9 rounded-full px-1 text-[12.5px] font-semibold transition-colors ${tab === t.id ? "bg-white text-[#1a0b3d]" : "text-white/70 hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <ul id="info-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-3 min-h-0 space-y-3 overflow-y-auto px-1 pb-1 text-left">
        {tab === "how" && STEPS.map((s, i) => <Point key={s.title} badge={numBadge(i + 1)} title={s.title} body={s.body} />)}
        {tab === "why" && WHY.map((w) => <Point key={w.title} badge={iconBadge(w.icon)} title={w.title} body={w.body} />)}
        {tab === "real" && REAL.map((r) => <Point key={r.title} badge={iconBadge(r.icon)} title={r.title} body={r.body} />)}
      </ul>
    </div>
  );
}

export default function Landing() {
  return <Suspense fallback={null}><LandingInner /></Suspense>;
}

/** Height of the sandbox banner at the top of the page (phones only; it wraps to two lines on narrow ones). */
function useBannerHeight() {
  const [h, setH] = useState(32);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="sandbox-banner"]');
    if (!el) return;
    // Only the phone layout keeps the banner in the flow at the top; from sm up it's a pill pinned bottom-left.
    const read = () => setH(getComputedStyle(el).position === "fixed" ? 0 : el.offsetHeight);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    window.addEventListener("resize", read);
    return () => { ro.disconnect(); window.removeEventListener("resize", read); };
  }, []);
  return h;
}

/**
 * Home: everything on one screen, no scrolling. A midnight-purple field of arrows (adapted from the MIT "Onward Summit
 * Template", see components/GlyphField.tsx) behind the pitch, the steps, why it's safer and what's real. Desktop shows
 * it all at once; phones show the explanations in a small tab panel.
 */
function LandingInner() {
  const s = useSession();
  const router = useRouter();
  // A logged-out deep link (e.g. /merchant) lands here as /?next=/merchant; log in and go back there.
  const next = safeNext(useSearchParams().get("next"));
  const { login, pending, authenticated } = useLoginThenGo(next);
  const bannerH = useBannerHeight();
  // Signed in and sent here with ?next= (old link, back button): carry on to that page.
  useEffect(() => { if (s.ready && s.authenticated && next) router.replace(next); }, [s.ready, s.authenticated, next, router]);

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

  const hint = !authenticated && next && PAGE_NAME[next] ? `Log in to open ${PAGE_NAME[next]}.` : "Each card holds $0 · test money only · free";
  const cta = authenticated
    ? <Link href="/home" className="landing-cta-2">Open your wallet</Link>
    : <button type="button" onClick={() => login("/cards/new")} className="landing-cta-2">Make your first card</button>;

  return (
    <div className="fixed inset-x-0 bottom-0 z-0 overflow-hidden" style={{ top: bannerH }}>
      <section aria-label="SolSend" className="relative isolate flex h-full flex-col text-white">
        <div className="landing-bg absolute inset-0 -z-20" aria-hidden="true" />
        <GlyphField />

        <header className="grid h-16 shrink-0 grid-cols-[1fr_auto] items-center gap-3 px-4 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
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
        <nav aria-label="Pages" className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:justify-center lg:hidden">
          {navLinks(true)}
        </nav>

        {/* ---------- Desktop: pitch + why on the left, the card on the right, steps along the bottom ---------- */}
        <div className="mx-auto hidden min-h-0 w-full max-w-6xl flex-1 flex-col px-8 lg:flex">
          <div className="grid min-h-0 flex-1 grid-cols-[1.15fr_1fr] items-center gap-10">
            <div>
              <h1 className="landing-title landing-title--side anim-rise">SolSend</h1>
              <p className="mt-2 text-[clamp(18px,1.7vw,24px)] font-medium leading-[1.25] tracking-[-0.02em] [text-shadow:0_2px_20px_rgba(11,6,24,0.6)]">
                A burner card for every store,<br />paid straight from your Solana wallet.
              </p>
              <div className="mt-5 flex items-center gap-4">
                {cta}
                <p className="text-[13px] font-medium text-white/75">{hint}</p>
              </div>
              <ul aria-label="Why it's safer" className="mt-7 grid max-w-xl gap-3.5 rounded-[20px] bg-[#0b0618]/50 p-4 ring-1 ring-white/10 backdrop-blur-md tall:gap-4 tall:p-5">
                {WHY.map((w) => <Point key={w.title} badge={iconBadge(w.icon)} title={w.title} body={w.body} />)}
              </ul>
            </div>
            <DemoLoop />
          </div>
          <div className="shrink-0 pb-4">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#14f195]">How it works</p>
            <ol className="grid grid-cols-3 gap-3">
              {STEPS.map((st, i) => (
                <Point key={st.title} badge={numBadge(i + 1)} title={st.title} body={st.body} className="rounded-[16px] bg-[#0b0618]/55 p-4 ring-1 ring-white/10 backdrop-blur-md" />
              ))}
            </ol>
            {/* The sandbox pill (root layout) sits at the bottom-left of this row. */}
            <p className="mt-3 flex min-h-7 items-center justify-end text-[12px] font-medium text-white/50">Solana · Lithic sandbox · QuickNode Streams</p>
          </div>
        </div>

        {/* ---------- Phones and tablets: pitch, then the explanations in tabs ---------- */}
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 px-4 pb-4 pt-3 text-center lg:hidden short:gap-2 short:pt-1">
          <div className="flex flex-1 flex-col items-center [justify-content:safe_center]">
            <h1 className="landing-title anim-rise">SolSend</h1>
            <p className="mt-1 text-[clamp(16px,2.6vw,22px)] font-medium leading-[1.25] tracking-[-0.02em] [text-shadow:0_2px_20px_rgba(11,6,24,0.6)] short:hidden">
              A burner card for every store,<br />paid straight from your Solana wallet.
            </p>
            <div className="mt-4 short:mt-2">{cta}</div>
            <p className="mt-2 text-[12.5px] font-medium text-white/75 short:hidden">{hint}</p>
          </div>
          <InfoTabs />
        </div>
      </section>
    </div>
  );
}
