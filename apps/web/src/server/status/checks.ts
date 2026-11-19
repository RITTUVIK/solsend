// /api/status checks (W4). Public, read-only, secret-free: never includes keys, RPC URLs or tokens, only booleans,
// public addresses' balances and short human details. Each check is isolated so one failure never hides the rest.
import "server-only";
import { api, configPda, DEVNET_GENESIS_HASH, decodeConfig, LITHIC_SANDBOX_BASE, SOLSEND_PROGRAM_ID, treasuryAta } from "@solsend/shared";
import type { PublicKey } from "@solana/web3.js";
import type { Store } from "../store";
import { toFeedRow } from "../feed";
import { streamSummary } from "../../client/stream";

type Check = ReturnType<typeof api.StatusCheck.parse>;
const ago = (ms: number) => (ms < 120_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : ms < 7_200_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
export type RpcLike = {
  getGenesisHash(): Promise<string>;
  getAccountInfo(k: PublicKey): Promise<{ executable: boolean; data: Uint8Array } | null>;
  getBalance(k: PublicKey): Promise<number>;
  getTokenAccountBalance(k: PublicKey): Promise<{ value: { uiAmountString?: string } }>;
};
export type StatusDeps = {
  rpc: RpcLike | null; settler: PublicKey | null; feePayer: PublicKey | null; store: Store | null;
  lithicPing: () => Promise<boolean>; now?: () => number; configError?: string;
};

export const MIN_SETTLER_LAMPORTS = 50_000_000; // 0.05 SOL: settle txs pay fees + record rent
export const MIN_FEEPAYER_LAMPORTS = 100_000_000; // 0.1 SOL: pays card/ATA rent for every new card
export const UNRECONCILED_AFTER_SECS = 120;
/** audit M4: approximate settle cost for the runway line = SettlementRecord rent (97 B + 128 B overhead at 6960
 *  lamports/B) + one 5,000-lamport signature fee. Records are permanent (Upgrade 1), so every settle consumes it. */
export const SETTLE_COST_LAMPORTS = 1_571_000;
export const MIN_RUNWAY_SETTLES = 20;

const sol = (l: number) => (l / 1e9).toFixed(3);
async function run(name: string, fn: () => Promise<{ ok: boolean; detail: string; warn?: boolean }>): Promise<Check> {
  try { return { name, ...(await fn()) }; } catch (e) { return { name, ok: false, detail: `check failed (${e instanceof Error ? e.constructor.name : "error"})` }; }
}

export async function runChecks(d: StatusDeps): Promise<ReturnType<typeof api.StatusResponse.parse>> {
  const now = d.now ?? Date.now;
  const checks: Check[] = [];
  const { rpc, store } = d;
  if (d.configError) checks.push({ name: "config", ok: false, detail: d.configError });

  if (rpc) {
    checks.push(await run("devnet genesis", async () => {
      const g = await rpc.getGenesisHash();
      return { ok: g === DEVNET_GENESIS_HASH, detail: g === DEVNET_GENESIS_HASH ? "RPC is Solana devnet" : "RPC genesis is NOT devnet" };
    }));
    checks.push(await run("program", async () => {
      const prog = await rpc.getAccountInfo(SOLSEND_PROGRAM_ID);
      if (!prog?.executable) return { ok: false, detail: "SolSend program not deployed/executable on this cluster" };
      const cfgAcc = await rpc.getAccountInfo(configPda());
      const cfg = cfgAcc ? decodeConfig(cfgAcc.data) : null;
      if (!cfg) return { ok: false, detail: "program executable, config account missing (run init-config)" };
      return { ok: !cfg.paused, detail: cfg.paused ? "program executable; settles PAUSED by admin" : "program executable; config live, settles enabled" };
    }));
    let settlerLamports: number | null = null;
    for (const [name, key, min] of [["settler SOL", d.settler, MIN_SETTLER_LAMPORTS], ["fee payer SOL", d.feePayer, MIN_FEEPAYER_LAMPORTS]] as const) {
      checks.push(await run(name, async () => {
        if (!key) return { ok: false, detail: "key not configured" };
        const l = await rpc.getBalance(key);
        if (name === "settler SOL") settlerLamports = l;
        return { ok: l >= min, detail: `${sol(l)} SOL (min ${sol(min)})` };
      }));
    }
    checks.push(await run("settler SOL runway", async () => {
      if (settlerLamports === null) return { ok: false, detail: "settler balance unavailable" };
      const n = Math.floor(settlerLamports / SETTLE_COST_LAMPORTS);
      return { ok: n >= MIN_RUNWAY_SETTLES, detail: `~${n} settles left at ~${sol(SETTLE_COST_LAMPORTS)} SOL each (record rent + fee); demo checkout pauses below 0.030 SOL` };
    }));
    checks.push(await run("treasury USDC", async () => {
      try {
        const b = await rpc.getTokenAccountBalance(treasuryAta());
        return { ok: true, detail: `${b.value.uiAmountString ?? "0"} devnet USDC in treasury ATA` };
      } catch { return { ok: false, detail: "treasury ATA not found (deploy/init-config creates it)" }; }
    }));
  }

  checks.push(await run("lithic sandbox", async () => {
    const ok = await d.lithicPing();
    return { ok, detail: ok ? "sandbox API reachable" : "sandbox API unreachable" };
  }));

  if (store) {
    checks.push(await run("store", async () => {
      await store.getSetting("issuer_outage");
      return { ok: true, detail: `${store.kind} reachable` };
    }));
    checks.push(await run("quicknode last delivery", async () => {
      // Same rule as the Activity header: is the NEWEST onchain event backed by a recorded Stream delivery? A paused or
      // failing stream is a warning (payments never depend on it), never a silent "ok".
      const s = streamSummary((await store.listFeed({ limit: 100 })).map(toFeedRow).filter((r) => r !== null), now());
      const last = s.lastDeliveryAt ? `last delivery ${ago(now() - Date.parse(s.lastDeliveryAt))} ago` : "no delivery recorded";
      if (s.state === "delivered") return { ok: true, detail: `delivering: the newest onchain event was streamed; ${last}` };
      if (s.state === "none") return { ok: true, detail: `no onchain events yet; ${last}` };
      if (s.state === "pending") return { ok: true, detail: `waiting for the Stream to deliver the newest onchain event; ${last}` };
      return { ok: true, warn: true, detail: `NOT DELIVERING: the newest onchain event (${ago(now() - Date.parse(s.newestEventAt!))} ago) was not streamed; ${last}. The stream is paused outside demo windows, or failing` };
    }));
    checks.push(await run("refunds failing", async () => {
      const n = await store.countAuthorizations({ reconcileAction: "anomaly_refund_failing" });
      return { ok: n === 0, detail: n === 0 ? "no refund stuck after 8 attempts" : `${n} authorization(s) tagged anomaly_refund_failing (manual action needed)` };
    }));
    checks.push(await run("unreconciled authorizations", async () => {
      const n = (await store.listUnreconciled(UNRECONCILED_AFTER_SECS, 100)).length;
      return { ok: n === 0, detail: n === 0 ? "none older than 2 min" : `${n}${n >= 100 ? "+" : ""} older than 2 min (reconciler lagging?)` };
    }));
  } else checks.push({ name: "store", ok: false, detail: "store unavailable" });

  return { ok: checks.every((c) => c.ok), checkedAt: new Date(now()).toISOString(), checks };
}

let lithicCache: { at: number; ok: boolean } | null = null;
/** Reachability of the sandbox API, cached 60 s (never more than ~1 sandbox call/min). */
export async function lithicPing(apiKey: string | undefined, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<boolean> {
  if (lithicCache && nowMs - lithicCache.at < 60_000) return lithicCache.ok;
  let ok = false;
  try {
    const res = await fetchImpl(`${LITHIC_SANDBOX_BASE}/v1/status`, { headers: apiKey ? { Authorization: apiKey } : {}, signal: AbortSignal.timeout(3000) });
    ok = res.status < 500;
  } catch { ok = false; }
  lithicCache = { at: nowMs, ok };
  return ok;
}
export const __resetLithicCache = () => { lithicCache = null; };

/** audit M5: the public /api/status result is computed at most once per 30 s per instance (concurrent callers share
 *  one computation); the route also sets CDN cache headers so floods are absorbed before reaching us. */
export const STATUS_CACHE_MS = 30_000;
export const STATUS_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=60";
type StatusBody = Awaited<ReturnType<typeof runChecks>>;
export function statusCache(compute: () => Promise<StatusBody>, now: () => number = Date.now) {
  let cached: { at: number; body: StatusBody } | null = null;
  let inflight: Promise<StatusBody> | null = null;
  return async (): Promise<StatusBody> => {
    if (cached && now() - cached.at < STATUS_CACHE_MS) return cached.body;
    return (inflight ??= compute().then((body) => { cached = { at: now(), body }; return body; }).finally(() => { inflight = null; }));
  };
}
