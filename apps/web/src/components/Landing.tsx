"use client";
import { Suspense, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/client/session";
import { cardArt } from "@/client/cardArt";
import { Logo } from "@/components/AppShell";
import { StoreTile } from "@/components/CardVisual";
import { GlyphField } from "@/components/GlyphField";
import { safeNext, useLoginThenGo } from "@/components/PublicChrome";
import { Icon, Spinner } from "@/components/ui";

/** Space Grotesk, used only for the "How it works" steps. */
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

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

const AMAZON = cardArt("Amazon");

/** Illustration (not live data), static: an Amazon-only card is approved at Amazon and declined at Temu. */
function DemoLoop() {
  return (
    <figure className="relative mx-auto w-[min(360px,46vh)]" aria-label="Illustration: an Amazon card is approved for $12 at Amazon and declined at Temu">
      <div className="relative aspect-[1.586] w-full overflow-hidden rounded-[20px] text-white shadow-[0_1px_0_rgb(255_255_255/.2)_inset,0_18px_40px_-16px_rgb(0_0_0/.7)]">
        <div className="card-noise card-sheen absolute inset-0 rounded-[inherit]" style={{ background: AMAZON.background }} aria-hidden="true" />
        {AMAZON.accentBar && <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: AMAZON.accentBar }} aria-hidden="true" />}
        <div className="relative flex h-full flex-col justify-between p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/15 text-[18px] font-bold ring-1 ring-white/25" aria-hidden="true">{AMAZON.monogram}</span>
              <p className="text-[16px] font-semibold leading-5">Amazon card<span className="block text-[11px] font-medium uppercase tracking-[0.1em] text-white/55">Sandbox</span></p>
            </div>
            <p className="tnum text-right text-[22px] font-semibold leading-6">$28.00<span className="block text-[12px] font-medium text-white/65">left of $40</span></p>
          </div>
          <div className="flex items-end justify-between">
            <p className="tnum font-mono text-[16px] tracking-[0.14em]">•••• 4242</p>
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[#ffb547]"><Icon name="lock" className="h-3.5 w-3.5" strokeWidth={2.2} />Amazon only</span>
          </div>
        </div>
      </div>
      <ul className="mt-3 space-y-2 text-white" aria-hidden="true">
        <li className="flex items-center gap-3 rounded-[16px] bg-black/80 px-3.5 py-2.5 ring-1 ring-white/10">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#14f195] text-[#04130d]"><Icon name="check" className="h-4 w-4" strokeWidth={3} /></span>
          <p className="text-[14px] font-semibold">Approved · $12.00 at Amazon</p>
        </li>
        <li className="flex items-center gap-3 rounded-[16px] bg-black/80 px-3.5 py-2.5 ring-1 ring-white/10">
          <StoreTile merchant="Temu" size={32} />
          <div className="min-w-0 text-[14px] leading-5"><p className="font-semibold text-[#ff8a8a]">Declined at Temu</p><p className="text-[13px] text-white/60">This card only works at Amazon</p></div>
        </li>
      </ul>
      {/* Always visible: the card above is a drawing, not a real issued card, and has nothing to do with Amazon. */}
      <figcaption data-illustration-caption className="mt-2.5 rounded-2xl bg-black/80 px-3 py-1.5 text-center text-[12px] font-medium leading-4 text-white ring-1 ring-white/10">
        <span className="block font-bold uppercase tracking-[0.1em]">Illustration</span>Not a real card · not affiliated with Amazon
      </figcaption>
    </figure>
  );
}

/** One "How it works" step: plain, no box. Space Grotesk. */
function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className={`${grotesk.className} border-t border-white/15 pt-3`}>
      <p className="text-[13px] font-medium text-white [text-shadow:0_0_6px_#0b0618,0_0_2px_#0b0618]">0{n}</p>
      <p className="mt-1 text-[17px] font-semibold leading-6 tracking-[-0.01em]">{title}</p>
      <p className="mt-1 text-[14px] leading-5 text-white/60">{body}</p>
    </li>
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

/** `split`: an app page is open in the right-hand pane (components/SplitFrame.tsx). On desktop the landing narrows to
 *  the left column and shows a compact version; below lg it hides, because the app takes the whole screen. */
export function Landing({ split = false }: { split?: boolean }) {
  return <Suspense fallback={null}><LandingInner split={split} /></Suspense>;
}

/** Height of the sandbox banner at the top of the page (phones and tablets; it wraps to two lines on narrow ones). */
function useBannerHeight() {
  const [h, setH] = useState(32);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="sandbox-banner"]');
    if (!el) return;
    // Below lg the banner stays in the flow at the top; from lg up it's a pill pinned bottom-left.
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
 * Home: everything on one screen, no scrolling. A midnight-purple field of arrows (components/GlyphField.tsx; the hero
 * layout is adapted from the MIT "Onward Summit Template", see THIRD_PARTY_NOTICES.md) behind the pitch, the steps, why it's safer and what's real. Desktop shows
 * it all at once; phones show the explanations in a small tab panel.
 */
