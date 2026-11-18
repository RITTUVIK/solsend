# Evidence index

Every verifiable claim, the file that records it, and the devnet signature or Lithic token behind it. All transactions are **Solana devnet**; all Lithic activity is **sandbox**. Signatures link to the explorer with `?cluster=devnet`.

Labels: **REAL** = real devnet transaction and/or real Lithic sandbox call. **MOCK** = a locally generated, Lithic-shaped request signed with our own HMAC and sent to our endpoint (Lithic not involved); the settles it triggers are still real devnet transactions. Lithic transaction tokens are sandbox identifiers, not secrets and not links.

Program: [`GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp`](https://explorer.solana.com/address/GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp?cluster=devnet). Allowances program: `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`. Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

Only signatures printed in full in the evidence files are linked here. Evidence rows that the source files abbreviate are cited by file, not linked.

## 1. Program (devnet)

Source: [w1-program-devnet.md](evidence/w1-program-devnet.md), [lead-close-revoke.md](evidence/lead-close-revoke.md).

| # | Claim | Result | Signature |
|---|---|---|---|
| P1 | Program deployed; deployed bytes match the local build (sha256 compared) | REAL | [`14Zs4sZp2R…`](https://explorer.solana.com/tx/14Zs4sZp2RphW6aQJynEfvvmwyY1e2xM9Z6CsTVtagmrMyJhCJTWnRCkUjoeYQ76YPQfmC2bbrFwCmPYitq2fz4?cluster=devnet) |
| P2 | Upgrade 1 (audit fixes) deployed; deployed bytes match the build plus zero padding | REAL | [`46pvFy6P…`](https://explorer.solana.com/tx/46pvFy6PwPjsEhaiAQyushvNt5pm6SJTRGjWka2TL7eKfkntWhJaUCH56TX8zX9bEqeKft32yQUM4mpPpwE6YrDa?cluster=devnet) |
| P3 | Sponsored card creation: Allowances `createFixedDelegation` plus `register_card` in one tx, fee payer pays (Upgrade 1) | REAL | [`42gZJXKPpd…`](https://explorer.solana.com/tx/42gZJXKPpdmP56J6T1MnVEExi6UJtRbRDM1nHctgK7KXj7itQw8JHirALmYnv9kLqUvRMKzCPemCwH4rRbgQerJt?cluster=devnet) |
| P4 | `settle` pulls USDC through the allowance into the treasury; first settle locks the merchant | REAL | [`5W7oJtUEyX…`](https://explorer.solana.com/tx/5W7oJtUEyXEEkD1YY5kvfef8LkLowysCgMMpSeNUw5eNH9ifTqSzBwGsPW4gQpeYBfhi6ggcasVeKQgD7HGSmugC?cluster=devnet) |
| P5 | Duplicate settle of the same authorization fails (account already in use), no second pull | REAL, fails `Custom(0)` | [`4cK9GDEXH5…`](https://explorer.solana.com/tx/4cK9GDEXH5p9QxZGsP3pG1ZKsF6uyGFkYVgxNX9DTzkQffKpDrWX2HoaZg1S2CQCP3DdtB3Sbi558HYUmw16CaNX?cluster=devnet) |
| P6 | Same authorization on a different card also fails (per-authorization idempotency, audit L1) | REAL, fails `Custom(0)` | [`3KDGWmZyYX…`](https://explorer.solana.com/tx/3KDGWmZyYX998GH8kHTMQtiGZxDfh66DEjtyQF1CE3EhHNGceSgGSbsWH56kRXWKrnXZgDQAJrLgcfyUGH11P57e?cluster=devnet) |
| P7 | Pre-locked card: FIRST settle at another merchant is declined (`MerchantMismatch`) | REAL, fails `Custom(6005)` | [`yZtGUKrE2q…`](https://explorer.solana.com/tx/yZtGUKrE2qDJ8Wu5WnXQZUL32rdd2nzSPCWix5D6YZ3AfMLEFirNCvpaF15hmeY4GXRC35ydvzxwRVcR4zTruEZ?cluster=devnet) |
| P8 | Pre-locked card settles at its own merchant | REAL | [`4b8Y3LRh8B…`](https://explorer.solana.com/tx/4b8Y3LRh8BvfonAFxd6UmVywDYkeBgWRTaDRHXRq79JYoVfyuVd7xw5nsMFjRE7PS5hHBGEHGXC6V7a1F8xBPRiu?cluster=devnet) |
| P9 | Locked card at a different merchant after its first charge | REAL, fails `Custom(6005)` | [`5BBEU7dwsF…`](https://explorer.solana.com/tx/5BBEU7dwsFLQNVEzxJH4nFLufE2jxYNkA1sun9Rh39u6DN3BuPoFbrhvxqVWgL6JtFsTLDn16ELr2BiKM941r4Ti?cluster=devnet) |
| P10 | Refund goes to `card.source_token_account` (event `destination` = owner's ATA) | REAL | [`5EaCgdE6ur…`](https://explorer.solana.com/tx/5EaCgdE6ur8b3biHgEaA8dU9iCUJypMf4H5iapivDUBNYvgNM4cg68CpioBkHDUZUw7KUZ9szWWZjPeeCFMR3K6N?cluster=devnet) |
| P11 | Freeze by owner | REAL | [`32Knx4F7S2…`](https://explorer.solana.com/tx/32Knx4F7S2xybZqz1WcopiJPrAMFQxyZ1Zn3QB6mPoy6jHsZ3X7B4E42TNaUbUPXmgQwecsnp4k4eQE3VUrSfZRy?cluster=devnet) |
| P12 | Settle on a frozen card fails (`CardNotActive`) | REAL, fails `Custom(6003)` | [`1nnbK3PktZ…`](https://explorer.solana.com/tx/1nnbK3PktZotgFZfJvJ2CQrsJEp1DNhSjpRb1yr1pwrSf9PwpxBnZ3uzXrqTQX2egUVhWDt3nMifXnwdsWHWHWH?cluster=devnet) |
| P13 | Unfreeze; and re-activation of an ACTIVE card (audit H1 recovery path) | REAL | [`jrURn5EJB5…`](https://explorer.solana.com/tx/jrURn5EJB5TrmHzpAVjR49vDBgbko9wURGRnkcbVGBx8HUUvUMRrrCHc5JoD3Ty7ZozuHLBDYn9Jjfe8ubuBbfH?cluster=devnet), [`34FaknBSZk…`](https://explorer.solana.com/tx/34FaknBSZkU67Jq63aRdSkQBmeswA9W7RwfvN4SjUpiPzeMmSsEdYAYUKqEDjrNxs3g8engfRSDLjoM7ytdwfNa8?cluster=devnet) |
| P14 | One-time card settle marks it Used; `remaining_allowance` reported 0 (audit L3) | REAL | [`4ETxM1Li9E…`](https://explorer.solana.com/tx/4ETxM1Li9E9ptsLdJtH1WsqKpfNxW6LwXohBYcxWCAe14Lb7gLadx1Rs5pCHhgV7RJ29vDstHow4twg9iZt4cqQF?cluster=devnet) |
| P15 | Second settle on a Used one-time card fails | REAL, fails `Custom(6003)` | [`5SXfH7Kgsv…`](https://explorer.solana.com/tx/5SXfH7KgsvTvfTKTvuto4DAxnrdxcJDtwKH6RERrwvHQhpYLiuJby8X4YVp9ifLWqfJL9HV2SkxXzqLC9T1ftdvY?cluster=devnet) |
| P16 | Subscription card (Allowances `RecurringDelegation`) register and settle, no idle lock (audit H1) | REAL | [`2pGZcFmefG…`](https://explorer.solana.com/tx/2pGZcFmefG5bSGW1StAP12vcdwjtBWv5UsBDTPPcExB2umN6asM6Maue2PGGu9if9z57UdtBp5hW5LnJ4CTX77bk?cluster=devnet), [`ZVjNJoZFau…`](https://explorer.solana.com/tx/ZVjNJoZFauSCo9unFdkC7q8wv8CMWj77uQFsnGrnNjMJTwxJwBr5AVjJYzwUpnHBzJXXP5dwiUAtSMG7dWNUdnW?cluster=devnet) |
| P17 | Removed `admin_withdraw` cannot be called (no treasury withdrawal; audit L2) | REAL, fails `Custom(101)` | [`RUZsHfbxm5…`](https://explorer.solana.com/tx/RUZsHfbxm51w71dwSLnH7oJh6mkbbD5FmscB6Akay6ceZvK4oB5f9dHYsc86sjsDXD9N3kVLySv1oUm6J58guz6?cluster=devnet) |
| P18 | A card registered before Upgrade 1 still settles after the upgrade | REAL | [`xvEuDDp8o5…`](https://explorer.solana.com/tx/xvEuDDp8o5YpSnT8rb5Y1wXGx6Bn8N1TTVrNr7S8p4ik8FthcUQEuZaReetqnofJvV744GoDAB1hjJLRnkHncJS?cluster=devnet) |
| P19 | Close card plus Allowances revoke in one owner-signed tx; `CardClosed` event; delegation account closed | REAL | [`67PRQbxPFN…`](https://explorer.solana.com/tx/67PRQbxPFNwbAVumsZW3aLoG2bqutaJPX9AR4ij1VJiLzWu5TeDJUe4TGcLogLcB4A9sQtPGJpLWQ8Rs86uLEJYX?cluster=devnet) |
| P20 | Negative control: revoking a sponsored delegation without the `receiver` fails (Allowances 113) | REAL, fails | [`5BBvLHB9Jf…`](https://explorer.solana.com/tx/5BBvLHB9JfFSLmCb7kB6NDg7NBTXKDWiEJWj6yZpF5E39G1jip8J4k59nPevpja2Sc6zxgH1kMcTnp8YaBrEnVCa?cluster=devnet) |
| P21 | Settle after close fails (`CardNotActive`) | REAL, fails `Custom(6003)` | [`4y44UGTA…`](https://explorer.solana.com/tx/4y44UGTARTkJh9qTN2B9W9mGto8PeCTax3Aa9xJ5etfZn2GRG6jzW6uTa3iixVrER68x4YxwPWAsqyCNqwN8dwfc?cluster=devnet) |
| P22 | Sponsored create for the close/revoke smoke card | REAL | [`YgTL42oKja…`](https://explorer.solana.com/tx/YgTL42oKjaneNgoqdn8k3sFKafSBGEoX9j83cGDSEUTbPtqpKAc3RE1HYKTZjUCMGyZB8SVKAWKrdvq87bEHQZ3?cluster=devnet) |

Also recorded there: compute units per instruction, decoded `CardRegistered`, `CardSettled`, `CardRefunded`, `CardFrozen`, `CardUnfrozen` events, and the list of 43 legacy SettlementRecords (see Limitations in the [README](../README.md)).

## 2. Hosted ASA latency (Vercel `iad1`, QuickNode devnet RPC)

Source: [lead-hosted-asa.md](evidence/lead-hosted-asa.md).

| # | Claim | Label | Value |
|---|---|---|---|
| H1 | Cold first request, request to reply, measured from Halifax | **MOCK** (n=12, `scripts/ops/asa-latency.ts`) | **1838 ms** |
| H2 | Warm p50 and p95/max | **MOCK** | **837 ms**, 1741 ms |
| H3 | 12/12 approved; 12/12 SettlementRecords found onchain with `--verify` | **MOCK** + REAL settles | 12/12 |
| H4 | Long-idle cold start (first-ever invocation of the deployment), then warm | **MOCK** request (locally signed, `asa-latency.ts`); settles REAL and verified onchain | **2438 ms**, then **1043 ms** |
| H5 | Real Lithic $0.37: APPROVED, `settled_confirmed`, 1131 ms on a cold instance | REAL Lithic + REAL devnet | Lithic token `212b0390-75ca-484e-92f5-79e7dc5543b3` |
| H6 | Real Lithic $0.52 over the remaining limit: DECLINED (INSUFFICIENT_FUNDS), 768 ms, failed settle is the evidence (Allowances cap) | REAL | Lithic token `2c187dea-577f-4bba-bc89-8a1e3e07f459`; [`5SDTPwgC…`](https://explorer.solana.com/tx/5SDTPwgCiCFfSnU3VxnziM8G8NUrPaACXkAQadSqPKna2puLRqXpCybFCH5TNp9gLtSrB3DjJwThXrwbu65UAu9K?cluster=devnet) |

Verdict recorded in the file: PASS, no fallback architecture needed. Budget is 4.5 s (`ASA_BUDGET_MS`); Lithic's hard limit is 6 s.

## 3. Deployed end-to-end (Vercel + Supabase + real Lithic sandbox + QuickNode)

Source: [lead-deployed-e2e.md](evidence/lead-deployed-e2e.md). Window 06:25 to 06:27 UTC on 2026-11-18.

| # | Claim | Evidence |
|---|---|---|
| E1 | Real Lithic `simulate/authorize` $0.20 approved only after the devnet settle was confirmed | Lithic token `afe35031-4ee2-458d-b9d9-f75fed4eeb0c`; settle [`3Nah6LUMJX…`](https://explorer.solana.com/tx/3Nah6LUMJXd8iwqBLK2BbGg5sN7VmcaEZMS9XFncBA557VfG57zbcMUEyzrZy6UbJ5XUUk9kcJRVxuQoap2V3nSM?cluster=devnet) |
| E2 | Lithic `simulate/void` accepted; Lithic emitted `card_transaction.updated` tens of seconds later (sandbox voids are asynchronous) | same token; event 06:26:38.316 UTC |
| E3 | Reconciler refunded on Lithic status `VOIDED`; DB `reconcile_action=refunded` | refund [`5eNWPKCdzg…`](https://explorer.solana.com/tx/5eNWPKCdzgjYZAheB8hUTtasQBST8JAyftd3baGzBN72Rdy6hSd4ucod5GxbzT7Pb9GmimxehrRE7WnLX4NkTjR9?cluster=devnet) |
| E4 | Lithic final state `VOIDED`, events `AUTHORIZATION` and `AUTHORIZATION_REVERSAL` | same token |
| E5 | Unauthenticated calls return 401 on ASA, QuickNode, cards, reconcile, admin outage and demo checkout; `/api/status` 9/9 checks OK | lead-deployed-e2e.md |
| E6 | Supabase: RLS on all 9 tables, no policies, anon/authenticated revoked, `rate_limit_hit` execute revoked; `verify.mts` 11/11 PASS; live store integration test (concurrent intent consume, card CAS, feed dedupe, replay guard, rate limiter) | lead-deployed-e2e.md, `supabase/verify.mts`, `supabase/migrations/0002_lockdown.sql` |

Earlier real-Lithic runs against a local server through a tunnel (W2) are recorded in [w2-backend.md](evidence/w2-backend.md): approve $1.14 (settle [`mpNVfy1d7H…`](https://explorer.solana.com/tx/mpNVfy1d7HrFrtbdmteWJU5bH8yMnJqMkZetxL8GXj4isGKSjgWSXvARsWyvZMLrZJ2gQQZKVQdD1DNB2vdgbM6?cluster=devnet)), duplicate replay of Lithic's own signed request (second tx [`DDvbRSWvqM…`](https://explorer.solana.com/tx/DDvbRSWvqMdmegk3Ldkku9G7Bsr5Fb5HBFm9XDrvkrjGXEKqSSMP5MoDKM9sFi3sLjwGtyVAGbckpgUqE4hbRHT?cluster=devnet) failed, no second pull; tampered copy returned 401), void and refund ([`3VcgHykbqz…`](https://explorer.solana.com/tx/3VcgHykbqzgqj5pdZuneNFrmdbrhSsd652TFVyYbFYAE2JFmg2RYy2gSwzwWkTefPL9xrDhXNe9yMr2jMwB7SK2x?cluster=devnet)), over-cap and merchant-mismatch declines, issuer-outage decline. Test cards were created through our own prepare, owner-sign and submit path ([`3ZM5riNZQj…`](https://explorer.solana.com/tx/3ZM5riNZQjUPq4oGtXAuQdd8DENmn2y838niCrdTZW9PHEapa9mfpNzRJ8j6wGpdrm2DUSCtaSFMtcm3d4DcNcsD?cluster=devnet), [`7U5FSHwe…`](https://explorer.solana.com/tx/7U5FSHwefpEwPJXDY26rRTq54feESEzfZphzo5t2eiRbCpkzGrbvvaFTvXYbAd8zQMhYaxZjGzGcnWwHinEN4YV?cluster=devnet)). Mock-signed scenario matrix and the 500 ms deadline bug (late settle after a decline, found and fixed, orphans refunded) are in the same file.

## 4. QuickNode Streams

| # | Claim | Evidence |
|---|---|---|
| Q1 | Deployed: `CardSettled` delivered to the Vercel webhook **+584 ms** after the settle was confirmed (06:25:43.364 to 06:25:43.948); feed row `settled` / `quicknode` | [lead-deployed-e2e.md](evidence/lead-deployed-e2e.md); settle [`3Nah6LUMJX…`](https://explorer.solana.com/tx/3Nah6LUMJXd8iwqBLK2BbGg5sN7VmcaEZMS9XFncBA557VfG57zbcMUEyzrZy6UbJ5XUUk9kcJRVxuQoap2V3nSM?cluster=devnet) |
| Q2 | `CardRefunded` delivered at 06:26:39.999; deduped against the reconciler's row and enriched with `source=quicknode` and slot | [lead-deployed-e2e.md](evidence/lead-deployed-e2e.md); refund [`5eNWPKCdzg…`](https://explorer.solana.com/tx/5eNWPKCdzgjYZAheB8hUTtasQBST8JAyftd3baGzBN72Rdy6hSd4ucod5GxbzT7Pb9GmimxehrRE7WnLX4NkTjR9?cluster=devnet) |
| Q3 | Stream paused and verified after the window | lead-deployed-e2e.md |
| Q4 | Filter decodes all 7 SolSend events; ignores `Program data:` lines emitted in a CPI to another program; runs in a sandboxed `vm` self-test; QuickNode's own filter test returned HTTP 201 with no errors; CI fails on filter drift | [w4-streams.md](evidence/w4-streams.md) |
| Q5 | CP0b live Stream (earlier spike program, not the final one): 5 real transactions delivered and HMAC-verified, confirmed to webhook p50 373 ms (n=5); replay returned 409; tampered or forged returned 401 | [GATE0.md](../GATE0.md) (G0.7) |
| Q6 | Limits found: free plan caps `getMultipleAccounts` at 5; `programs_with_logs` lists top-level instructions only (so the program emits its own events); billed per processed block; usage API returns 403 for the Streams key | GATE0.md, w4-streams.md |

## 5. Audits and security review

| # | Claim | Evidence |
|---|---|---|
| A1 | Independent program audit: no Critical finding, no fund-theft path; findings H1, M1, L1, L2, L3, D1, T1 fixed or improved in Upgrade 1 (D2 intended) | [audit-program-cp1.md](evidence/audit-program-cp1.md); fixes proven by P2 to P18 |
| A2 | Security review amendments A1 to A5 (no memo, permanent records, Lithic outer limits, status gate, Supabase secret keys) | [CP1-CONTRACTS.md](CP1-CONTRACTS.md) |
| A3 | Supabase lockdown found an ineffective revoke in migration 0001 and fixed it in 0002 | E6 above |
| A4 | Secret scanning: gitleaks pre-commit hook and CI job | `.gitleaks.toml`, `.github/workflows/ci.yml` |
| A5 | Legacy-record impact of the L1 seed change: 43 old-seed records, 2.15 USDC settled, 1.33 refunded, 0.82 USDC no longer refundable through the program (accepted for devnet) | [w1-program-devnet.md](evidence/w1-program-devnet.md) |
| A6 | Independent backend security review: no Critical finding; 1 High, 5 Medium, 3 Low and Info findings fixed; 9 confirming tests are permanent regressions (7 failed before the fixes); 107 web unit tests pass | [audit-backend-cp1.md](evidence/audit-backend-cp1.md), `apps/web/src/server/__test__/audit.regression.test.ts` |
| A7 | Post-audit deployed re-verification: real Lithic sandbox approve (token `ce7b1d47-e4ff-4827-b49b-e5fbeae5e9c6`) only after settle [`rn4fpLVA…`](https://explorer.solana.com/tx/rn4fpLVAGe2T6ZdFFDX87UbPfqALUDQyEZvarzKrEsD8H9mhnhynTZ5J9PvkSPLZS6feCbSJ6KqqmnEydAMaNY3?cluster=devnet) confirmed; 9 sensitive routes return 401; `/api/status` 11/11 | [audit-backend-cp1.md](evidence/audit-backend-cp1.md), [lead-deployed-e2e.md](evidence/lead-deployed-e2e.md) |
| A8 | Program tests: 41 LiteSVM tests (29 + 12) against the real devnet Allowances binary | `programs/solsend/tests/` |

## 6. CP0b validation (early spikes, spike program)

Source: [GATE0.md](../GATE0.md). These ran against a spike program and the public or QuickNode devnet RPC before the final program existed; they validate the approach, not the shipped program.

| # | Claim | Label | Result |
|---|---|---|---|
| V1 | Allowances integration against the real devnet binary | LiteSVM + REAL devnet | S1 PASS 7/7; S1f PASS |
| V2 | Real Lithic ASA end to end (31 sandbox calls; 3 authorizations, 1 void) | REAL Lithic + REAL devnet | S2 PASS after 3 fixes |
| V3 | Request to reply on QuickNode RPC, n=50 | **MOCK** callbacks, REAL settles | 50/50 APPROVED only after `confirmed`; p50 852 ms, p95 998 ms, p99 1027 ms |
| V4 | Safety suite: bad signature 401, duplicates one pull, forced timeout fail-closed then refunded, over-cap/frozen/revoked decline | **MOCK** callbacks, REAL settles | PASS, 0 violations, 0 anomalies; timeout refund [`5KgRdKvRfH…`](https://explorer.solana.com/tx/5KgRdKvRfHbPr5LEaFDqJUsLUUfbVrxEJRBLMHQ68jZj61LefyfTyEnioynRMTHrrbgEgCBqrfKTerPeiyhs5XW2?cluster=devnet) |
| V5 | Privy embedded wallet signs; our server key pays the fee; user SOL stayed 0 | REAL devnet | [`2bVQYHz8Aa…`](https://explorer.solana.com/tx/2bVQYHz8AaqMniLLPHZC3CMerfdrVGjESC4tJT8i9QBRmnqSJ1wczBucAWzSfJm4EwxX6YroQe15RHiMA8Jcs1F4?cluster=devnet) (finalized, 2 signatures verified) |
| V6 | The first two latency runs failed and led to the hard deadline, websocket-first confirmation and no-preflight hot path | **MOCK** | recorded in GATE0.md (S3 notes) |

## Not covered by evidence

- Live Privy login in the browser against the deployed origin is not recorded in the evidence files except the CP0b wallet test (V5). The UI screenshots in [evidence/w3-screenshots](evidence/w3-screenshots) were produced in **MOCK** UI mode with fake signatures and are not onchain claims ([w3-frontend.md](evidence/w3-frontend.md)).
- No load test of Lithic or QuickNode was run; sandbox policy allows a handful of real requests.
