# CP1 contracts: architecture, flows, ownership

> Historical. This is the working agreement used while the MVP was built on 17 and 18 November 2026. The current architecture is in [ARCHITECTURE.md](ARCHITECTURE.md).

Frozen interfaces are listed below. Changing one requires coordinator (lead) approval. Request it in
your final report rather than editing a file you don't own.

| Contract | File |
|---|---|
| Program interface: accounts, instructions, args, account order, events, errors | `programs/solsend/src/lib.rs` (+ generated `packages/shared/idl/solsend.json`) |
| TS builders, PDAs, decoders, schemas | `packages/shared/src/*` (`api.ts` = HTTP API, `lithic.ts`, `db.ts`, `events.ts`) |
| Database | `supabase/migrations/0001_init.sql` |
| Environment | `.env.example` |
| Trust model + invariants | `docs/TRUST.md` |

## Stack
- Anchor 1.2.2 / Solana CLI 4.1.2 / Rust 1.95.0. LiteSVM tests against the **real devnet Allowances
  binary**, dumped by `spikes/allowances_spike/scripts/fetch-vendor.sh`.
- pnpm workspace. `apps/web` = Next.js 15.5 App Router + React 19 + Tailwind 4, deployed to Vercel
  Hobby `iad1`. UI and API routes live in one deploy.
- `@solana/web3.js` 1.99, `@privy-io/react-auth` 3.51, `@supabase/supabase-js` 2.118, `zod` 4.
  Install only versions at least 14 days old (`minimumReleaseAge`).
- Devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Lithic **sandbox** only.

## Amendments: security review (approved by lead, 2026-11-18)
These supersede the flows below where they conflict.
- **A1.** Settle transactions carry **no memo**, so the Lithic token is never onchain.
  - `auth_hash = authCommitment(token) = sha256("solsend:auth:v1:"+token)`.
  - `merchant_hash = merchantCommitment(acceptor_id||descriptor) = sha256("solsend:merchant:v1:"+id)`.
  - Both live in `packages/shared/src/commitments.ts`.
  - The QuickNode feed joins events to authorizations via `store.getAuthorizationByAuthHash`.
  - `QnMatch` has no `memo` field.
- **A2.** `close_settlement_record` is **removed**. SettlementRecords are permanent and act as a lifetime replay guard.
- **A3.** Lithic cards get **outer** circuit-breaker limits from `lithicCardConfig()`: 2× the onchain limit, `SINGLE_USE` for
  one-time cards, never `MERCHANT_LOCKED`. There is also an account daily cap of `LITHIC_ACCOUNT_DAILY_CAP_CENTS` where supported.
- **A4.** The ASA settles only for `ASA_SETTLE_STATUSES` (`AUTHORIZATION`, `FINANCIAL_AUTHORIZATION`) in USD, with card state `OPEN`.
  - A duplicate approves only if `record.amount == amountBase`.
  - Everything else declines.
- **A5.** Supabase: the server prefers `SUPABASE_SECRET_KEY` (`sb_secret_…`), with the legacy `SUPABASE_SERVICE_ROLE_KEY` as fallback.
  Migrations run through `pnpm db:migrate` with `SUPABASE_DB_URL` (local `spikes/.env` only).

## Key flows

### F1 Login + wallet
Privy email login creates an embedded Solana wallet (`solana:devnet`). The client sends the Privy access
token as `Authorization: Bearer`, and the server verifies it with Privy's JWKS (jose).
`POST /api/auth/bind` checks that the wallet signed `BindMessage` (ed25519), then upserts `users`.
Every authenticated route resolves `wallet` from `users`, never from the request body.

### F2 Faucet
`POST /api/wallet/faucet` is rate-limited to 1 per wallet per hour, plus a global cap. It sends
`FAUCET_AMOUNT_BASE` devnet USDC from the demo-faucet wallet, creating the user's ATA idempotently
(the faucet pays). It is labeled "devnet test USDC".

### F3 Create card: recoverable workflow, NOT atomic
1. `POST /api/cards/prepare` does the following:
   - Allocates a random u64 `cardId`. Delegation nonce = cardId.
   - Inserts a `cards` row with `issue_state=onchain_pending`.
   - Builds **one** transaction with fee payer = our fee payer:
     1. ComputeBudget;
     2. `ixInitSubscriptionAuthority(owner, payer)` if the SA is missing, or the ATA's delegate is not the SA (re-arm);
     3. `ixCreateFixedDelegation` (STORE_LOCKED / ONE_TIME, amount = limit, expiry 0) or `ixCreateRecurringDelegation` (SUBSCRIPTION, per period = limit, period = periodDays), both with delegatee = `cardPda(owner, cardId)` and payer = fee payer;
     4. `ixRegisterCard(owner, payer=feePayer, cardId, kind, label)`.
   - Stores a `tx_intents` row (sha256 of the message, 2 min expiry) and returns the unsigned tx.
