# W2 backend evidence (CP1): ASA hot path, reconciler, cards, ops

Wed 2026-11-18, about 05:25–05:45 UTC. Solana **devnet** (QuickNode devnet RPC, endpoint redacted) and Lithic **SANDBOX** only.
Program `GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp` (W1 deploy, config + treasury initialized). Server = `next dev`
on this branch, exposed through the ngrok free static domain for the real-Lithic tests. Store = local MemoryStore,
because Supabase credentials were not yet available.

Labels: **MOCK** = a locally generated, Lithic-shaped request signed with our own HMAC using the real ASA secret
(Lithic not involved). **REAL** = Lithic sandbox `simulate/*` → Lithic → our endpoint. Every settle and refund
below is a real devnet transaction.

## Measured compute

| Tx | CU consumed | Limit we set |
|---|---|---|
| settle (fixed delegation, Allowances CPI + SettlementRecord init), sig `2kPLyG75…` | 41,830 | **70,000** (`DEFAULT_SETTLE_CU_LIMIT`; W1 measured ≈43.4k) |
| create delegation + register_card (fee-payer sponsored), sig `3ZM5riNZ…` | 26,223 | 80,000 |
| refund, sig `5hCQmHYV…` | 23,190 | 60,000 |

## Devnet test cards (created through OUR prepare → owner-sign → submit path; owner = card-a-owner)

