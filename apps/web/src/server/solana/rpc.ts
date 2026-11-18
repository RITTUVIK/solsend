// Devnet RPC helpers shared by the ASA hot path, reconciler and card routes. Every function takes the
// connection as an argument (injected in tests). Ported from CP0b spikes/src/asa/handler.ts.
import bs58 from "bs58";
import type { AccountInfo, Commitment, Connection, PublicKey, SignatureResult } from "@solana/web3.js";

/** Minimal RPC surface we use — lets unit tests pass a hand-rolled mock instead of a Connection. */
export type Rpc = Pick<Connection,
  "sendRawTransaction" | "getSignatureStatuses" | "onSignature" | "removeSignatureListener" | "getLatestBlockhash" |
  "getAccountInfo" | "getMultipleAccountsInfo">;

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** QuickNode free ("discover") plan: getMultipleAccounts ≤ 5 keys per call (CP0b finding, error -32615). */
export const MULTI_ACCOUNTS_MAX = 5;

/** Batched account reads, chunked to ≤5 per call with light pacing (≤15 req/s on the free plan). */
export async function getAccountsChunked(rpc: Pick<Rpc, "getMultipleAccountsInfo">, keys: PublicKey[], commitment: Commitment = "confirmed", clock: Clock = realClock) {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += MULTI_ACCOUNTS_MAX) {
    if (i > 0) await clock.sleep(80);
    out.push(...(await rpc.getMultipleAccountsInfo(keys.slice(i, i + MULTI_ACCOUNTS_MAX), commitment)));
  }
  return out;
}

export type ConfirmResult = { err: SignatureResult["err"] } | null;

/**
 * Websocket-first confirmation at `confirmed`, with sparse `getSignatureStatuses` polling as fallback
 * (CP0b: polling every 1 s avoids RPC 429s). Resolves `null` if not confirmed by `untilMs` (absolute
 * clock time). Never throws.
 */
export function confirmSignature(rpc: Rpc, signature: string, untilMs: number, clock: Clock = realClock, pollMs = 1000): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    let done = false;
    let subId: number | null = null;
    const finish = (v: ConfirmResult, viaWs = false) => {
      if (done) return;
      done = true;
      // web3.js drops a one-shot signature subscription itself once it fires; only remove it otherwise.
      if (subId !== null && !viaWs) void Promise.resolve(rpc.removeSignatureListener(subId)).catch(() => {});
      resolve(v);
    };
    try {
      subId = rpc.onSignature(signature, (r) => finish({ err: r.err }, true), "confirmed");
    } catch { /* websocket unavailable → polling only */ }
    void (async () => {
      await clock.sleep(Math.min(pollMs, Math.max(0, untilMs - clock.now())));
      while (!done && clock.now() < untilMs) {
        try {
          const st = (await rpc.getSignatureStatuses([signature])).value[0];
          if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) { finish({ err: st.err }); break; }
        } catch { /* transient RPC error: keep trying until the deadline */ }
        await clock.sleep(Math.min(pollMs, Math.max(0, untilMs - clock.now())));
      }
      finish(null);
    })();
  });
}

/** Cached recent blockhash (refreshed when older than `maxAgeMs`; one in-flight fetch at a time). */
export function blockhashCache(rpc: Pick<Rpc, "getLatestBlockhash">, clock: Clock = realClock, maxAgeMs = 15_000) {
  let cached: { value: string; at: number } | null = null;
  let inflight: Promise<string> | null = null;
  const refresh = () => (inflight ??= rpc.getLatestBlockhash("confirmed")
    .then((r) => { cached = { value: r.blockhash, at: clock.now() }; return r.blockhash; })
    .finally(() => { inflight = null; }));
  return {
    async get(): Promise<string> {
      if (cached && clock.now() - cached.at < maxAgeMs) {
        if (clock.now() - cached.at > maxAgeMs / 2) void refresh().catch(() => {}); // warm refresh in the background
        return cached.value;
      }
      return refresh();
    },
    warm: () => { void refresh().catch(() => {}); },
  };
}

/** Send a signed wire tx, then rebroadcast every `everyMs` until `untilMs` or `stop()`. Returns the stopper. */
export function rebroadcast(rpc: Pick<Rpc, "sendRawTransaction">, raw: Uint8Array, untilMs: number, clock: Clock = realClock, everyMs = 800) {
  let stopped = false;
  void (async () => {
    while (!stopped) {
      await clock.sleep(everyMs);
      if (stopped || clock.now() >= untilMs) break;
      try { await rpc.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch { /* best effort */ }
    }
  })();
  return () => { stopped = true; };
}

// ── Token account parsing (SPL Token layout: mint32 owner32 amount8 delegateOpt(4+32) …) ──────────
export type TokenAccountView = { mint: string; owner: string; amount: bigint; delegate: string | null; delegatedAmount: bigint };
export function parseTokenAccount(data: Uint8Array): TokenAccountView | null {
  if (data.length < 165) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pk = (o: number) => bs58.encode(data.subarray(o, o + 32));
  const hasDelegate = dv.getUint32(72, true) === 1;
  return { mint: pk(0), owner: pk(32), amount: dv.getBigUint64(64, true), delegate: hasDelegate ? pk(76) : null, delegatedAmount: dv.getBigUint64(121, true) };
}