2. The client signs with Privy `useSignTransaction`. This partial-signs and was verified in G0.8.
3. `POST /api/tx/submit` does the following:
   - Loads the intent and requires the signed message to be byte-identical (sha256).
   - Requires a valid owner signature.
   - Adds the fee-payer signature, sends, and waits for **confirmed**.
   - Marks the intent consumed, then sets `onchain_confirmed` and `register_signature`.
4. The server issues the Lithic card. It does a conditional update `onchain_confirmed → lithic_pending`,
   which works as a lock, then calls `POST /v1/cards`:
   - `lithicCardConfig(kind, limitCents)` gives the type and outer limits (see A3);
   - `memo: "SolSend <label> (sandbox)"`;
   - `tags: {solsend_card, solsend_owner, solsend_card_id}`.
   On success it sets `issued` and `lithic_last_four`. On failure it sets `lithic_failed` with
   `lithic_error`, and the UI offers **Retry** (`POST /api/cards/[cardPda]/retry-issue`).
5. Recovery. `GET /api/cards` reconciles every non-final row against the chain:
   - Card PDA exists → advance to `onchain_confirmed`.
   - Intent expired and no PDA → `failed`.
   - Never show a card as usable unless it is `issued` **and** the onchain card is Active with a live delegation.

### F4 Swipe (ASA hot path): `POST /api/lithic/asa`. This is a port of the proven `spikes/src/asa/handler.ts`.
1. Verify the Lithic HMAC: base64-decoded `whsec_` key over `id.timestamp.body`, with a ±5 min timestamp
   tolerance. Bad signature → 401.
2. Parse `AsaRequestZ`. Map card → Card PDA by `tags`, and require `cardPda(owner, cardId) == tags.solsend_card`.
   A missing mapping → decline `UNAUTHORIZED_MERCHANT` (no settle).
3. Amount 0 (card verification) → `APPROVED` with no settle. Issuer-outage flag on → decline
   `CARD_PAUSED` (cached flag, 5 s TTL; a DB failure is treated as off).
4. Compute `amountBase = cents × 10_000`, `authHash = sha256(token)` and
   `merchantHash = sha256(merchant.acceptor_id || descriptor)`.
5. Build the tx:
   1. ComputeBudget limit (measure; the spike used 90k);
   2. `ixSettle` (no memo; see A1).
   Fee payer + signer = settlement authority. Use a cached blockhash, `skipPreflight`, rebroadcast every
   800 ms, and confirm websocket-first with sparse polling.
6. Reply via `Promise.race` against `ASA_BUDGET_MS`:
   - confirmed success → `APPROVED`;
   - program error → mapped decline (table below);
   - duplicate (`already in use`) → `APPROVED` only if the record is readable at confirmed;
   - anything else, including the deadline → decline. **Never throw.**
7. After the reply (Vercel `waitUntil`):
   - upsert the `authorizations` row and the feed row;
   - if not APPROVED, keep watching the signature for about 30 s, and **refund** if a record exists (late settle);
   - for a ONE_TIME card after a successful settle, close the Lithic card.

| Onchain result | ASA reply |
|---|---|
| Allowances 300 (exceeds fixed cap), SPL Custom 1 (insufficient funds) | `INSUFFICIENT_FUNDS` |
| Allowances 400 (recurring period cap) | `VELOCITY_EXCEEDED` |
| SolSend `CardNotActive`, `Paused`, `CardIdle`; delegation closed (`InvalidAccountOwner` / account missing) | `CARD_PAUSED` |
| SolSend `MerchantMismatch` | `UNAUTHORIZED_MERCHANT` |
| SolSend `PerTxLimitExceeded` | `VELOCITY_EXCEEDED` |
| anything else / unknown | `SUSPECTED_FRAUD` (decline) |

### F5 Void / decline / late settle: the reconciler
- `POST /api/lithic/events` receives Lithic `card_transaction.updated` (HMAC verified; dedupe on `webhook-id`
  via `webhook_receipts`).
- `POST /api/reconcile` (GitHub Actions cron every 10 min, plus manual). GitHub runs scheduled workflows only from the default branch, so the cron starts after the final merge. Until then, piggyback sweeps on `/api/feed` and `/api/cards`, at most once per 60 s, plus the ASA late-settle watcher and the Lithic events webhook cover it sweeps `authorizations` rows with
  `reconcile_action IS NULL`.
- **The rule is driven by Lithic transaction status. `result` is NOT authoritative after a void.**
  - `DECLINED`, `VOIDED` or `EXPIRED`, and a record with `amount > refunded` → `refund(amount − refunded)`.
  - `SETTLED` → done.
  - `PENDING` → leave it.
  - Our decision APPROVED with no onchain record → anomaly (flag in `/status`).