| Card PDA | Kind / limit | Register signature | Lithic |
|---|---|---|---|
| `95DNMNFHr4w35kjTMxa5bAeCKvDCc93A1gH1dC9fFUyV` (cardId 17459595915066145309) | STORE_LOCKED $5.00 | [`3ZM5riNZ…`](https://explorer.solana.com/tx/3ZM5riNZQjUPq4oGtXAuQdd8DENmn2y838niCrdTZW9PHEapa9mfpNzRJ8j6wGpdrm2DUSCtaSFMtcm3d4DcNcsD?cluster=devnet) | none (MOCK card) |
| `BBN1wkPm7CABuUCvKXHq33Tr3dgE57EhqRPMb1RgCWW2` (cardId 5747011140332889643) | STORE_LOCKED $2.00 | [`7U5FSHwe…`](https://explorer.solana.com/tx/7U5FSHwefpEwPJXDY26rRTq54feESEzfZphzo5t2eiRbCpkzGrbvvaFTvXYbAd8zQMhYaxZjGzGcnWwHinEN4YV?cluster=devnet) | `6d98f3d0-790e-4d7e-a196-41badb434e7d` (VIRTUAL, spend_limit 400 = 2× FOREVER, tags, last four 4450) |

## MOCK latency: local `next dev` → QuickNode devnet (Lithic not involved)

`scripts/ops/asa-latency.ts`, n = 20, pace 1.5 s, 1 cent each, card `95DNMNFH…`.

| | ms |
|---|---|
| cold (first request on the warmed route) | 1,325 |
| warm p50 / p95 / p99 | **870 / 989 / 989** |
| all p50 / p95 / p99 / max / min | 870 / 989 / 1,325 / 1,325 / 689 |

- Decisions: **20/20 APPROVED**. Each one replied only after `confirmed`.
- Onchain check: 20 SettlementRecords found, each 10,000 base units.
- A fully cold `next dev` route compile adds about 3 s. This is a dev-server artifact, not on Vercel.

## MOCK scenario matrix (real devnet txs; no Lithic calls)

| Scenario | Reply | Onchain evidence |
|---|---|---|
| over cap ($6.00 vs $4.79 left) | `INSUFFICIENT_FUNDS` card_limit_exceeded | `3FzBML6R…` failed `Custom 300` (Allowances), no USDC moved |
| merchant mismatch (other acceptor after lock) | `UNAUTHORIZED_MERCHANT` | `2qs4Wsxz…` failed `6005 MerchantMismatch` |
| issuer outage ON | `CARD_PAUSED` in 31 ms | no tx sent |
| same token ×2 concurrently (×2 pairs) | APPROVED/APPROVED | 1 settle per token (in-flight dedupe), 2 records |
| replay of an approved token after the in-flight window | `APPROVED` duplicate_already_settled | 2nd tx `46gNLCyR…` failed `Custom 0` (already in use) |
| same token, different amount (incremental) | `SUSPECTED_FRAUD` duplicate_amount_mismatch | `2mNEq56e…` failed `Custom 0`, no pull |
| deadline 500 ms (fail-closed) | `INSUFFICIENT_FUNDS` deadline_exceeded / no_confirmation | settle `4eoX5Lhw…` landed **late** → sweep refunded it: `4yEuUtMy…` |

**Bug found and fixed (invariant 4).** With a 500 ms budget, one request hit the deadline *before* its settle was
sent (cold blockhash fetch). The abandoned work still sent the tx afterwards. The decision said "no settle", so
no watcher would refund it. That token (`d73efc12…`) settled 0.01 onchain.

- **Fix:** the deadline sets `ctx.closed` synchronously, and the work checks it, with no await, right before sending.
- **Regression test:** "deadline fires BEFORE the send … NOTHING is sent afterwards".
- **The orphaned settles were refunded** through the new `/api/reconcile {items}` recovery: `5hCQmHYV…`, `3eaF9TpD…`, `29fd6ueU…`.
  - `5hCQmHYV…` moved −0.01 from the treasury ATA and +0.01 to the owner's ATA.

## REAL Lithic sandbox: through ngrok to local next dev (5 simulated authorizations + 1 void)

Card `6d98f3d0-790e-4d7e-a196-41badb434e7d` → devnet `BBN1wkPm…`. Final Lithic state was read back with `GET /v1/transactions/{t}`.

| # | Lithic transaction | Ours | Lithic final | Devnet |
|---|---|---|---|---|
| 1 approve $1.14 | `fda75cf6-0f2d-4e97-aeea-123a1c40ef57` | `APPROVED` settled_confirmed, engine 973 ms (simulate call round trip 2,120 ms) | AUTHORIZATION APPROVED 114 | settle [`mpNVfy1d…`](https://explorer.solana.com/tx/mpNVfy1d7HrFrtbdmteWJU5bH8yMnJqMkZetxL8GXj4isGKSjgWSXvARsWyvZMLrZJ2gQQZKVQdD1DNB2vdgbM6?cluster=devnet) |
| 2 over cap $1.50 (0.86 left) | `00c95d3f-80df-417e-b567-f12eda214b4c` | `INSUFFICIENT_FUNDS` card_limit_exceeded | DECLINED / INSUFFICIENT_FUNDS | failed `2bi2w7qh…` (Allowances 300) |
| 3 merchant mismatch $0.10 | `073d5381-1778-4162-b0e5-292a70c41fbf` | `UNAUTHORIZED_MERCHANT` | DECLINED / UNAUTHORIZED_MERCHANT | failed `2YQWzGzj…` (6005) |
| 4 duplicate: byte-identical replay of Lithic's signed request for #1 | — | at 44 s: in-flight dedupe APPROVED (no tx). At 70 s: `APPROVED` duplicate_already_settled. Tampered copy → **401** | — | 2nd tx [`DDvbRSWv…`](https://explorer.solana.com/tx/DDvbRSWvqMdmegk3Ldkku9G7Bsr5Fb5HBFm9XDrvkrjGXEKqSSMP5MoDKM9sFi3sLjwGtyVAGbckpgUqE4hbRHT?cluster=devnet) failed `Custom 0`, no second pull |
| 5 void #1 | `fda75cf6…` | events webhook `card_transaction.updated` VOIDED (HMAC with the subscription secret) → reconciler refund | **VOIDED**, `result` still **APPROVED**, events AUTHORIZATION +114 / AUTHORIZATION_REVERSAL −114 | refund [`3VcgHykb…`](https://explorer.solana.com/tx/3VcgHykbqzgqj5pdZuneNFrmdbrhSsd652TFVyYbFYAE2JFmg2RYy2gSwzwWkTefPL9xrDhXNe9yMr2jMwB7SK2x?cluster=devnet). Record `HxqYwCML…`: amount 1.14, refunded 1.14 |
| 6 issuer outage $0.20 | `ecd508a3-48bb-46a3-8ea8-e0ea5ef74eb9` | `CARD_PAUSED` in 37 ms | DECLINED / CARD_PAUSED | no tx |

The SettlementRecord for #1 has exactly three txs: one settle, one failed duplicate, one refund.

Other findings from real traffic:

- **Lithic `simulate/authorize` requires `merchant_acceptor_id` ≤ 15 chars.** The first attempt was rejected
  (HTTP 400) and nothing was authorized. The shared `DEMO_MERCHANTS` ids (`SOLSENDDEMOTEMU01` …) are 17 chars, so they must be shortened (see REQUESTS).
- **The events body is the transaction resource, with a top-level `event_type`** (no `payload` wrapper). HMAC is
  the same Svix scheme as ASA, keyed with the base64-decoded subscription `whsec_`. Verified on 6 real deliveries.
- **`GET /v1/transactions/{t}` can return 404 for a few seconds** after the ASA request for a real transaction. The
  rule's NOT_FOUND grace (30 s) held, and the DECLINED event then reconciled the row.
- **Lithic `detailed_results` echoes our ASA result code** (e.g. `UNAUTHORIZED_MERCHANT`, `CARD_PAUSED`).
- Account-level `daily_spend_limit=50000` was **accepted** (account `dddc4d45…` now reports spend_limit daily 50000 / monthly 200000).
- **The modern embed flow works in sandbox:**
  - `POST /v1/cards/{t}/embed {type: CARD_EMBED, target_origin: http://localhost:3000, expiration}` → `session`;
  - iframes are `https://sandbox.lithic.com/v1/embed?session=…&type=PAN|CVV|EXP_MONTH|EXP_YEAR`;
  - the iframe was not fetched (it renders the PAN).

Lithic state after the tests:

- The ASA endpoint is **disenrolled**, as it was before the tests.
- The event subscription `ep_3MGc1edho9mBIK1IIrc8luiCTd9` (`card_transaction.updated`) still points at the
  (stopped) ngrok URL. Its secret is in `apps/web/.env.local` and `spikes/.env` (mode 600) as `LITHIC_EVENTS_SECRET`.
- Repoint both with `scripts/ops/lithic-setup.ts --url https://solsend-ashen.vercel.app`.

## Unit tests (vitest, injected mock RPC; `pnpm --filter @solsend/web test`)

62 tests across 6 files:

- HMAC accept / tamper / bad / stale / missing;
- confirmed-before-approve (confirm time ≤ reply time; tx = ComputeBudget + settle, no memo, v1 commitments);
- deadline → decline, plus the no-send-after-deadline regression;
- never-throw;
- rebroadcast of identical bytes;
- the full error-mapping table;
- the duplicate rule (exact amount / mismatch / unreadable record / concurrent);
- the status / currency / card-state / outage / $0 gates;
- the reconciler rule matrix;
- the refund executor (feed row carries `lithic_token`);
- the after-hook (no downgrade of APPROVED, late-settle refund);
- events intake (HMAC, webhook-id dedupe, outer-limit decline row);
- the piggyback gate and missing-row recovery;
- the intent byte-identity / owner-signature / expiry / atomic-consume gate;
- the card recovery state machine (≤ 5 keys per `getMultipleAccounts`);
- the Lithic card config.

## Backend audit fix batch (2026-11-18, after merging feat/solsend-mvp @ fdaa8a8)

The regression tests ported from the independent audit live in `apps/web/src/server/__test__/audit.regression.test.ts`.
7 of them failed on the pre-fix code; all pass now. Full suite: 107 passed, 1 skipped (the live Supabase test, opt-in).

- **H1.** An in-flight hit must match the request fingerprint: status, amount, currency, card token and state, and
  merchant identity. Otherwise it declines `inflight_mismatch`; it never inherits a cached APPROVED.
- **M1.** A duplicate approves only an exact, **unrefunded** record. Otherwise `duplicate_amount_mismatch` / `duplicate_refunded`.
- **M2/M3. Reconcile failures take a retry path:**
  - `reconcile_action` NULL, `reconcile_attempts` + 1, `next_attempt_at` = min(2^(n−1) × 15 s, 30 min), and a `last_error`.
  - After 8 attempts the row is tagged `anomaly_refund_failing`, which /api/status counts.
  - The sweep is due-ordered (`coalesce(next_attempt_at, created_at)`), and wait outcomes are re-checked later instead of blocking the queue head.
  - The events path still processes `approved_pending_settlement` rows and falls back to the retry path.
  - The refund tx restores a closed owner USDC ATA (`createAssociatedTokenAccountIdempotent`, paid by the fee payer), only when the destination equals `usdcAta(owner)`.
  - Migration: `supabase/migrations/0003_reconcile_backoff.sql`, **not applied**. Until it is, the SupabaseStore falls back to pre-0003 behavior (oldest-first sweep; backoff columns dropped from writes).
- **M4.**
  - Demo minimum is 100 cents.
  - Limits: 30/day + 10/min per wallet, 120/h + 60/min globally.
  - Below 0.03 SOL on the settlement authority (30 s cached balance), checkout returns 503 `demo_paused_low_sol`.
  - /api/status shows a "settler SOL runway" line.
- **M5.**
  - /api/status is computed at most once per 30 s and sent with `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`.
  - Per-wallet limits (fail closed → 429): GET /api/cards and /api/wallet at 30/min, /api/feed at 120/min.
- **L1.** The reconciler, events path and after-hook write only the changed fields.
- **L2.** A webhook-id replay guard (10 min, 5k-entry LRU) declines `replay`; `lithic_asa` receipts are recorded in the after-hook.
- **L3.** Global caps: wallet setup 200/day, faucet 150/day. tx/submit is limited to 30/h per wallet.
- **Info.**
  - jwtVerify pins `algorithms: ["ES256"]` and `requiredClaims: ["exp"]`.
  - /api/reconcile returns 400 on a bad body.
  - errorResponse logs only `safeErr` text.
  - `import "server-only"` is in the engine, reconcile, cards/service, demo, qn and status modules.
