// Production wiring of the injectable server modules (one set per warm instance).
import "server-only";
import { z } from "zod";
import { env } from "./env";
import { connection, feePayerKey, settlementAuthority } from "./keys";
import { getStore } from "./store";
import { LithicClient } from "./lithic/client";
import { blockhashCache, getAccountsChunked, realClock } from "./solana/rpc";
import { gpaDelegations, type CardDeps } from "./cards/service";
import { createAsaEngine, DEFAULT_SETTLE_CU_LIMIT } from "./asa/engine";
import { outageFlag } from "./asa/outage";
import type { AfterDeps } from "./asa/after";

/** W2-local tunables (kept out of the lead-owned env.ts). */
const Extra = z.object({
  SETTLE_CU_LIMIT: z.coerce.number().int().min(20_000).max(1_400_000).default(DEFAULT_SETTLE_CU_LIMIT),
  CARD_CREATE_DAILY_MAX: z.coerce.number().int().min(1).max(100).default(10),
});
export const extraEnv = () => Extra.parse({ SETTLE_CU_LIMIT: process.env.SETTLE_CU_LIMIT || undefined, CARD_CREATE_DAILY_MAX: process.env.CARD_CREATE_DAILY_MAX || undefined });

let lithicClient: LithicClient | null = null;
export const lithic = () => (lithicClient ??= new LithicClient(env().LITHIC_API_KEY));

let bh: ReturnType<typeof blockhashCache> | null = null;
export const blockhash = () => (bh ??= blockhashCache(connection(), realClock));

let outage: ReturnType<typeof outageFlag> | null = null;
// Resolve the store lazily INSIDE the flag's try/catch: a missing/unreachable DB must read as "no outage", never break
// the hot path (found in the hosted test: getStore() threw before the try → every swipe declined).
export const outageCache = () => (outage ??= outageFlag({ getSetting: (k) => getStore().getSetting(k) }));

let engine: ReturnType<typeof createAsaEngine> | null = null;
export function asaEngine() {
  if (engine) return engine;
  const e = env();
  engine = createAsaEngine({
    rpc: connection(), settler: settlementAuthority(), secret: e.LITHIC_ASA_SECRET, budgetMs: e.ASA_BUDGET_MS,
    cuLimit: extraEnv().SETTLE_CU_LIMIT, clock: realClock, blockhash: () => blockhash().get(), outage: () => outageCache().get(),
  });
  blockhash().warm();
  return engine;
}

export function reconcileDeps(): AfterDeps {
  return { rpc: connection(), settler: settlementAuthority(), store: getStore(), lithic: lithic(), clock: realClock, blockhash: () => blockhash().get() };
}

export const feePayer = () => feePayerKey();

export function cardDeps(): CardDeps {
  return { rpc: connection(), store: getStore(), feePayer: feePayerKey(), lithic: lithic(), clock: realClock };
}

/** gPA-based discovery of the owner's SolSend delegations (falls back to the DB list if the RPC refuses gPA). */
export const delegationDiscovery = () => {
  const conn = connection();
  return gpaDelegations(conn as never, async (keys) => (await getAccountsChunked(conn, keys)).map((a) => a?.owner ?? null));
};
