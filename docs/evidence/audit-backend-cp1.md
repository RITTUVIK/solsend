# AI-assisted backend security review, CP1 (2026-11-18)

A separate **AI review agent** (a separate Claude agent with no shared context; not a professional audit firm), working read-only from fresh context with no network calls, examined `apps/web/src/server/**`,
`apps/web/src/app/api/**`, the shared helpers, and the client bundle for exposed secrets. Each finding below was
confirmed with a test the reviewer ran, or by exact code reasoning. All 9 confirming tests are now permanent
regressions in `apps/web/src/server/__test__/audit.regression.test.ts`. 7 of them failed before the fixes, and the
other 2 pin behavior that must not change.

**Result: no Critical findings.** The reviewer verified these properties:
- APPROVED is reachable only after a **confirmed** settle with `err === null`, through a duplicate whose record is
  readable at confirmed, or through a `$0` verification.
- Nothing is sent after the deadline or the reply, and the engine never throws.
- HMAC is computed over the raw body, compared timing-safe, with a ±300 s window.
- The fee payer co-signs only the byte-identical message of an unexpired, owner-bound intent, and only after
  consuming that intent atomically.
- No account substitution and no versioned-transaction confusion.
- Every `[cardPda]` route checks ownership, and the feed is scoped to its owner.
- Bearer tokens are compared timing-safe.
- Refunds are capped onchain and go only to `card.source_token_account`; the reconciler uses Lithic `status`, not `result`.
- The PAN is held only in a closure and scrubbed from errors.
- No server modules or secrets reach the client bundle.
- No SSRF surface.

| ID | Severity | Finding | Fix (W2, merged) |
|---|---|---|---|
| H1 | High | The in-flight ASA dedupe was keyed only on the token. A same-token request for a **larger** amount, or a BALANCE_INQUIRY, got the cached APPROVED with no settle. | A fingerprint (status, amount, currency, card token/state, merchant) must match. Otherwise the request declines with `inflight_mismatch`. |
| M1 | Medium | The duplicate rule ignored `record.refunded`. A redelivery after a late-settle refund was approved. | Approve only if `amount` matches exactly **and** `refunded == 0`. |
| M2 | Medium | A user could stall the oldest-first reconcile sweep by closing their own USDC ATA and then voiding. | `reconcile_attempts` / `next_attempt_at` exponential backoff with the sweep ordered by due time (migration `0003`). After 8 attempts the row is tagged `anomaly_refund_failing` (counted in `/api/status`). The refund tx **restores** the owner ATA idempotently, and only when it equals `usdcAta(owner)`. |
| M3 | Medium | A void arriving more than 30 min after approval was lost if its single refund attempt failed. | Every failure path re-queues with backoff. A late void on an `approved_pending_settlement` row is still processed. |
| M4 | Medium | Demo swipes could drain the settlement authority's SOL, because records are permanent and each costs about 0.0016 SOL rent. | Demo minimum $1. Caps: 30/day + 10/min per wallet, 120/hour + 60/min global. Checkout returns 503 `demo_paused_low_sol` below 0.03 SOL, keeping SOL for refunds. A runway line is in `/api/status`. |
| M5 | Medium | Unauthenticated `/api/status` made 6 RPC calls plus 4 DB queries per hit, against the RPC quota shared with the ASA. | Computed at most once per 30 s, with `Cache-Control: public, s-maxage=30, stale-while-revalidate=60` so the CDN absorbs floods. Per-wallet read limits: `/api/cards` 60/min, `/api/wallet` 30/min, `/api/feed` 120/min. The UI poll cadence was adjusted to fit. |
| L1 | Low | The reconciler wrote back stale rows, so a racing loser could null the winner's `refund_signature`. | Writes now patch only the changed fields. |
| L2 | Low | No ASA replay guard beyond token idempotency. | A 10-min `webhook-id` replay guard. A repeat gets the same decision while the original is in flight, otherwise `replay`. |
| L3 | Low | SOL rent and fees could be drained via wallet setup, the faucet and tx submits. | Global caps of 200 setups/day and 150 faucet claims/day. `tx/submit` is limited to 30/hour per wallet. |
| Info | — | JWT algorithm not pinned; reconcile returned 500 on a bad body; raw errors in logs; some modules missing `server-only`. | `algorithms: ["ES256"]`, `requiredClaims: ["exp"]`; 400 on a bad body; sanitized logs; `server-only` added. |

**Deployed verification after merge:** `docs/evidence/lead-deployed-e2e.md`, addendum below it.
