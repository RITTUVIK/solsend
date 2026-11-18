# Deployed integration: Vercel + Supabase + real Lithic sandbox + devnet + QuickNode Streams (2026-11-18 06:25–06:27 UTC)

**Stack:** `https://solsend-ashen.vercel.app` (Vercel Hobby, `iad1`), Supabase free tier (schema 0001 + 0002 lockdown),
Lithic **sandbox** (ASA plus events webhooks pointed at Vercel), SolSend program Upgrade 1 on devnet, and QuickNode
Stream `7bad9332…`. The stream was **activated only for this window and then paused** (verified `paused`).

## Database security (supabase/verify.mts, 11/11 PASS)
- RLS is enabled on all 9 public tables. There are no policies, so `anon` and `authenticated` see zero rows.
- `0002_lockdown.sql` revokes all table privileges from `anon` and `authenticated`. It also revokes EXECUTE on the SECURITY
  DEFINER `rate_limit_hit` from `PUBLIC`, `anon` and `authenticated`.
  - Verification found that the 0001 revoke was ineffective because of Postgres's default PUBLIC execute grant.
  - Without this, anyone holding the publishable key could have exhausted our rate limits over REST.
- `service_role` (the server, via the `sb_secret_` key) keeps DML on all tables and EXECUTE on the function.
- There are no PAN, CVV or secret-like columns.
- Live `SupabaseStore` integration test (`SUPABASE_IT=1`) covers:
  - exactly one winner when two requests consume the same intent concurrently;
  - the card CAS;
  - partial-patch upsert;
  - the auth_hash lookup;
  - feed dedupe plus QuickNode enrichment;
  - the replay guard;
  - the rate limiter.

## Unauthenticated access (deployed)
All of these return **401**:
- `POST /api/lithic/asa` (unsigned)
- `POST /api/quicknode` (unsigned)
- `GET /api/cards`
- `POST /api/reconcile`
- `POST /api/admin/issuer-outage`
- `POST /api/demo-merchant/checkout`

`GET /api/status`: 9/9 checks OK.

## Real Lithic sandbox flow: approve → void → refund, all through the deployed stack
| Step | Time (UTC) | Evidence |
|---|---|---|
| QuickNode stream activated (start at the current slot 523539061) | 06:25:33 | `qn:stream activate` |
| Lithic `simulate/authorize` $0.20 on card `6d98f3d0…` (devnet card `BBN1wkPm…`) | 06:25:4x | token `afe35031-4ee2-458d-b9d9-f75fed4eeb0c` |
| Settle **confirmed** on devnet, **then** the ASA replied APPROVED | 06:25:43.364 | [`3Nah6LUM…`](https://explorer.solana.com/tx/3Nah6LUMJXd8iwqBLK2BbGg5sN7VmcaEZMS9XFncBA557VfG57zbcMUEyzrZy6UbJ5XUUk9kcJRVxuQoap2V3nSM?cluster=devnet); DB `decision=APPROVED` |
| **QuickNode Streams** delivered `CardSettled` to the Vercel webhook | 06:25:43.948 (**+584 ms** after confirmed) | feed row `settled` / `quicknode`. The Lithic token was resolved from the onchain `auth_hash` commitment (no memo). Remaining allowance 0.29 USDC. |
| Lithic `simulate/void` accepted (HTTP 201) | ~06:26:0x | — |
| Lithic emitted `card_transaction.updated` (sandbox voids are asynchronous) | 06:26:38.316 | events webhook receipt |
| Reconciler: Lithic status `VOIDED` → onchain **refund** to the owner's source account | 06:26:39.5 (+~1.2 s) | [`5eNWPKCd…`](https://explorer.solana.com/tx/5eNWPKCdzgjYZAheB8hUTtasQBST8JAyftd3baGzBN72Rdy6hSd4ucod5GxbzT7Pb9GmimxehrRE7WnLX4NkTjR9?cluster=devnet); DB `reconcile_action=refunded`; feed "USDC returned; card limit stays used" |
| QuickNode delivered `CardRefunded` | 06:26:39.999 | Deduped against the reconciler's row. The feed now **enriches** that row with `source=quicknode` + slot instead of dropping the stream confirmation. |
| Stream paused and verified | ~06:27 | `qn:stream get` → `paused` |

The Lithic transaction's final state was `VOIDED`, with events `AUTHORIZATION` and `AUTHORIZATION_REVERSAL`.
