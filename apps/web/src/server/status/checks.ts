// /api/status checks (W4). Public, read-only, secret-free: never includes keys, RPC URLs or tokens, only booleans,
// public addresses' balances and short human details. Each check is isolated so one failure never hides the rest.
import { api, configPda, DEVNET_GENESIS_HASH, decodeConfig, LITHIC_SANDBOX_BASE, SOLSEND_PROGRAM_ID, treasuryAta } from "@solsend/shared";
import type { PublicKey } from "@solana/web3.js";
import type { Store } from "../store";

type Check = ReturnType<typeof api.StatusCheck.parse>;
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

const sol = (l: number) => (l / 1e9).toFixed(3);
async function run(name: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<Check> {
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
    for (const [name, key, min] of [["settler SOL", d.settler, MIN_SETTLER_LAMPORTS], ["fee payer SOL", d.feePayer, MIN_FEEPAYER_LAMPORTS]] as const) {
      checks.push(await run(name, async () => {
        if (!key) return { ok: false, detail: "key not configured" };
        const l = await rpc.getBalance(key);
        return { ok: l >= min, detail: `${sol(l)} SOL (min ${sol(min)})` };
      }));
    }
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
      const rows = await store.listFeed({ limit: 100 });
      const last = rows.find((r) => r.source === "quicknode");
      if (!last) return { ok: true, detail: "no deliveries yet (stream is kept paused outside demo windows)" };
      const age = Math.max(0, Math.round((now() - Date.parse(last.at)) / 1000));
      return { ok: true, detail: `last quicknode feed row ${age}s ago` };
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
