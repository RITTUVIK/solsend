"use client";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { api } from "@solsend/shared";
import type { z } from "zod";
import { client } from "@/client/api";
import { DATA_POLL_MS } from "@/client/config";
import { usePoll, type Polled } from "@/client/hooks";
import type { CardView } from "@/client/format";
import { useSignNotice } from "@/client/notice";
import { useSession } from "@/client/session";
import { Icon, MockBadge, Skeleton, Spinner } from "./ui";

type Wallet = z.infer<typeof api.WalletResponse>;
interface AppData { wallet: Polled<Wallet>; cards: Polled<CardView[]> }
const Ctx = createContext<AppData | null>(null);
export const useAppData = (): AppData => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAppData outside <AppShell>");
  return c;
};

const NAV = [
  { href: "/home", label: "Wallet", icon: "home" },
  { href: "/merchant", label: "Demo store", icon: "store" },
  { href: "/activity", label: "Activity", icon: "pulse" },
] as const;

function Data({ children }: { children: ReactNode }) {
  const wallet = usePoll<Wallet>(client.wallet, DATA_POLL_MS);
  const cards = usePoll(client.listCards, DATA_POLL_MS);
  return <Ctx.Provider value={{ wallet, cards }}>{children}</Ctx.Provider>;
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${className}`}>
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white"><Icon name="card" className="h-4 w-4" /></span>
      SolSend
    </span>
  );
}

/** Authenticated frame: header, tab bar, session guard and the shared wallet/cards pollers. */
export function AppShell({ children }: { children: ReactNode }) {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { if (s.ready && !s.authenticated) router.replace("/"); }, [s.ready, s.authenticated, router]);

  const notice = useSignNotice();
  const gated = !s.ready || !s.authenticated || s.walletPending || !s.wallet;
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-28px)] w-full max-w-3xl flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <Link href="/home" className="rounded-lg"><Logo /></Link>
        <nav aria-label="Primary" className="hidden gap-1 sm:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${path === n.href ? "bg-zinc-200 dark:bg-zinc-800" : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"}`}>{n.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <MockBadge />
          {s.authenticated && (
            <button type="button" onClick={() => void s.logout().then(() => router.replace("/"))} className="btn-ghost !min-h-9 !px-3 !py-1 text-xs" title={s.email ?? undefined}>Log out</button>
          )}
        </div>
      </header>
      <main className="flex-1 px-4 pb-28 pt-2 sm:pb-10">
        {gated ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"><Spinner />{s.walletPending ? "Creating your Solana wallet…" : "Loading…"}</p>
            <Skeleton className="h-28" /><Skeleton className="h-44" />
          </div>
        ) : (
          <Data>{children}</Data>
        )}
      </main>
      {notice && (
        <div role="status" data-testid="sign-notice" className="anim-rise fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-xl bg-zinc-900 px-4 py-3 text-center text-sm font-medium text-white shadow-lg sm:bottom-6 dark:bg-zinc-100 dark:text-zinc-900">{notice}</div>
      )}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-950/90">
        <ul className="mx-auto flex max-w-3xl">
          {NAV.map((n) => (
            <li key={n.href} className="flex-1">
              <Link href={n.href} aria-current={path === n.href ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${path === n.href ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500"}`}>
                <Icon name={n.icon} className="h-5 w-5" />{n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
