# Hosted ASA latency and cold start (Vercel Hobby, `iad1`, Fluid compute), 2026-11-18 ~05:50 UTC

**Deployment:** `https://solsend-ashen.vercel.app`. Functions run in `iad1` (project `functionDefaultRegions: ["iad1"]`).
The `yul1` shown in request logs is the edge entry point near the caller in Halifax, not where the function ran.
**RPC:** QuickNode devnet. **Budget:** `ASA_BUDGET_MS=4500` (Lithic hard limit 6000 ms, recommended 3000 ms).

## MOCK: locally signed ASA requests → hosted route → REAL devnet settles (Lithic not involved)
Run with `scripts/ops/asa-latency.ts --n 12 --pace 1500 --cents 1 --verify` against card `B5VNsB4o…` (W1 test card).
The first request was the first one after a fresh deploy, so it hit a cold instance.

| Metric | ms |
|---|---|
| cold first (request → reply, measured from Halifax) | **1838** |
| warm p50 | **837** |
| warm p95 / max | 1741 |
| decisions | 12/12 APPROVED |
| onchain verification | 12/12 SettlementRecords found (`--verify`) |

## REAL Lithic sandbox → hosted ASA (Lithic ASA responder repointed to Vercel by `scripts/ops/lithic-setup.ts`)
Lithic card `6d98f3d0-790e-4d7e-a196-41badb434e7d` → devnet card `BBN1wkPm…` ($2.00 lifetime limit; $1.14 already used by W2's earlier test, which was refunded, and a refund does not restore the limit).

| Lithic token | Amount | Lithic final | Our engine | Devnet |
|---|---|---|---|---|
| `212b0390-75ca-484e-92f5-79e7dc5543b3` | $0.37 | AUTHORIZATION **APPROVED** | `settled_confirmed`, total 1131 ms (cold instance after deploy) | settle `3GLcDzVD…` confirmed before the reply |
| `2c187dea-577f-4bba-bc89-8a1e3e07f459` | $0.52 | AUTHORIZATION **DECLINED** (INSUFFICIENT_FUNDS) | `card_limit_exceeded`, total 768 ms | failed settle [`5SDTPwgC…`](https://explorer.solana.com/tx/5SDTPwgCiCFfSnU3VxnziM8G8NUrPaACXkAQadSqPKna2puLRqXpCybFCH5TNp9gLtSrB3DjJwThXrwbu65UAu9K?cluster=devnet): Allowances cap; $0.49 left |

**Verdict: PASS.** The hosted settle-then-approve path, including a cold start, completes in under 2 s, well within the
4.5 s budget and the 6 s Lithic deadline. No fallback architecture is needed. Confirmation requirements were not weakened.

## Fix found by this test
On Vercel without Supabase, the issuer-outage flag called `getStore()` outside its try/catch, so every swipe declined.
That is fail-closed, but a demo toggle must never block payments. Fixed: `deps.ts` resolves the store lazily inside the
flag's try. Regression test in `server/asa/outage.test.ts`.

**Pending:** a long-idle cold-start sample (after more than 15 min idle), and void → events webhook → refund on the
hosted path. Both need Supabase on Vercel for persistence.
