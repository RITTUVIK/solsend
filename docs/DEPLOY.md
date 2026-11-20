# SolSend deploy runbook (Vercel Hobby + Supabase free, devnet + Lithic sandbox)

Zero spend. Everything below is free tier. A human supplies credentials; nothing here is automated signup.

## 1. Supabase (free)
1. Create a project (any region near `iad1`, e.g. us-east).
2. API key: Dashboard -> Settings -> API Keys -> "Publishable and secret API keys" -> create a secret key named `solsend-server`. It is server-only (Supabase rejects secret keys from browsers); never `NEXT_PUBLIC_`. **No publishable/anon key is needed.** `SUPABASE_SERVICE_ROLE_KEY` is only the legacy fallback.
3. Apply the schema, in order (never edit 0001; add new files):
   - SQL editor: paste and run `supabase/migrations/0001_init.sql`, then any `0002_*.sql` and later.
   - or CLI / psql with the **session-pooler** connection string (IPv4) from the Connect dialog, stored as `SUPABASE_DB_URL` in local `spikes/.env` only (never Vercel), then from the repo root: `pnpm db:migrate`.
4. Verify: `npx tsx supabase/verify.mts` (11 checks: tables exist, RLS on, no anon/authenticated privileges, no PUBLIC execute on functions).
5. Copy `SUPABASE_URL` and the secret key (`SUPABASE_SECRET_KEY`).

## 2. Vercel Hobby (free)
Monorepo with pnpm, Next.js app in `apps/web`.
1. Import the GitHub repo. **Root Directory: `apps/web`.** Framework: Next.js (auto).
2. Enable "Include source files outside of the Root Directory" (needed for `packages/shared`).
3. Install command: `pnpm install --frozen-lockfile` (Vercel detects pnpm from `packageManager`). Build: default `next build`. Node 22.
4. `apps/web/vercel.json` pins region `iad1` and function durations (`api/lithic/**` 60 s, `api/reconcile/**` 60 s, `api/demo-merchant/**` 30 s; the ASA handler enforces its own 4.5 s deadline).
5. Environment variables (Production + Preview). Values come from `.env.example`; never commit them:

| Variable | Notes |
|---|---|
| `SOLANA_RPC_URL` | QuickNode **devnet** HTTPS endpoint (tokenized URL = secret). Mainnet is refused. |
| `SOLANA_WS_URL` | optional, derived from the RPC URL |
| `SETTLEMENT_AUTHORITY_SECRET_KEY` | JSON byte array |
| `FEE_PAYER_SECRET_KEY` | JSON byte array |
| `DEMO_FAUCET_SECRET_KEY`, `FAUCET_AMOUNT_BASE` | devnet test USDC faucet wallet; default 5000000 |
| `LITHIC_API_KEY` | **sandbox** key (code refuses any host but `sandbox.lithic.com`) |
| `LITHIC_ASA_SECRET` | `whsec_...` from `GET /v1/auth_stream/secret` |
| `LITHIC_EVENTS_SECRET` | `whsec_...` of the `card_transaction.updated` subscription |
| `ASA_BUDGET_MS` | 4500 |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID` | same Privy app id; add the Vercel domain to Privy allowed origins |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | `sb_secret_...` key; required on Vercel (MemoryStore is refused there). `SUPABASE_SERVICE_ROLE_KEY` = legacy fallback |
| `QN_STREAM_SECURITY_TOKEN` | from `stream.ts create` (section 4); stored in `spikes/.env`, copy the value into Vercel by hand |
| `RECONCILE_CRON_SECRET` | random 32+ chars (also a GitHub secret) |
| `ADMIN_API_TOKEN` | random 32+ chars |
| `DEMO_MERCHANT_ENABLED` | `1` to enable the sandbox Demo Merchant |
| `DEMO_MERCHANT_MAX_CENTS` | 5000 |

6. Deploy. Check `GET https://<app>/api/status`: genesis devnet, program executable, config live, settler / fee payer SOL, treasury ATA, Lithic sandbox, store reachable.

## 3. Point providers at the deployment
- **Lithic ASA:** enroll `POST https://<app>/api/lithic/asa` as the `AUTH_STREAM_ACCESS` responder endpoint (sandbox). Hard limit 6 s; we use 4.5 s.
- **Lithic events:** create an event subscription for `card_transaction.updated` to `https://<app>/api/lithic/events`; its signing secret is `LITHIC_EVENTS_SECRET`.
- **GitHub Actions** repo secrets: `APP_URL` (`https://<app>`), `RECONCILE_CRON_SECRET`. `reconcile.yml` runs every 10 min (and by hand); it skips when the secrets are unset.

## 4. QuickNode Stream (billed per processed block, so keep it PAUSED outside test and demo windows)
All commands run from `scripts/`: `pnpm qn:stream <cmd>`. Needs `QUICKNODE_API_KEY` in `spikes/.env` (parsed in-process; nothing secret is printed).
1. `pnpm qn:build-filter` regenerates `infra/quicknode/filter.dist.js` from `packages/shared/idl/solsend.json` (CI fails on drift). `pnpm qn:selftest` runs it in a sandboxed `vm`.
2. `pnpm qn:stream list`. We run one stream; `pnpm qn:stream delete <id>` any old one first.
3. `pnpm qn:stream create https://<app>/api/quicknode`. Creates `solsend-mvp-devnet` (devnet, `programs_with_logs`) **paused**, with a fresh random token written to `spikes/.env` as `QN_STREAM_SECURITY_TOKEN` (mode 600, never printed). Put the same value into Vercel and redeploy.
4. Changing the URL later: `pnpm qn:stream set-url https://<new>/api/quicknode`.
5. Demo / test window: `pnpm qn:stream activate` (first moves `start_range` to the current slot so the stream does not replay and bill the backlog), do the action, confirm the row in the feed, then `pnpm qn:stream pause`, then `pnpm qn:stream get` must show `paused`.
6. `pnpm qn:stream usage` tries the console REST usage endpoints (the Streams key returned 403 in CP0b and CP1; check credits in the QuickNode dashboard).
7. The webhook must stay reachable while the stream is active; QuickNode pauses a stream after repeated delivery failures.

## 5. Sandbox Demo Merchant fallback (local)
`pnpm merchant-sim list | buy <cardToken> <TEMU|AMAZON|NETFLIX|OTHER_STORE> <cents> | void <txToken>` (from `scripts/`). Reads `spikes/.env`, never prints the PAN. Lithic sandbox policy: a handful of requests, no load tests.

## 6. Pre-demo checklist
- `/api/status` all green; settler and fee payer funded; treasury ATA exists.
- Stream `get` shows `paused` until the recording or judging window; `activate` just before; `pause` right after.
- GitHub Actions `reconcile` last run is green.
- Program LiteSVM tests (`pnpm test:program`) are run locally, not in CI: run `bash scripts/program/fetch-allowances.sh` once to dump the Allowances `.so` from devnet; a Rust toolchain is required.
