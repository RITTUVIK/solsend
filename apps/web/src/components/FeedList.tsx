"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "@/client/api";
import { FEED_POLL_MS } from "@/client/config";
import { usePoll } from "@/client/hooks";
import { sandboxName, storeName, timeAgo, usd, type FeedRow } from "@/client/format";
import { voidErrorCopy, voidPurchase, type Voided } from "@/client/void";
import { StoreTile } from "./CardVisual";
import { ErrorNote, Icon, ProofField, ProofRow, QuickNodeBadge, Sheet, Skeleton, Spinner } from "./ui";

const VOID_COPY = "Simulates the store cancelling this sandbox order. The USDC returns to your wallet onchain; this card's spending limit stays used.";
const SOURCE: Record<FeedRow["source"], string> = {
  quicknode: "Seen onchain via QuickNode Streams",
  lithic: "Lithic sandbox webhook",
  reconciler: "SolSend reconciler",
  app: "SolSend app",
};

/** One display item: a purchase folds its approval + onchain settlement + refund into a single row. */
interface Item {
  id: string; kind: "purchase" | FeedRow["kind"]; at: string; row: FeedRow;
  settled?: FeedRow; refunded?: FeedRow; approved?: FeedRow;
}

function buildItems(rows: FeedRow[]): Item[] {
  const byToken = new Map<string, { approved?: FeedRow; settled?: FeedRow; refunded?: FeedRow }>();
  for (const r of rows) {
    if (!r.lithicToken || !["authorization_approved", "settled", "refunded"].includes(r.kind)) continue;
    const g = byToken.get(r.lithicToken) ?? {};
    if (r.kind === "authorization_approved") g.approved ??= r;
    if (r.kind === "settled") g.settled ??= r;
    if (r.kind === "refunded") g.refunded ??= r;
    byToken.set(r.lithicToken, g);
  }
  const out: Item[] = [];
  const used = new Set<string>();
  for (const r of rows) {
    if (used.has(r.id)) continue;
    const g = r.lithicToken ? byToken.get(r.lithicToken) : undefined;
    if (g && (g.approved || g.settled) && ["authorization_approved", "settled", "refunded"].includes(r.kind)) {
      const head = g.approved ?? g.settled!;
      for (const x of [g.approved, g.settled, g.refunded]) if (x) used.add(x.id);
      out.push({ id: head.id, kind: "purchase", at: (g.settled ?? head).at, row: head, approved: g.approved, settled: g.settled, refunded: g.refunded });
      continue;
    }
    used.add(r.id);
    out.push({ id: r.id, kind: r.kind, at: r.at, row: r });
  }
  return out;
}

function useVoid(token: string) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState<Voided | null>(null);
  const inflight = useRef(false); // never allow a double submit
  async function run(): Promise<boolean> {
    if (inflight.current) return false;
    inflight.current = true; setBusy(true); setErr(null);
    try { setV(await voidPurchase(token)); return true; } catch (e) { setErr(voidErrorCopy(e)); return false; } finally { inflight.current = false; setBusy(false); }
  }
  return { busy, err, v, run };
}

function VoidConfirm({ open, onClose, onConfirm, busy, merchant, amount }: { open: boolean; onClose: () => void; onConfirm: () => void; busy: boolean; merchant: string; amount: string }) {
  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose(); }} labelledBy="void-t" dismissible={!busy} testId="void-sheet">
      <div className="space-y-4 pt-1">
        <div className="flex items-center gap-3">
          <StoreTile merchant={merchant} size={44} />
          <div><h3 id="void-t" className="text-[22px] font-semibold tracking-[-0.02em]">Void this purchase?</h3><p className="tnum text-[15px] text-ink-2">{amount} at {sandboxName(storeName(merchant))}</p></div>
        </div>
        <p className="text-[15px] leading-[22px] text-ink-2">{VOID_COPY}</p>
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-primary w-full" onClick={onConfirm} disabled={busy} autoFocus data-testid="void-confirm">{busy ? <><Spinner />Voiding…</> : "Void purchase"}</button>
          <button type="button" className="btn-ghost w-full" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </Sheet>
  );
}

