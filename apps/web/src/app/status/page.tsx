"use client";
import { client } from "@/client/api";
import { usePoll } from "@/client/hooks";
import { PublicHeader, SiteFooter } from "@/components/PublicChrome";
import { ErrorNote, Icon, Skeleton } from "@/components/ui";

const SPONSOR: Record<string, string> = { "QuickNode Stream": "QuickNode", "Lithic sandbox": "Lithic", "Solana devnet RPC": "Solana", "quicknode last delivery": "QuickNode Stream" };
const warnings = (checks: { warn?: boolean }[]) => { const n = checks.filter((c) => c.warn).length; return n ? ` · ${n} warning${n > 1 ? "s" : ""}` : ""; };

export default function StatusPage() {
  const { data, error, loading, refresh } = usePoll(client.status, 10_000);
  return (
    <div className="mx-auto max-w-2xl px-4 pb-10">
      <PublicHeader current="status" />
      <h1 className="text-[28px] font-semibold tracking-[-0.03em]">System status</h1>
      <p className="mt-1 text-[15px] text-ink-2">Live checks of the pieces behind your cards. Sandbox and devnet only.</p>

      {error && <div className="mt-4"><ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote></div>}
      {loading && !data && <div className="mt-5 space-y-2"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>}
      {data && (
        <>
          <div className={`mt-5 flex items-center gap-3 rounded-[20px] p-4 ${data.ok ? "bg-ok-bg" : "bg-no-bg"}`} role="status" data-testid="overall">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${data.ok ? "bg-ok text-white dark:text-[#04130d]" : "bg-no text-paper"}`}><Icon name={data.ok ? "check" : "warn"} className="h-5 w-5" strokeWidth={2.6} /></span>
            <div><p className="text-[17px] font-semibold text-ink">{data.ok ? `All systems operational${warnings(data.checks)}` : "Some checks are failing"}</p><p className="text-[13px] text-ink-2">Checked {new Date(data.checkedAt).toLocaleTimeString()} · refreshes every 10 s</p></div>
          </div>
          <ul className="surface mt-3 divide-y divide-line !p-0" aria-label="Health checks">
            {data.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 px-4 py-3.5" data-testid="check">
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${!c.ok ? "bg-no-bg text-no" : c.warn ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"}`}><Icon name={!c.ok ? "x" : c.warn ? "warn" : "check"} className="h-3.5 w-3.5" strokeWidth={2.8} /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[15px] font-semibold">{c.name}<span className="sr-only">{!c.ok ? " has a problem" : c.warn ? " has a warning" : " is healthy"}</span>
                    {SPONSOR[c.name] && <span className="chip bg-sunken px-2 text-ink-2">{SPONSOR[c.name]}</span>}</p>
                  <p className="break-words text-[14px] text-ink-2">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <SiteFooter />
    </div>
  );
}