- Refunds never restore the consumed allowance. The UI copy says so.

### F6 Live feed (QuickNode Streams)
- A `programs_with_logs` Stream on the SolSend program (devnet) runs `infra/quicknode/filter.dist.js` (generated from the IDL by `build-filter.ts`), which
  decodes SolSend events into the `QnPayload` contract. The `auth_hash` → Lithic token join happens server-side (A1).
- `POST /api/quicknode` verifies the `x-qn-signature` HMAC and the timestamp, rejects a replayed nonce,
  and upserts into `feed_events` (`source='quicknode'`, idempotent unique index).
- The UI polls `GET /api/feed` about every 1.5 s.
- **The Stream stays paused outside test and demo windows.**

### F7 Demo Merchant (Option B): `POST /api/demo-merchant/checkout`, sandbox only
- Gated by `DEMO_MERCHANT_ENABLED`, an authenticated session, card ownership, an amount ≤
  `DEMO_MERCHANT_MAX_CENTS`, and per-wallet and global rate limits.
- The server reads the sandbox PAN via `GET /v1/cards/{token}` **into memory only** and calls
  `POST /v1/simulate/authorize` with `{pan, amount, descriptor, merchant_acceptor_id, mcc}` from `DEMO_MERCHANTS`.
- It then reads back the Lithic transaction, plus the `authorizations` row written by the ASA path, and
  returns `DemoCheckoutResponse`.
- The PAN is never returned, logged, stored or put into an error message. Every response is labeled `SANDBOX`.
- `POST /api/demo-merchant/void` calls `simulate/void`. The refund arrives through F5.
- **Fallback (Option A).** `scripts/merchant-sim.ts` is a CLI with the same calls, run locally with
  `spikes/.env`. It is never deployed.

### F8 Freeze / close / revoke-all ("issuer outage" beat)
- Card actions return a `PreparedTx` for the owner to sign:
  - `freeze_card` or `unfreeze_card`;
  - `close_card` + Allowances `revokeDelegation`.
- `POST /api/cards/revoke-all` returns one owner-signed tx revoking every live delegation directly in the
  Allowances program (the user's escape hatch), with up to about 12 per tx.

## Ownership (worktrees branch from `feat/solsend-mvp`; edit ONLY your paths)

### W1 Program (Opus, xhigh)
Owns:
- `programs/solsend/**`
- `packages/shared/idl/solsend.json` (regenerate only)
- `scripts/program/**` (deploy, init-config, upgrade)
- `tests/program/**`

### W2 Backend (Opus, high)
Owns:
- `apps/web/src/server/**`, except `server/demo/**`, `server/qn/**` and `server/status/**`
- `apps/web/src/app/api/{auth,wallet,cards,tx,feed,lithic,reconcile,admin}/**`
- `scripts/ops/**`

### W3 Frontend (Sonnet, high)
Owns:
- `apps/web/src/app/**`, except `app/api/**`
- `apps/web/src/components/**`
- `apps/web/src/client/**`
- `apps/web/public/**`
- `apps/web/tests/e2e/**`

### W4 Infra / streams / demo (Sonnet, medium)
Owns:
- `infra/**`
- `supabase/migrations/0002+`
- `.github/**`
- `apps/web/src/server/{demo,qn,status}/**`
- `apps/web/src/app/api/{demo-merchant,quicknode,status}/**`
- `scripts/merchant-sim.ts`
- `apps/web/vercel.json`

### Lead
Owns root config, `packages/shared/src/**`, `docs/**` (except `docs/research/`, which is never committed),
`apps/web/{package.json,next.config.ts,tsconfig.json}`, and the shared server contracts `apps/web/src/server/{env,keys,store,auth}.ts`:
- `store.ts` is the persistence interface: `getStore()` returns Supabase, or `MemoryStore` for local dev only.
- `auth.ts` provides `requireUser(req)`, `verifyBindSignature`, `HttpError` and `errorResponse`.
- W2 may harden their internals without changing the signatures. W4 imports them and must not edit them.

### Shared rules
- **Need a new dependency or a contract change?** Put it in your final report under "REQUESTS". Don't edit
  files you don't own.
- **Secrets** live only in `spikes/.env` (local) or Vercel env. Never print, log or commit them. Keys stay in
  `~/.config/solsend/devnet/`. The pre-commit gitleaks hook must pass. Never use `--no-verify`.
- **Lithic sandbox:** a handful of real requests per test, no load or automated scale testing. Use mock-signed
  local requests for latency or concurrency work, and label them **MOCK**.
- **Devnet only. Zero spend.** No paid features. Check balances before you request faucet funds.
- **Every onchain claim needs a real signature.** Record evidence in `docs/evidence/*.md` or `.jsonl`.
- **Commit only to your worktree branch.** No pushes, PRs, or merges. The lead integrates green work into
  `feat/solsend-mvp`.