function PurchaseRow({ it, fresh, voidable, onOpen }: { it: Item; fresh: boolean; voidable: boolean; onOpen: () => void }) {
  const token = it.row.lithicToken ?? "";
  const vo = useVoid(token);
  const [sheet, setSheet] = useState(false);
  const merchant = it.row.merchant ?? "";
  const amount = usd(it.row.amountBase);
  const refundSig = vo.v?.refundSignature ?? it.refunded?.signature ?? null;
  const showVoid = voidable && !!it.approved && !it.refunded && !vo.v;
  return (
    <li className={`py-1 ${fresh ? "anim-row-in" : ""}`} data-testid="feed-row" data-kind="purchase" data-refunded={it.refunded ? "true" : "false"}>
      <div className="flex items-center gap-3 rounded-[14px] px-2 py-2.5">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`${sandboxName(storeName(merchant))}, ${amount}, details`}>
          <StoreTile merchant={storeName(merchant)} size={40} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-semibold">{sandboxName(storeName(merchant))}</span>
              <span className={`tnum shrink-0 text-[15px] font-semibold ${it.refunded ? "text-ink-3 line-through" : ""}`}>−{amount}</span>
            </span>
            <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
              {it.settled?.signature && <span className="h-2 w-2 shrink-0 rounded-[2px] bg-onchain" aria-hidden="true" />}
              <span className="truncate">{it.refunded ? `Refunded +${amount} · onchain` : it.settled ? `Settled onchain${it.settled.remainingBase != null ? ` · ${usd(it.settled.remainingBase)} left` : ""}` : "Approved · settling…"}</span>
              <time dateTime={it.at} className="ml-auto shrink-0">{timeAgo(it.at)}</time>
            </span>
          </span>
        </button>
      </div>
      {showVoid && (
        <div className="pb-1 pl-[60px]">
          <button type="button" onClick={() => setSheet(true)} disabled={vo.busy} className="pick !px-3.5 !text-[13px]" data-testid="row-void-btn">{vo.busy ? <><Spinner className="h-3 w-3" />Voiding…</> : "Void (sandbox store)"}</button>
          {vo.err && <p className="mt-1.5 text-[13px] text-no" role="alert">{vo.err}</p>}
        </div>
      )}
      {vo.v && (
        <div className="mb-1 ml-[60px] space-y-2 rounded-[14px] bg-sunken p-3 text-[13px]" role="status" data-testid="row-void-status">
          {refundSig ? (
            <><p className="font-semibold text-ink">Refunded to your wallet</p><ProofRow sig={refundSig} title="Refund on Solana" linkLabel="Refund transaction (devnet)" /></>
          ) : (
            <p className="flex items-start gap-2 text-ink-2"><Spinner className="mt-0.5 h-3.5 w-3.5 shrink-0" />Refund on its way: sandbox voids are asynchronous (usually under a minute)</p>
          )}
        </div>
      )}
      <VoidConfirm open={sheet} onClose={() => setSheet(false)} busy={vo.busy} merchant={storeName(merchant)} amount={amount}
        onConfirm={() => { void vo.run().then(() => setSheet(false)); }} />
    </li>
  );
}

const EVENT: Partial<Record<FeedRow["kind"], { title: (r: FeedRow) => string; icon: string; tone: string }>> = {
  registered: { title: (r) => `${r.merchant ? storeName(r.merchant) + " card" : "Card"} created · up to ${usd(r.amountBase)}`, icon: "card", tone: "bg-onchain-bg text-onchain-ink" },
  authorization_declined: { title: (r) => `Declined at ${sandboxName(storeName(r.merchant))}`, icon: "x", tone: "bg-no-bg text-no" },
  frozen: { title: () => "Card frozen", icon: "snow", tone: "bg-sunken text-ink-2" },
  unfrozen: { title: () => "Card unfrozen", icon: "snow", tone: "bg-sunken text-ink-2" },
  closed: { title: (r) => (r.reason && /revoked/i.test(r.reason) ? "Allowance revoked" : "Card closed"), icon: "lock", tone: "bg-sunken text-ink-2" },
  faucet: { title: (r) => `Received ${usd(r.amountBase)} test USDC`, icon: "drop", tone: "bg-ok-bg text-ok" },
  settled: { title: (r) => `Paid ${sandboxName(storeName(r.merchant))}`, icon: "coin", tone: "bg-ok-bg text-ok" },
  refunded: { title: (r) => `Refund from ${sandboxName(storeName(r.merchant))}`, icon: "refund", tone: "bg-ok-bg text-ok" },
  authorization_approved: { title: (r) => `Approved at ${sandboxName(storeName(r.merchant))}`, icon: "check", tone: "bg-ok-bg text-ok" },
};

