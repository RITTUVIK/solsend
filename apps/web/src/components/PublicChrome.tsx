"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/client/session";
import { AppTabBar, AppTabs, Logo } from "@/components/AppShell";
import { MockBadge, Spinner } from "@/components/ui";

/** Only same-origin app paths are allowed as a post-login destination (see client/safe-next.ts). */
export { safeNext } from "@/client/safe-next";

/**
 * Log-in trigger shared by the public pages. Never renders disabled before hydration: a click before the session is
 * ready is queued. Once logged in it sends you to the page you asked for (`login("/merchant")`), else `next`, else
 * the wallet.
 */
export function useLoginThenGo(next: string | null = null) {
  const s = useSession();
  const router = useRouter();
  const [queued, setQueued] = useState(false);
  const [dest, setDest] = useState<string | null>(null); // null until a login was asked for on this page
  useEffect(() => { if (queued && s.ready && !s.authenticated) { setQueued(false); s.login(); } }, [queued, s]);
  useEffect(() => { if (dest && s.ready && s.authenticated) router.replace(dest); }, [dest, s.ready, s.authenticated, router]);
  const login = (to?: string) => {
    setDest(safeNext(to) ?? next ?? "/home");
    if (s.ready) s.login(); else setQueued(true);
  };
  return { login, pending: queued && !s.ready, authenticated: s.ready && s.authenticated };
}

const NAV_LINK = "inline-flex min-h-10 items-center rounded-lg px-2.5 text-[14px] font-medium text-ink-2 hover:text-ink";

/** Header for pages outside the signed-in app (landing, status, 404). */
export function PublicHeader({ current, next = null }: { current?: "status"; next?: string | null }) {
  const { login, pending, authenticated } = useLoginThenGo(next);
  const s = useSession();
  const router = useRouter();
  // Signed in: the same page tabs as the app (Home · Wallet · Demo store · Activity), so every page is one tap away.
  if (authenticated) {
    return (
      <>
        <header className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-lg" aria-label="SolSend home"><Logo /></Link>
            <MockBadge />
          </div>
          <AppTabs />
          <button type="button" onClick={() => void s.logout().then(() => router.replace("/"))} className="btn-ghost !min-h-10 !px-3 !text-[14px]" title={s.email ?? undefined}>Log out</button>
        </header>
        <AppTabBar />
      </>
    );
  }
  return (
    <header className="flex items-center justify-between gap-2 py-4">
      <div className="flex items-center gap-2">
        <Link href="/" className="rounded-lg" aria-label="SolSend home"><Logo /></Link>
        <MockBadge />
      </div>
      <nav aria-label="Site" className="flex items-center gap-0.5 sm:gap-1">
        <Link href="/" className={`${NAV_LINK} max-sm:hidden`}>Home</Link>
        <Link href="/status" className={NAV_LINK} aria-current={current === "status" ? "page" : undefined}>Status</Link>
        <button type="button" onClick={() => login()} className="btn-secondary !min-h-10 !rounded-full !px-4 !text-[14px]">{pending ? <Spinner /> : null}Log in</button>
      </nav>
    </header>
  );
}

/** Footer for the public pages and the app shell. */
export function SiteFooter({ inApp = false }: { inApp?: boolean }) {
  const s = useSession();
  // Public pages show the mobile tab bar when signed in; keep the footer clear of it (the app shell pads itself).
  const tabBarSpace = !inApp && s.ready && s.authenticated;
  return (
    <>
    <footer className="mt-16 flex flex-col gap-3 border-t border-line pt-6 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
      <p>Sandbox cards · Solana devnet USDC. No real money, no real merchants.</p>
      <nav aria-label="Footer" className="-mx-2 flex flex-wrap items-center">
        <Link href="/status" className="inline-flex min-h-9 items-center px-2 hover:text-ink">System status</Link>
      </nav>
    </footer>
    {tabBarSpace && <div className="h-20 sm:hidden" aria-hidden="true" />}
    </>
  );
}
