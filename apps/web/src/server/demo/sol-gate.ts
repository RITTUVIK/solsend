// audit M4: settlement-authority SOL gate for the Demo Merchant. Balance cached 30 s per instance (one RPC call per
// 30 s at most). Failures are not cached; the caller treats an unknown balance as "paused" (fail closed).
import "server-only";

export const SOL_GATE_TTL_MS = 30_000;

export function solGate(read: () => Promise<number>, now: () => number = Date.now) {
  let cache: { at: number; lamports: number } | null = null;
  let inflight: Promise<number | null> | null = null;
  return async (): Promise<number | null> => {
    if (cache && now() - cache.at < SOL_GATE_TTL_MS) return cache.lamports;
    return (inflight ??= read()
      .then((lamports) => { cache = { at: now(), lamports }; return lamports; })
      .catch(() => null)
      .finally(() => { inflight = null; }));
  };
}

let gate: ReturnType<typeof solGate> | null = null;
/** Production gate: getBalance(settlement authority) via the shared devnet connection. */
export const settlerLamportsCached = async (): Promise<number | null> => {
  if (!gate) {
    const { connection, settlementAuthority } = await import("../keys");
    gate = solGate(() => connection().getBalance(settlementAuthority().publicKey, "confirmed"));
  }
  return gate();
};