function EventRow({ it, fresh, onOpen }: { it: Item; fresh: boolean; onOpen: () => void }) {
  const r = it.row;
  const e = EVENT[r.kind]!;
  const declined = r.kind === "authorization_declined";
  return (
    <li className={`py-1 ${fresh ? "anim-row-in" : ""}`} data-testid="feed-row" data-kind={r.kind}>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left" aria-label={`${e.title(r)}, details`}>
        {declined && r.merchant ? <StoreTile merchant={storeName(r.merchant)} size={40} className="opacity-60 grayscale" /> : <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] ${e.tone}`}><Icon name={e.icon} className="h-5 w-5" /></span>}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{e.title(r)}</span>
            {r.amountBase != null && r.kind !== "registered" && <span className={`tnum shrink-0 text-[15px] font-semibold ${declined ? "text-ink-3 line-through" : r.kind === "faucet" || r.kind === "refunded" ? "text-ok" : ""}`}>{r.kind === "faucet" || r.kind === "refunded" ? "+" : r.kind === "settled" ? "−" : ""}{usd(r.amountBase)}</span>}
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-ink-3">
            {r.signature && <span className="h-2 w-2 shrink-0 rounded-[2px] bg-onchain" aria-hidden="true" />}
            <span className={`truncate ${declined ? "text-no" : ""}`}>{declined ? r.reason ?? "Declined" : r.kind === "faucet" ? "Devnet test money" : r.signature ? "Recorded onchain" : SOURCE[r.source]}</span>
            <time dateTime={r.at} className="ml-auto shrink-0">{timeAgo(r.at)}</time>
          </span>
        </span>
      </button>
    </li>
  );
}

function DetailSheet({ it, onClose }: { it: Item | null; onClose: () => void }) {
  if (!it) return null;
  const r = it.row;
  const purchase = it.kind === "purchase";
  const title = purchase ? `${sandboxName(storeName(r.merchant))}` : EVENT[r.kind]?.title(r) ?? r.kind;
  return (
    <Sheet open onClose={onClose} labelledBy="feed-detail-t" testId="feed-detail">
      <div className="space-y-4 pt-1">
        <div className="flex items-center gap-3">
          {r.merchant ? <StoreTile merchant={storeName(r.merchant)} size={44} /> : null}
          <div className="min-w-0">
            <h3 id="feed-detail-t" className="truncate text-[20px] font-semibold tracking-[-0.02em]">{title}</h3>
            <p className="text-[13px] text-ink-3">{new Date(it.at).toLocaleString()}</p>
          </div>
          {r.amountBase != null && <p className="tnum ml-auto text-[22px] font-semibold">{usd(r.amountBase)}</p>}
        </div>
        {r.reason && <p className="rounded-[14px] bg-sunken p-3 text-[14px] text-ink-2">{r.reason}</p>}
        {purchase && it.settled?.signature && (
          <ProofRow sig={it.settled.signature} title="Settled on Solana" linkLabel="View settlement on Explorer (devnet)" defaultOpen
            details={<>
              {r.lithicToken && <ProofField k="Card network">Lithic sandbox · auth <code className="break-all font-mono text-[12px]">{r.lithicToken}</code></ProofField>}
              {it.settled.remainingBase != null && <ProofField k="Left on card">{usd(it.settled.remainingBase)}</ProofField>}
              <ProofField k="Commitment"><code className="font-mono text-[12px]">sha256(&apos;solsend:auth:v1:&apos; + token)</code>, shown in the CardSettled event. The token itself is not written onchain.</ProofField>
              <ProofField k="Seen by">{SOURCE[it.settled.source]}</ProofField>
            </>} />
        )}
        {purchase && it.refunded?.signature && <ProofRow sig={it.refunded.signature} title="Refund on Solana" linkLabel="Refund transaction (devnet)" />}
        {!purchase && r.signature && <ProofRow sig={r.signature} title={r.kind === "authorization_declined" ? "Rejected onchain" : "Recorded on Solana"} />}
        {!purchase && !r.signature && r.kind === "authorization_declined" && <p className="text-[13px] text-ink-3">No onchain transaction — stopped by the card network before reaching Solana.</p>}
        <div className="flex items-center justify-between gap-2 text-[13px] text-ink-3"><span>{SOURCE[(it.settled ?? r).source]}</span>{(it.settled ?? r).source === "quicknode" && <QuickNodeBadge />}</div>
        <button type="button" className="btn-secondary w-full" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  );
}

/** Live feed: polls GET /api/feed every 1.5 s. Rows that appear after the first load animate in. */
export function FeedList({ cardPda, limit = 50, empty }: { cardPda?: string; limit?: number; empty?: string }) {
  const { data, error, loading, refresh } = usePoll(() => client.feed(cardPda), FEED_POLL_MS);
  const seen = useRef<Set<string> | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const groups = useMemo(() => {
    const byId = new Map<string, FeedRow>();
    for (const r of data ?? []) byId.set(r.id, r);
    const all = [...byId.values()].sort((a, b) => +new Date(b.at) - +new Date(a.at));
    const items = buildItems(all).slice(0, limit);
    const today = new Date().toDateString();
    const g: { label: string; items: Item[] }[] = [];
    for (const it of items) {
      const label = new Date(it.at).toDateString() === today ? "Today" : "Earlier";
      if (g.at(-1)?.label !== label) g.push({ label, items: [] });
      g.at(-1)!.items.push(it);
    }
    return g;
  }, [data, limit]);
  const flat = groups.flatMap((g) => g.items);

  const fresh = new Set<string>();
  if (data) {
    if (seen.current === null) seen.current = new Set(flat.map((r) => r.id));
    else for (const r of flat) if (!seen.current.has(r.id)) fresh.add(r.id);
  }
  useEffect(() => { if (seen.current) for (const r of flat) seen.current.add(r.id); }, [flat]);

  return (
    <section aria-label="Live activity">
      {error && <div className="mb-2"><ErrorNote onRetry={() => void refresh()}>{error}</ErrorNote></div>}
      {loading && !data ? (
        <div className="space-y-2" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-3 px-2 py-2.5"><Skeleton className="h-10 w-10 !rounded-[10px]" /><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
      ) : flat.length === 0 ? (
        <p className="rounded-[16px] border-2 border-dashed border-line p-6 text-center text-[14px] text-ink-3">{empty ?? "Nothing yet. Activity shows up here the moment it happens."}</p>
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            {groups.length > 1 && <h3 className="px-2 pb-1 pt-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">{g.label}</h3>}
            <ul className="divide-y divide-line">
              {g.items.map((it) => it.kind === "purchase"
                ? <PurchaseRow key={it.id} it={it} fresh={fresh.has(it.id)} voidable onOpen={() => setOpen(it)} />
                : <EventRow key={it.id} it={it} fresh={fresh.has(it.id)} onOpen={() => setOpen(it)} />)}
            </ul>
          </div>
        ))
      )}
      <DetailSheet it={open} onClose={() => setOpen(null)} />
    </section>
  );
}

export function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
      <span className="relative flex h-2 w-2"><span className="dot-ping absolute inline-flex h-full w-full rounded-full bg-mint" /><span className="relative inline-flex h-2 w-2 rounded-full bg-mint" /></span>
      Live
    </span>
  );
}
