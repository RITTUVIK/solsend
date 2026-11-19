"use client";
import { Suspense, useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/client/session";
import { Logo } from "@/components/AppShell";
import { GlyphField } from "@/components/GlyphField";
import { safeNext, useLoginThenGo } from "@/components/PublicChrome";
import { MockBadge, Spinner } from "@/components/ui";

/** Pages reachable from the top nav. App pages need a session: logged out, a click logs in and then opens the page. */
const NAV = [
  { href: "/", label: "Home", app: false },
  { href: "/home", label: "Wallet", app: true },
  { href: "/merchant", label: "Demo store", app: true },
  { href: "/activity", label: "Activity", app: true },
  { href: "/status", label: "Status", app: false },
] as const;

const PAGE_NAME: Record<string, string> = { "/home": "your wallet", "/merchant": "the demo store", "/activity": "your activity", "/cards/new": "a new card" };

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

/**
 * Home: one screen, no scrolling. A navy-to-white hero with a calm field of arrows, the top nav to every page, and
 * one primary action. Layout and field adapted from the MIT "Onward Summit Template" (see components/GlyphField.tsx).
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
        className={`shrink-0 rounded-full font-medium transition-colors ${compact ? "px-3 py-1.5 text-[13px]" : "px-3.5 py-1.5 text-[14px]"} ${active ? "bg-white text-[#06174a]" : "text-white/85 hover:bg-white/15 hover:text-white"}`}>
        {n.label}
      </Link>
    );
  });

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
        <nav aria-label="Pages" className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:justify-center lg:hidden">
          {navLinks(true)}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col items-center px-5 pb-[6vh] text-center [justify-content:safe_center] short:pb-2">
          <h1 className="landing-title anim-rise">SolSend</h1>
          <p className="mt-2 text-[clamp(17px,1.95vw,24px)] font-medium leading-[1.25] tracking-[-0.02em] [text-shadow:0_2px_20px_rgba(6,23,74,0.5)]">
            A burner card for every store,<br />paid straight from your Solana wallet.
          </p>
          <div className="mt-6 short:mt-3 flex flex-wrap items-center justify-center gap-2">
            {authenticated
              ? <Link href="/home" className="landing-cta-2">Open your wallet</Link>
              : <button type="button" onClick={() => login("/cards/new")} className="landing-cta-2">Make your first card</button>}
          </div>
          <p className="mt-3 text-[13px] font-medium text-white/80 short:hidden [text-shadow:0_1px_8px_rgba(6,23,74,0.5)]">
            {!authenticated && next && PAGE_NAME[next] ? `Log in to open ${PAGE_NAME[next]}.` : "Each card holds $0 · test money only · free"}
          </p>
        </div>

        <p className="shrink-0 px-4 pb-4 text-center short:hidden text-[12px] font-medium text-[#0c0e13]/55">
          Settles on Solana · Cards via Lithic sandbox · Events via QuickNode Streams
        </p>
      </section>
    </div>
  );
}
