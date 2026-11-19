"use client";
import { createContext, useContext, useEffect, useId, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { api } from "@solsend/shared";
import { explorerTx } from "@solsend/shared";
import type { z } from "zod";
import { client } from "@/client/api";
import { DATA_POLL_MS } from "@/client/config";
import { usePoll, type Polled } from "@/client/hooks";
import { isMockSig, shortId, type CardView } from "@/client/format";
import { useSignNotice } from "@/client/notice";
import { useSession } from "@/client/session";
import { dismissToast, useToast } from "@/client/toast";
import { SiteFooter } from "./PublicChrome";
import { Icon, MockBadge, MockTag, OnchainGlyph, Skeleton, Spinner } from "./ui";

type Wallet = z.infer<typeof api.WalletResponse>;
interface AppData { wallet: Polled<Wallet>; cards: Polled<CardView[]> }
const Ctx = createContext<AppData | null>(null);
export const useAppData = (): AppData => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAppData outside <AppShell>");
  return c;
};

/** Card pages (/cards/new, /cards/<pda>) live under Wallet. Home (the landing page) matches only "/" exactly. */
const isActive = (path: string, href: string) => path === href || (href === "/home" && path.startsWith("/cards"));
const NAV = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/home", label: "Wallet", icon: "wallet" },
  { href: "/merchant", label: "Demo store", icon: "store" },
  { href: "/activity", label: "Activity", icon: "pulse" },
] as const;

/** Signed-in page tabs, desktop (pill in the header). Shared by the app shell and the public pages when logged in. */
export function AppTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="hidden gap-1 rounded-full bg-sunken p-1 sm:flex">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 text-[14px] font-medium transition ${isActive(path, n.href) ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}>{n.label}</Link>
      ))}
    </nav>
  );
}

/** Signed-in page tabs, mobile (fixed bottom bar). Pages that show it need ~88px of bottom padding. */
export function AppTabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
      <ul className="mx-auto flex max-w-2xl">
        {NAV.map((n) => (
          <li key={n.href} className="flex-1">
            <Link href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined}
              className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive(path, n.href) ? "text-ink" : "text-ink-3"}`}>
              <Icon name={n.icon} className="h-[22px] w-[22px]" strokeWidth={isActive(path, n.href) ? 2.2 : 1.8} />{n.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Data({ children }: { children: ReactNode }) {
  const wallet = usePoll<Wallet>(client.wallet, DATA_POLL_MS);
  const cards = usePoll(client.listCards, DATA_POLL_MS);
  return <Ctx.Provider value={{ wallet, cards }}>{children}</Ctx.Provider>;
}

/** Brand mark: three stacked, slanted cards in the Solana gradient (also used as the favicon, src/app/icon.svg). */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  const id = `ss-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  return (
    <svg viewBox="0 8 120 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="110" y2="14">
          <stop offset="0" stopColor="#9945FF" /><stop offset="0.5" stopColor="#43B4CA" /><stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <g transform="matrix(1 0 -0.2126 1 18 0)">
        <rect x="30" y="18" width="72" height="50" rx="10" fill="none" stroke={`url(#${id})`} strokeWidth="5" />
        <rect x="20" y="32" width="72" height="50" rx="10" fill={`url(#${id})`} fillOpacity="0.4" />
        <rect x="10" y="46" width="72" height="50" rx="10" fill={`url(#${id})`} />
        <rect x="22" y="58" width="16" height="12" rx="3" fill="#fff" fillOpacity="0.92" />
      </g>
    </svg>
  );
}

/** Wordmark: the mark + "sol" (bold, ink) "send" (Solana gradient). */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-[20px] font-bold leading-none tracking-[-0.045em] ${className}`}>
      <LogoMark className="h-7 w-8" />
      <span>sol<span className="bg-[linear-gradient(90deg,#9945FF,#43B4CA,#14F195)] bg-clip-text font-normal text-transparent">send</span></span>
    </span>
  );
}

function ToastHost() {
  const t = useToast();
  if (!t) return null;
  return (
    <div role="status" data-testid={t.testId} key={t.id}
      className="anim-rise fixed inset-x-4 bottom-[88px] z-[80] mx-auto max-w-md rounded-[16px] bg-ink px-4 py-3 text-paper shadow-2xl sm:bottom-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-mint text-[#04130d]"><Icon name="check" className="h-3 w-3" strokeWidth={3} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{t.title}</p>
          {t.sig && (
            <a href={explorerTx(t.sig)} target="_blank" rel="noreferrer" aria-label={t.linkLabel ?? "View on Solana Explorer (devnet)"}
              className="mt-1 inline-flex min-h-8 items-center gap-2 text-[13px] font-medium text-paper/80 hover:text-paper">
              <OnchainGlyph className="h-4 w-4" /><span className="whitespace-nowrap">On Solana</span> <code className="whitespace-nowrap font-mono text-[12px] opacity-80">{shortId(t.sig, 4)}</code><Icon name="ext" className="h-3.5 w-3.5" />
              {isMockSig(t.sig) && <MockTag />}
            </a>
          )}
        </div>
        <button type="button" onClick={dismissToast} className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-paper/70 hover:text-paper" aria-label="Dismiss"><Icon name="x" className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** Authenticated frame: header, tab bar, session guard and the shared wallet/cards pollers. */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();
  // Logged out on an app page: go to the landing page, remembering where you were so login brings you back.
  useEffect(() => {
    if (s.ready && !s.authenticated) router.replace(path && path !== "/home" ? `/?next=${encodeURIComponent(path)}` : "/");
  }, [s.ready, s.authenticated, router, path]);

  const notice = useSignNotice();
  const gated = !s.ready || !s.authenticated || s.walletPending || !s.wallet;
  return (
    <div className={`mx-auto flex min-h-[calc(100dvh-32px)] w-full flex-col ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href="/home" className="rounded-lg" aria-label="SolSend home"><Logo /></Link>
          <MockBadge />
        </div>
        <AppTabs />
        {s.authenticated && (
          <button type="button" onClick={() => void s.logout().then(() => router.replace("/"))} className="btn-ghost !min-h-10 !px-3 !text-[14px]" title={s.email ?? undefined}>Log out</button>
        )}
      </header>
      <main className="flex-1 px-4 pb-4 pt-2">
        {gated ? (
          <div className="space-y-4" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm text-ink-2"><Spinner />{s.walletPending ? "Creating your Solana wallet…" : "Loading…"}</p>
            <Skeleton className="h-24" /><Skeleton className="aspect-[1.586] !rounded-[20px]" />
          </div>
        ) : (
          <Data>{children}</Data>
        )}
      </main>
      <div className="px-4 pb-28 sm:pb-8"><SiteFooter inApp /></div>
      {notice && (
        <div role="status" data-testid="sign-notice" className="anim-rise fixed inset-x-4 bottom-[88px] z-[90] mx-auto max-w-md rounded-[16px] bg-ink px-4 py-3 text-center text-[15px] font-medium text-paper shadow-2xl sm:bottom-6">{notice}</div>
      )}
      <ToastHost />
      <AppTabBar />
    </div>
  );
}