function LandingInner({ split }: { split: boolean }) {
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
    <div className={`landing-shell fixed bottom-0 left-0 z-0 overflow-hidden ${split ? "right-0 max-lg:hidden lg:right-[var(--app-w)]" : "right-0"}`}
      style={{ top: bannerH }} data-split={split ? "" : undefined}>
      <section aria-label="SolSend" className="relative isolate flex h-full flex-col text-white">
        <div className="landing-bg absolute inset-0 -z-20" aria-hidden="true" />
        <GlyphField />

        <header className="grid h-16 shrink-0 grid-cols-[1fr_auto] items-center gap-3 px-4 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-lg" aria-label="SolSend home"><Logo className="text-white" /></Link>
          </div>
          {/* Split: the app pane on the right has the tabs and Log out, so the left keeps only the logo. */}
          {!split && <nav aria-label="Primary" className="hidden items-center gap-1 rounded-full bg-white/10 p-1 ring-1 ring-white/15 backdrop-blur-md lg:flex">
            {navLinks(false)}
          </nav>}
          {!split && <div className="flex items-center justify-end gap-1.5">
            {authenticated ? (
              <>
                <button type="button" onClick={() => void s.logout().then(() => router.replace("/"))} title={s.email ?? undefined}
                  className="min-h-9 rounded-full px-3 text-[13.5px] font-medium text-white/85 hover:bg-white/15 hover:text-white">Log out</button>
              </>
            ) : (
              <button type="button" onClick={() => login()} className="landing-cta" aria-label="Try the sandbox demo">
                {pending ? <Spinner /> : null}<span>Try the<span className="max-[399px]:hidden"> sandbox</span> demo</span>
              </button>
            )}
          </div>}
        </header>

        {/* Phones and tablets: the same nav as a row under the header. */}
        <nav aria-label="Pages" className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] sm:justify-center lg:hidden">
          {navLinks(true)}
        </nav>

        {/* ---------- Desktop, app open on the right: one compact column (pitch, why, steps) ---------- */}
        {split && (
          <div key="side" className="hidden min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-2 lg:mb-[52px] lg:flex xl:px-12 [mask-image:linear-gradient(to_bottom,#000_calc(100%-14px),transparent)]">
            <div className="my-auto w-full max-w-xl py-4">
              <h1 className="landing-title landing-title--split" aria-label="SolSend"><span className="landing-sol">sol</span><span className="landing-send">send</span></h1>
              <p className="mt-2 text-[clamp(17px,1.45vw,21px)] font-medium leading-[1.25] tracking-[-0.02em] [text-shadow:0_2px_20px_rgba(11,6,24,0.6)]">
                A burner card for every store,<br />paid straight from your Solana wallet.
              </p>
              <ul aria-label="Why it's safer" className="mt-6 grid gap-3.5 rounded-[20px] bg-black p-4 ring-1 ring-white/10">
                {WHY.map((w) => <Point key={w.title} badge={iconBadge(w.icon)} title={w.title} body={w.body} />)}
              </ul>
              <p className={`${grotesk.className} mb-2 mt-6 text-[12px] font-semibold uppercase tracking-[0.12em] text-white [text-shadow:0_0_6px_#0b0618,0_0_2px_#0b0618]`}>How it works</p>
              <ol className="grid gap-4">
                {STEPS.map((st, i) => (
                  <Step key={st.title} n={i + 1} title={st.title} body={st.body} />
                ))}
              </ol>
              <p className="mt-4 text-[12px] font-medium text-white/50">Solana · Lithic sandbox · QuickNode Streams</p>
            </div>
          </div>
        )}

        {/* ---------- Desktop: pitch + why on the left, the card on the right, steps along the bottom ---------- */}
        <div className={`mx-auto hidden min-h-0 w-full max-w-6xl flex-1 flex-col px-8 ${split ? "" : "lg:flex lg:overflow-y-auto lg:[@media(max-height:680px)]:mb-[52px]"}`}>
          <div className="grid min-h-[430px] flex-1 grid-cols-[1.15fr_1fr] items-center gap-10">
            <div>
              <h1 className="landing-title landing-title--side" aria-label="SolSend"><span className="landing-sol">sol</span><span className="landing-send">send</span></h1>
              <p className="mt-2 text-[clamp(18px,1.7vw,24px)] font-medium leading-[1.25] tracking-[-0.02em] [text-shadow:0_2px_20px_rgba(11,6,24,0.6)]">
                A burner card for every store,<br />paid straight from your Solana wallet.
              </p>
              <div className="mt-5 flex items-center gap-4">
                {cta}
                <p className="text-[13px] font-medium text-white/75">{hint}</p>
              </div>
              <ul aria-label="Why it's safer" className="mt-7 grid max-w-xl gap-3.5 rounded-[20px] bg-black p-4 ring-1 ring-white/10 tall:gap-4 tall:p-5">
                {WHY.map((w) => <Point key={w.title} badge={iconBadge(w.icon)} title={w.title} body={w.body} />)}
              </ul>
            </div>
            <DemoLoop />
          </div>
          <div className="shrink-0 pb-4">
            <p className={`${grotesk.className} mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white [text-shadow:0_0_6px_#0b0618,0_0_2px_#0b0618]`}>How it works</p>
            <ol className="grid grid-cols-3 gap-8">
              {STEPS.map((st, i) => (
                <Step key={st.title} n={i + 1} title={st.title} body={st.body} />
              ))}
            </ol>
            {/* The sandbox pill (root layout) sits at the bottom-left of this row. */}
            <p className="mt-3 flex min-h-7 items-center justify-end text-[12px] font-medium text-white/50">Solana · Lithic sandbox · QuickNode Streams</p>
          </div>
        </div>

        {/* ---------- Phones and tablets: pitch, then the explanations in tabs (hidden behind the app when split) ---------- */}
        <div className="flex min-h-0 flex-1 flex-col items-center gap-4 px-4 pb-4 pt-3 text-center lg:hidden short:gap-2 short:pt-1">
          <div className="flex flex-1 flex-col items-center [justify-content:safe_center]">
            <h1 className="landing-title" aria-label="SolSend"><span className="landing-sol">sol</span><span className="landing-send">send</span></h1>
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
