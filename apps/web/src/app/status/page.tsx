"use client";
import Link from "next/link";
import { client } from "@/client/api";
import { usePoll } from "@/client/hooks";
import { Logo } from "@/components/AppShell";
import { ErrorNote, Icon, MockBadge, Skeleton } from "@/components/ui";

export default function StatusPage() {
  const { data, error, loading, refresh } = usePoll(client.status, 10_000);
  return (
    <div className="mx-auto max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="rounded-lg"><Logo className="text-lg" /></Link>
        <MockBadge />
      </header>
      <h1 className="text-2xl font-bold tracking-tight">System status</h1>
      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">Live checks of the pieces behind your cards. Sandbox and devnet only.</p>

      {error && <div className="mt-4"><ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote></div>}
      {loading && !data && <div className="mt-4 space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
      {data && (
        <>
          <div className={`mt-4 flex items-center gap-3 rounded-2xl p-4 ${data.ok ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200"}`} role="status" data-testid="overall">
            <Icon name={data.ok ? "check" : "warn"} className="h-6 w-6" />
            <div><p className="font-semibold">{data.ok ? "All systems operational" : "Some checks are failing"}</p><p className="text-xs opacity-80">Checked {new Date(data.checkedAt).toLocaleTimeString()}</p></div>
          </div>
          <ul className="mt-3 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Health checks">
            {data.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 p-3" data-testid="check">
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white ${c.ok ? "bg-emerald-600" : "bg-rose-600"}`}><Icon name={c.ok ? "check" : "x"} className="h-3.5 w-3.5" /></span>
                <div className="min-w-0"><p className="font-medium">{c.name} <span className="sr-only">{c.ok ? "is healthy" : "has a problem"}</span></p><p className="break-words text-sm text-zinc-600 dark:text-zinc-400">{c.detail}</p></div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-6 text-xs text-zinc-500">Sandbox cards · Solana devnet USDC. Nothing here involves real money or real merchants.</p>
    </div>
  );
}
