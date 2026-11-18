# GATE 0 — Validation Report (Checkpoint 0)

**Status: CP0b IN PROGRESS (approved direction: Consumer SolSend on Solana Subscriptions & Allowances, Lithic sandbox card rail). S1, S2 (real Lithic sandbox), S3 (mock callbacks) and S4 pass; the S3 production-RPC run and S5 are waiting on QuickNode and Privy keys. Tier 1 (Stripe + Bridge) remains BLOCKED on provider provisioning.**
Branch `feat/gate0-validation` · last updated 2026-11-17 · all onchain activity is **Solana devnet**, and all provider activity is **sandbox**.

Raw evidence: `spikes/evidence/<step>.jsonl` (timestamped, scrubbed of PAN/CVC and link tokens). Run guide: [`spikes/README.md`](spikes/README.md).

## CP0b validation (Tue 2026-11-17, branch `feat/cp0b-validation`)

**Labels used below:**
- **REAL devnet:** a signed transaction on Solana devnet.
- **REAL Lithic:** a call to sandbox.lithic.com.
- **MOCK callback:** a locally generated Lithic-shaped, Lithic-signed ASA request. Per Lithic's sandbox policy, only a handful of real sandbox authorizations are used; all scale and concurrency tests are local mocks.

| ID | Status | Evidence |
|---|---|---|
| **S1 Allowances integration** (LiteSVM, against the **real devnet binary**) | **PASS 7/7** | See S1 notes below. |
| **S1f** live on devnet (REAL devnet) | **PASS** | See S1f notes below. |
| **S2 Lithic** access + real ASA callbacks + end-to-end (REAL Lithic + REAL devnet) | **PASS** (after 3 fixed issues) | See S2 notes below. 31 real sandbox calls in total; 3 simulated authorizations plus 1 void went through. |
| **S3 latency**, MOCK callbacks → REAL devnet confirmed settles, public devnet RPC | **PASS** | See S3 notes below. |
| **S3 production path** (QuickNode RPC; Vercel `iad1`) | **WAITING** (QuickNode key / deploy) | — |
| **S4 safety**, MOCK callbacks → REAL devnet | **PASS** | See S4 notes below. |
| **S5** G0.8 Privy co-sign / G0.7 live QuickNode Stream | **WAITING** (keys) | Ready from Gate 0. |

### S1 notes
- **Test setup:** program `De1egAFM…` dumped from devnet (sha256 `2675ad1d…ddbf`; the devnet build differs from mainnet's `af3cefa5…`). IDL pinned at `solana-foundation/subscriptions@57290f41`. Instructions are hand-built from the Codama IDL.
- **Results:**
  - **CPI pull with the Card PDA as delegatee:** 23.17 moves and the cap drops to exactly 16.83 (45,864 CU).
  - **Over cap:** `Custom(300)`, nothing moves.
  - **Revoke done directly in Allowances (outside SolSend):** the pull fails.
  - **Recurring:** a same-period overcharge and a price hike both fail with `Custom(400)`, and the cap resets after the period.
  - **Duplicate authorization hash:** fails atomically ("already in use").
  - **Attacker direct pull:** `Custom(130)` unauthorized.
  - Frozen card, wrong settler and bogus delegation are all rejected.
  - **Refund:** bounded per authorization (`RefundExceedsSettled`, 6008), and only to the stored source account.

### S1f notes (REAL devnet)
- **Policy spike program:** `8uSYgZn5rvEbrpc3NgQFvqcqMA7snptsmiey5457ddR9`.
- **Settle 1.14 USDC:** [`3AJdeFYh…`](https://explorer.solana.com/tx/3AJdeFYhdMQPVcimUeWe7XsK6cMZtPemuH1Xizd5dk2ywQkEKPrnmeqtjaYRrQwg8DxzFAmwAR6H3ph8qmZTdARD?cluster=devnet). The user's wallet goes −1.14 and the treasury +1.14, the delegation has 3.86 remaining, and the Allowances `FixedTransferEvent` decodes (needed for Streams).
- **Rejected with no USDC moved:**
  - duplicate settle (System `0x0`, already in use);
  - over-cap (`0x12c`, i.e. 300);
  - settle after a direct revoke ([`2gXaCb3K…`](https://explorer.solana.com/tx/2gXaCb3KtuTbknYLAYZGr2yQKTTpThdpVC2ufiEUSWRm5tg1YnmQswYTQRfWgsK86ybnT2bURLCDV7fmNVHMMg8W?cluster=devnet)) → `Invalid account owner`.

### S2 notes (REAL Lithic sandbox + REAL devnet, Tue 2026-11-17 21:40–21:45 CST)
- **Access and cards:**
  - **L1:** the key authenticates against `sandbox.lithic.com`. The value was never printed.
  - **L2:** MERCHANT_LOCKED cards were created with `tags` that map each card to its Card PDA. The network backstop is `spend_limit` $100 FOREVER, looser than the onchain $5, so the chain is the binding limit. A throwaway card was paused and then closed.
  - **L3:** ASA was enrolled to our handler through the ngrok free domain, and **disenrolled** at the end.
- **Callback authentication:** real Lithic ASA requests verify with HMAC-SHA256 over `id.timestamp.body`, keyed with the **base64-decoded** part of `whsec_…`. The ASA payload never carries the card number; its `pos.entry_mode.pan` field is an entry-mode enum.

| Test | Lithic | Our ASA decision | Devnet |
|---|---|---|---|
| **T1 $1.14** | `934ca60c-f410-47e7-ac06-41f9994d9e4b`: APPROVED | Settle **transaction submitted** 101 ms after the ASA request arrived; RPC reported **`confirmed`** 755 ms after submission (03:40:32.895Z); **APPROVED reply written** 03:40:32.896Z, 1 ms after confirmation. See the audit below. | Settle [`5zHDimJ2…`](https://explorer.solana.com/tx/5zHDimJ2FFGYn5PiukmL5eNfsDZ7jaBRUuKr8pj8vuHPVNrGnFEZFf2GjejeqZKktMqhxbqrLVdmPNg3cRmCbiwA?cluster=devnet), slot 523497670, owner −1.14 |
| **T2 $4.00** (over the $3.86 left onchain) | `0b03af07-2a90-447d-adf0-c7df3c493f07`: **DECLINED** (`INSUFFICIENT_FUNDS`) | `card_limit_exceeded` | Settle **failed onchain** with Allowances `Custom(300)` ([`2U9EoTaw…`](https://explorer.solana.com/tx/2U9EoTawRoCsPz18G38mCrnWTwXU1jVCX6hzxPuYyumaee7eaACCzUFjN92d9cKWXNqzZZHnXUDgjCPEhw7xqf3B?cluster=devnet), fee only). **No record; owner USDC delta 0.** |
| **Auth/replay** | Real signed T2 request | Forged → **401**; real request + 1 tampered byte → **401**; replay of the real request → **200 with the same decision** | No record created |
| **T3 void of T1** | `AUTHORIZATION_REVERSAL` (−114) at 03:42:25Z → status **VOIDED** | Reconciler acts on the final status | Refund [`52VT6frY…`](https://explorer.solana.com/tx/52VT6frYekNhFqNFSpnuxncw8kuse2sJR4YTFrQvFxWVHHGaW8EcHmmqz13Uyu7HDPZuFADaxPsZzKwo3DRBhBts?cluster=devnet); record 1.14 refunded of 1.14; owner +1.14 |
| **T4 $0.77, real timeout** (test hook held our reply 7 s) | `275bb4c5-270e-4087-91e0-5f25ab9fec23`: **DECLINED** `CUSTOMER_ASA_TIMEOUT` | Settle confirmed 03:42:30.737Z; reply held until 03:42:37.741Z (> 6 s) | Settle [`5HKSPBZZ…`](https://explorer.solana.com/tx/5HKSPBZZCYtAe38GkoJQh9XdkrKb9KR3UKALkVPnidUij2gtMFFgfTXx4kCqEzejWHNPfkZkgQgWeZhLwcqyDwL9?cluster=devnet) → reconciler **refund** [`BF3DfuUT…`](https://explorer.solana.com/tx/BF3DfuUThqDP7oJ35dJbDgEY4pYA2nqZcQyTGRGB6vuX7aYAksnU8RAsZuawRm8vUtuakYnzVYU7qqpQ5Y7HSpQ?cluster=devnet); owner net **0** |

**Failures along the way (fixed or explained):**
1. **Run 1:** `simulate/authorize` was rejected because the descriptor must be 1–25 characters. That isn't in the docs we had. Nothing was authorized.
2. **Run 2:** my no-PAN capture guard matched `pos.entry_mode.pan`, an entry-mode enum, so the replay capture was skipped. The guard failed safe. It now refuses only a real PAN-shaped value, and the replay test moved to T2's real captured request.
3. **T3:** Lithic applies a void **asynchronously**. The status was still PENDING 4 s after the void and VOIDED shortly after. The transaction's `result` field **stays `APPROVED`** on a void. The reconciler correctly did nothing until the final status was known, then refunded (`s2-t3-complete.ts`).

**Hygiene:** no PAN, CVV or secret was found in `evidence/` or `.raw/`; CVV appears only as `[scrubbed]`.

**CP1 findings from S2:**
- **(a)** The reconciler must be driven by `card_transaction.updated` events, or by polling with backoff, keyed on `status` and event types, **never** on `result`.
- **(b)** A void refunds the wallet, but the Allowances delegation's consumed cap is not restored. Decide in CP1 whether a refunded void re-raises a card's limit (for example by recreating the delegation) or simply returns funds.
- **(c)** Lithic merchant descriptors are limited to 25 characters.

### CP0b audit (Tue 2026-11-17 ~22:10 CST; `spikes/src/cp0b-audit.ts`, evidence `spikes/evidence/audit.jsonl`)

**Correction.** An earlier summary said the "approval was sent 101 ms after the request, confirmed 755 ms later". The numbers are right, but they measure different points:
- **101 ms** = ASA request received → settle **transaction submitted** to the RPC. It is not the approval.
- **755 ms** = transaction submitted → RPC reports `confirmed` commitment.
- **856 ms** = request received → decision made.

**T1 timeline, reconstructed (UTC).** The arithmetic is consistent (101 + 755 = 856 = `confirmed_at` − arrival):

| Time | Event |
|---|---|
| 03:40:32.039 | ASA request received from Lithic |
| 03:40:32.140 | Settle transaction submitted |
| 03:40:32 (block time; devnet only has 1 s granularity) | Settle landed in slot 523497670, no error |
| 03:40:32.895 | **RPC reports `confirmed` commitment** |
| 03:40:32.896 | **APPROVED reply written**, 1 ms after confirmation |

**T4 timeline:** request received 03:42:29.925 → submitted .982 → confirmed 03:42:30.737 → reply 03:42:37.741 (held 7,004 ms by the test hook) → Lithic `CUSTOMER_ASA_TIMEOUT`.

**Why "approval after confirmed" holds by construction.** The handler has exactly 4 `APPROVED` paths:
- `settled_confirmed`: only after the RPC confirms the signature at `confirmed` (websocket `onSignature(…, "confirmed")`, or `getSignatureStatuses` reporting confirmed or finalized) with `err === null`. Both T1 and T4 used this path.
- `duplicate_already_settled` and `duplicate_already_settled_onchain`: only if the SettlementRecord is readable at **`confirmed`** commitment.
- `zero_amount_verification`: a $0 check that moves no funds.

**Refund destinations, from onchain token-balance deltas.** T3 void (1.14), T4 timeout (0.77) and S4 timeout (0.01) each changed **exactly two USDC accounts**: the treasury ATA `2vWEpaZn…` down and the owner's ATA `HcgWsXyj…` up by the same amount. The S2 card's stored `source_token_account` equals the owner's ATA.

**Idempotency, onchain:**
- **T1:** one record (1.14, fully refunded), with exactly **1 successful settle and 1 refund**.
- **T2:** **no record** exists; its only transaction is the failed `Custom(300)` settle.
- **T4:** 1 settle and 1 refund, fully refunded.
- **S4 duplicates:** each record has **exactly 1 successful settle**. In each cross-process pair the losing duplicate's transaction **failed onchain** ("already in use"). Same-process pairs never sent a second transaction (in-process dedupe).
- **Simulation-only re-checks on devnet (nothing landed):** a duplicate settle of T1 → `Custom(0)`, already in use; an over-refund of T1 by 1 base unit → `RefundExceedsSettled` (6008).

### S3 notes (MOCK callbacks → REAL devnet confirmed settles)
- **Result:** n=50; **50/50 APPROVED only after `confirmed`**.
  - Request→reply: p50 **873 ms**, p95 **1,021 ms**, p99 **2,394 ms**. Thresholds: p95 ≤ 2,500, p99 ≤ 4,000.
  - Server send→confirmed: p50 753 ms, p95 887 ms.
- **Network diagnostic:** devnet slot time is about 238 ms, `confirmed` p50 is 767 ms, and transactions land within 1–3 slots.
- **The first two runs FAILED, which is why the handler changed:**
  - **Run 1** (p95 4.7 s): my handler polled `getSignatureStatuses` aggressively, which tripped public-RPC 429s.
  - **Run 2:** that run exposed a **bug**. The budget wasn't a hard deadline, so a slow in-flight RPC call could make a reply exceed it.
  - **Fixes:**
    - a hard reply deadline;
    - never approving after the deadline;
    - a crash-proof handler (fail closed on any exception);
    - websocket-first confirmation;
    - no preflight on the hot path.
  - Both failed runs are kept in `spikes/evidence/s3.jsonl`.

### S4 notes (MOCK callbacks → REAL devnet)
- **Bad signature:** HTTP 401.
- **Duplicates:** 2 same-process and 2 cross-process pairs. Each pair got matching replies and **exactly one onchain pull**.
- **Forced timeout:** fail-closed decline. The settle **landed late**, and the reconciler refunded it ([`5KgRdKvR…`](https://explorer.solana.com/tx/5KgRdKvRfHbPr5LEaFDqJUsLUUfbVrxEJRBLMHQ68jZj61LefyfTyEnioynRMTHrrbgEgCBqrfKTerPeiyhs5XW2?cluster=devnet)).
- **Declines:** over-cap → `INSUFFICIENT_FUNDS`; frozen → `CARD_PAUSED`; externally revoked → `CARD_PAUSED`. **No settlement record** in any case.
- **Invariant check:** "USDC moved == USDC approved after reconciliation" holds with 0 violations and 0 anomalies.
- **Backlog sweep:** 49 queued fail-closed declines; 41 never landed and 8 landed late, all refunded.

### Findings for CP1 (contracts)
1. **Approve only after confirmed is viable on devnet**, with the hot path built this way:
   - hand-built instruction and cached blockhash;
   - no preflight;
   - websocket confirmation;
   - a hard 2.5 s deadline;
   - the reconciler as a day-one component.
2. **Duplicate handling has two layers:** in-process dedupe plus the onchain `SettlementRecord`. A confirmed-status `Custom(0)` on the settle instruction means "already settled": check the record, then approve.
3. **Rent:** each `SettlementRecord` costs the settlement authority about 0.0015 SOL. CP1 needs a `close_record` instruction once a record is past the reconciliation window.
4. **Sponsored delegations:** the Allowances program supports an optional trailing **payer** on delegation creation, so card creation can be gasless for users.
5. **The final Lithic decision drives refunds.** In production the reconciler acts on Lithic `card_transaction.updated` (or the transaction status), not on our own local reply.

## Gate 0 results (original)

| Item | Status | Evidence / blocker |
|---|---|---|
| G0.1 Stripe Sandbox (CA) ↔ Bridge sandbox, `POST /v0/cards/enable` | **BLOCKED** | Provider provisioning (2026-11-17). Opening Issuing in a new Canadian Stripe Sandbox showed "you don't have permission", and Bridge dashboard login failed. Stablecoin cards are sales-gated, and so is new-developer Bridge access. Not a code failure; the script never ran. See the investigation below. |
| G0.2 Bridge customer `["base","cards"]` → KYC link → `stripe_cardholder_id` | **BLOCKED** | Depends on G0.1 and a Bridge sandbox API key. Script ready (`g02:customer`, `g02:refresh`). |
| G0.3 Card A (keypair wallet): card → approve 10 USDC → $1.14 auth → onchain pull | **BLOCKED** | Depends on G0.2. Script ready (`g03:card-a`). |
| G0.3b Revoke → auth declined? (added to inform freeze/expire design) | **BLOCKED** | Depends on G0.3. Script ready (`g03:card-a --revoke-test`). |
| G0.4 Card B (PDA wallet) | **PARTIAL** | **Program side: PASS.** The PDA-owned ATA approves and revokes the derived issuer delegate through `invoke_signed`, with 5/5 LiteSVM tests passing (below). **Stripe/Bridge accepting a PDA address: BLOCKED** (depends on G0.2). |
| G0.5 Cards A and B, same cardholder, each pulls only from its own wallet | **BLOCKED** | Depends on G0.3 and G0.4. Script ready (`g05:isolation`). |
| G0.6 Reverse/refund → time until USDC returns onchain | **BLOCKED** | Depends on G0.3. Script ready (`g06:refund --mode reverse\|refund`). |
| G0.7 QuickNode Stream (devnet) → filter → webhook, latency | **PARTIAL** | **Offline: PASS.** The filter matched correctly on both datasets; the webhook accepted a valid HMAC and rejected a replay, a wrong key and a stale timestamp. **Live stream and latency: UNTESTED** (needs a QuickNode API key). |
| G0.8 Privy embedded wallet signs; server fee payer is `feePayer` | **UNTESTED** | Server and page are ready. The page bundles cleanly. Needs a Privy App ID and about 0.1 SOL on `fee-payer`. |
| G0.9 Toolchain + test framework | **PASS** | `anchor-cli 1.2.2`, `solana-cli 4.1.2 (Agave)`, `cargo-build-sbf 4.1.0` / platform-tools v1.54, rustc 1.95.0, node v22.19.0, pnpm 10.24.0. The recommended test framework is **LiteSVM**, the default `anchor init` template in 1.2.2 (Mollusk, mocha and jest are alternatives). Source: Anchor v1.2.2 `docs/content/docs/installation.mdx`. Evidence: `evidence/g09.jsonl` (2026-11-17T08:18:14Z). |

**G0.4 LiteSVM evidence** (`cd spikes/pda_vault_spike && anchor test`, 2026-11-17):
`pda_vault_can_approve_issuer_delegate_and_revoke` ✅ · `wrong_issuer_delegate_is_rejected` ✅ (error 6000) · `approve_above_balance_is_rejected` ✅ (error 6001) · `another_signer_cannot_approve_someone_elses_vault` ✅ · `withdraw_returns_funds_to_authority` ✅

**Tier decision: PENDING. Tier 1 is BLOCKED (provisioning). Recommendation: Tier 2 (Lithic sandbox) with PDA vaults and the program `settle()` model,** subject to tests L1–L4 passing. See "Tier 2 (Lithic) validation". The vault model is PDA if the chosen tier allows it; otherwise it is the *secure fallback* below, **not** DERIVED_KEYPAIR.

## Tier 1 access investigation (2026-11-17)

**What we observed:**
- **Stripe:** in a newly created **Canadian Stripe Sandbox**, opening **Issuing** returns "you don't have permission".
- **Bridge:** the dashboard's email magic link returns "Something went wrong. Please try again later."

Docs were checked live on 2026-11-17.

**Diagnosis, with each hypothesis tested against the docs:**

| Hypothesis | Evidence | Verdict |
|---|---|---|
| **H1: The account is not provisioned** | **Stripe**, [Stablecoin-backed card issuing](https://docs.stripe.com/issuing/stablecoin-cards): "Stablecoin-backed card issuing is in public preview. To get access, contact Stripe sales." **Stripe**, [Onboarding](https://docs.stripe.com/issuing/stablecoin-cards/onboarding): "To start onboarding, contact Stripe sales. After you sign the program addendum, Stripe schedules a kickoff meeting and sets up your sandbox and Bridge developer account." Launch "requires approval from Stripe, the sponsor bank, and the card network." **Stripe**, [Issuing in different countries](https://docs.stripe.com/issuing/global): CA appears only under "Local commercial issuing… Contact us to set up your program." **Bridge**, [Get set up](https://apidocs.bridge.xyz/get-started/introduction/quick-start/get-set-up-with-bridge): "Are you an existing developer? Login to your Bridge Dashboard" versus "Do you want to get started? Contact sales". **Bridge**, [Cards sandbox](https://apidocs.bridge.xyz/platform/cards/sandbox/sandbox): the sandbox API key is generated "in the Bridge Dashboard in the API keys page", so dashboard access comes first. | **Primary cause, high confidence.** Every route to an Issuing-enabled sandbox and a Bridge developer account goes through a sales or contract step that we haven't completed. |
| **H2: A technical login problem (Bridge)** | The error is generic. `dashboard.bridge.xyz` is reachable (HTTP 307 → `/login`), so this is not a site-wide outage. I found no public status page: `status.bridge.xyz` has no DNS record, and `bridge.statuspage.io` redirects to Statuspage's homepage. That leaves no incident evidence either way, and the docs don't describe what an unprovisioned email sees. | **Undetermined**, and it doesn't change the outcome. Even with a working login, the docs say new developers start with sales, and the Stripe side is gated independently. |
| **H2b: A Stripe team-role permission** | The [Sandboxes docs](https://docs.stripe.com/sandboxes) say access depends on "your permissions". A non-Owner/Admin role could produce a permission error. | **Unlikely**, because you created the account and so should be its Owner. Confirm in Settings → Team. This alone would not explain the gating in H1. |
| **H3: The product is not available for our case** | **Platform location:** consumer programs can be based in "Most countries, excluding sanctioned countries", so a Canadian platform is **not** excluded. **Cardholder markets:** "more than 60 countries across the US, Latin America, the Caribbean, Africa, and Asia. Your program is approved for its specific markets during onboarding" ([source](https://docs.stripe.com/issuing/stablecoin-cards)). [stripe.com](https://stripe.com/issuing/stablecoin-cards) adds: "Issuance is currently available in major markets across Africa, Latin America and the US, with EU and APAC availability planned for 2026." **Canada is not listed.** Regular Stripe Issuing in Canada is commercial-only. | **A real secondary restriction.** Consumer stablecoin cards for **Canadian cardholders** are not in any documented market today, and regular Canadian Issuing doesn't cover consumers. This isn't what caused today's error, which happened before any cardholder existed, but it limits Tier 1 for a Canadian consumer product even after provisioning. |

**Other checks:**
- **No bypass through Privy.** Privy's card components need connected accounts: "Connect your Stripe and Bridge accounts" ([Privy cards setup](https://docs.privy.io/financial-flows/cards/pre-built-components/overview)).
- **Timeline.** A sandbox only arrives after the addendum is signed and a kickoff is held, and production testing is "about 2 weeks after contract signature". There's no realistic way to get access before Fri Nov 20 12:00 CST.

**Confirmed details for the record**, in case Tier 1 is unblocked later:
- "Bridge only supports testing cards against the **Stripe Sandbox**. Stripe's Test Mode is not supported."
- For Solana devnet, "Use the `MERCHANT_ID` of `1`". In production, "You will be assigned a specific MERCHANT_ID value by Bridge."
- "If you are using Solana, do not specify the associated token account address… Bridge will automatically derive it."
- **"Note that a wallet can only be tied to one card account."** This independently confirms that SolSend needs one wallet (vault) per card.
- Stripe lists **USDC on Solana** as a supported Issuing asset.

**Verdict:** G0.1–G0.3, G0.5 and G0.6 are **BLOCKED**, not FAILED. Nothing about our integration was disproven. The scripts stay in `spikes/` and can be rerun unchanged if provisioning arrives.

## Tier 2 (Lithic) validation (2026-11-17)

These are documentation findings. The quotes were checked against the saved raw pages from docs.lithic.com, and the API-spec parsing was checked directly. **Nothing below is a live test yet.**

| Question | Finding | Source | Confidence |
|---|---|---|---|
| Can a Canadian team self-serve a sandbox? | "Each account comes with a Sandbox API key." "You can immediately make requests to the Sandbox environment at sandbox.lithic.com." "Our Sandbox environment is free to use." "Your account starts in Sandbox mode." Signup at `https://app.lithic.com/signup` asks for email, password and terms acceptance. **No country field** (read from the dashboard JavaScript, not the docs). | docs.lithic.com/docs/get-api-key, /docs/sign-up | High (form fields: Medium) |
| Any country restriction? | **None found** in the docs or [Terms](https://www.lithic.com/legal/terms) (updated 2024-01-30). The Terms say: "The Service is a business product, to be used for commercial purposes" (consumers are pointed to Privacy.com), and the solution must meet "U.S. financial services protection, anti-money laundering, and sanctions laws". Production KYB is US-centric (EIN, Secretary of State), but Lithic publicly markets to Canadian fintechs. | Terms; docs/client-onboarding-guide | Medium |
| Card types for burner cards | `SINGLE_USE`: "closed upon first successful authorization", which maps to **one-time cards**. `MERCHANT_LOCKED`: "locked to the first merchant that successfully authorizes", which maps to a **per-store card**. Cards also support `spend_limit` (in cents) with `spend_limit_duration` of `TRANSACTION`, `MONTHLY`, `ANNUALLY` or `FOREVER`, and a `state` of `OPEN`, `PAUSED` or `CLOSED`. | /reference/postcards, /docs/cards | High |
| Real-time decisions (ASA) in sandbox | "Enrollment in Sandbox is self-serve… Every simulated authorization on the instance is routed to the enrolled endpoint." Enroll with `POST /v1/responder_endpoints {type:"AUTH_STREAM_ACCESS", url}`. Requests can be HMAC-signed (`webhook-id`/`-timestamp`/`-signature`) once `GET /v1/auth_stream/secret` is called. **The ASA payload never contains the PAN.** | /docs/auth-stream-access-asa | High |
| ASA deadline | "If no response is received within 6 seconds, the transaction will be declined." "We recommend responding within 3 seconds." A timeout produces `CUSTOMER_ASA_TIMEOUT`, so it **fails closed**. | /docs/auth-stream-access-asa | High |
| Showing card details | `POST /v1/cards/{token}/embed` returns a single-use `session`. The browser then loads `GET /v1/embed?session=…&type=PAN\|CVV…` directly: "card details never touch the API client's servers." This satisfies **hard rule 7**. | /docs/embedded-card-ui | High |
| Simulating purchases | `POST /v1/simulate/authorize` **requires `pan`** (the spec lists `required: [amount, descriptor, pan]`), and so does `/simulate/return`. Sandbox shows PAN and CVV to every client. `/simulate/clearing` and `/simulate/void` take only the transaction `token`. | /reference/postsimulateauthorize, /docs/cards | High |
| Lithic's own stablecoin funding | "currently in a pilot and is enabled per program… contact your customer success manager". Supports Solana Devnet, but funds an account, not a card, and card spend never touches the chain. **Not usable and not needed:** our program does the settling instead. | /docs/quick-start-stablecoin-funding-in-sandbox | High |
| Limits | Sandbox allows 1 write request/second on `/simulate*` and 2 on card writes. `card.updated` events are "Not currently available in the Sandbox environment." | /docs/rate-limits, /docs/types-of-events | High |

**How Tier 2 keeps the consumer concept and keeps Solana real.** Each card gets its own Card PDA and PDA-owned USDC vault in **our** program; G0.4's program-side PASS applies directly, and no Bridge PDA acceptance is needed. A purchase works like this:
1. A Lithic sandbox authorization arrives at our ASA endpoint.
2. The endpoint reads the Card PDA (status, cap, per-transaction limit) and the vault balance from devnet.
3. `settle()` moves real devnet USDC from the vault to the treasury, with a `SettlementRecord` keyed by a hash of the Lithic transaction token.
4. The QuickNode Stream picks the transaction up and the activity feed updates.

Caps, one-time use and freezing are enforced by our program, so the README claim "enforced onchain" holds. `MERCHANT_LOCKED` and `SINGLE_USE` add network-side enforcement on top.

**Design consequences to settle before CP1:**
- **T2-D1: settle timing within the ASA deadline.**
  - *(a) Settle, then approve (preferred).* Send `settle()`, confirm, then reply `APPROVED`. If the 2.5 s budget runs out, reply decline, which fails closed. Every approved swipe has a devnet signature *before* approval.
  - *(b) Approve, then settle,* with an in-memory hold ledger to prevent concurrent overspend. This is faster but has a race if the owner withdraws between approval and settle.
  - Choose using measured devnet latency (test L4).
- **T2-D2: PAN for simulated purchases, which needs your decision under hard rule 7.**
  - The simulator needs the sandbox test PAN. Proposal: a separate sandbox-only `merchant-sim` module, acting as the merchant, that fetches the test PAN, holds it in memory only, never logs, stores or returns it, refuses to run against production hosts, and is covered by the AT13 grep test.
  - The user-facing app and API stay iframe-only.
  - If you'd rather not, the alternative is triggering purchases from Lithic's own tooling outside our app, which makes for a weaker demo.
- **T2-D3: the settlement authority is the rule 8 exception.** It's already in the plan. It's bounded by Active status, the cap, the per-transaction limit and the vault balance; it can only pay the fixed `Config.treasury`; and `SettlementRecord` makes it idempotent per authorization.

**Tier 2 Gate 0 tests (all UNTESTED; scripts to be written after signup):**

| ID | Test |
|---|---|
| L1 | Truthful signup → sandbox key works (`GET /v1/cards`). |
| L2 | Create `MERCHANT_LOCKED` and `SINGLE_USE` virtual cards with a `FOREVER` spend limit. |
| L3 | Enroll ASA (through the tunnel) and verify the HMAC. A simulated authorization reaches our endpoint. |
| L4 | ASA reads devnet state and **settles then approves** within budget. Record p50/p95, the devnet signatures and the Lithic tokens. |
| L5 | A second authorization on a `SINGLE_USE` card is declined, and so is an authorization at another merchant on a `MERCHANT_LOCKED` card. |
| L6 | `simulate/return` → event → onchain `refund()`. |
| L7 | The embedded card iframe renders in sandbox; server logs and requests contain no PAN. |
| L8 | `merchant-sim` PAN isolation (pending decision T2-D2). |

## Environment set up for Gate 0

- **Toolchain.** I installed AVM and Anchor 1.2.2 from the `v1.2.2` tag. That tag is the same commit (`8d9d1488`) on both `solana-foundation/anchor` and `otter-sec/anchor`, and the binary was attestation-verified. I added Rust 1.95.0 as an extra toolchain (your default stays 1.87; `anchor-lang` 1.2.2 needs ≥1.89).
- **Global Solana CLI side effect.** The AVM `anchor` proxy switched the **global** Solana CLI from 2.3.9 to **4.1.2**, the version Anchor 1.2.x recommends, and AVM has no opt-out. Your global CLI config is unchanged (testnet RPC, personal key). To revert after the hackathon: `agave-install init 2.3.9`.
- **Project devnet environment, outside the repo.**
  - `~/.config/solsend/devnet/` (mode 700) holds `deployer` `peENpfyrTzWyHejccTYto9Jg46UjqKfEaK3ye5xaP8L`, `card-a-owner` `DEGx8bvPLZQDS65xbw79My2tV97cfqsKQfGos6Nq3nWe` and `fee-payer` `3dQxfxtUXJrNXXApsByeRy8pB7gHQpZfHxVruy2S3r7m`, plus `cli.yml` (devnet).
  - The personal wallet is not used anywhere.
  - Every script refuses to run unless the RPC's genesis hash is devnet's, the Stripe key is `sk_test_`/`rk_test_`, and the Bridge key is `sk-test` against the sandbox host.
- **Secrets hygiene.** `.gitignore` covers `.env*`, keypairs and build output. `.gitleaks.toml` extends the gitleaks defaults with rules for Solana keypair JSON, QuickNode tokenized URLs, Bridge/Privy key assignments and raw PANs; each was checked against synthetic samples. The `.githooks/pre-commit` hook blocks sensitive filenames and runs gitleaks on the staged diff. It's enabled locally through `core.hooksPath`; each teammate runs `git config core.hooksPath .githooks` once.
- **Supply chain.** Every npm dependency is pinned exactly and was at least 14 days old (`minimum-release-age` in `spikes/.npmrc`). pnpm's default blocking of dependency build scripts is left on.

## Findings that change the plan (from docs, to be confirmed by the tests)

- **F1: Tier 1 access may be gated.**
  - Stripe calls stablecoin-backed Issuing "public preview… contact Stripe sales". After the program addendum, Stripe sets up the sandbox and Bridge developer account.
  - Bridge's own guide says Stripe **Test Mode is not supported**; testing needs a **Stripe Sandbox**.
  - `crypto_wallet` and `crypto_transactions` appear only in private-preview SDKs. The scripts therefore use raw HTTP and try the account-default and `2026-10-28.preview` API versions, recording which one worked.
- **F2: Canadian cardholders are not documented.** Consumer stablecoin-card cardholders are documented for "the US, Latin America, the Caribbean, Africa, and Asia", and Canada is not named. The synthetic fixture stays Canadian (hard rule 6). If Bridge reports `customer_region_supports_cards` missing, **I will stop and ask you**; I won't change the fixture country on my own.
- **F3: PDA wallets are unproven on Bridge's side.** Bridge's sample derives the ATA without `allowOwnerOffCurve`. Stripe's preview SDK also lists `crypto_wallet[type]=squads`, which suggests smart-account (PDA) wallets go down a separate path. G0.4 tests the `standard` type with a PDA. If that fails, `squads` is a lead, not a plan.
- **F4: The hold is larger than the purchase.** `hold_amount = network + reserve + estimated_fee`, so the delegate approval must cover more than the purchase. Simulations use the explicit MCC `computer_software_stores`, because the API example's taxi MCC carries a 20% reserve.
- **F5: The transaction hash can arrive late.** Stripe may send `issuing_authorization.created` before the onchain pull confirms, and `crypto_transactions[]` is a typed list. Scripts filter on `type === "crypto_transaction_confirmed"` and never read `[0]`.
- **F6: Refunds are asynchronous and may be batched.** "Bridge returns the funds to the wallet asynchronously and might combine multiple refunds into one onchain transaction." G0.6 watches the ATA for any inbound transfer and doesn't assume a 1:1 mapping.
- **F7: QuickNode limits and datasets.**
  - The Free plan is a 1-month trial with 1 active stream and no compression.
  - Solana datasets are only `block` and `programs_with_logs`.
  - Webhook HMAC: `hex(HMAC-SHA256(token, nonce + timestamp + body))`.
  - The filter matches on *our vault ATAs or our program*, never the Token program or `cardWArq…` alone, because those would deliver every devnet token transfer or Bridge pull.
- **F8: Privy sponsorship only works with sign-and-send.** Privy's native sponsorship (`sponsor: true`) exists only on sign-and-send. Our design has the server pay fees on a sign-only transaction, so G0.8 tests whether `signTransaction` partially signs when another account is the fee payer. A fallback (`signMessage` over the message) is built in.
- **F9: Anchor 1.x changed.** The TypeScript client is `@anchor-lang/core`, `CpiContext::new` takes a program ID, and `anchor-spl` 1.2.2 `idl-build` fails without default features (an upstream gating bug). The default test template is LiteSVM.

## Security audit: the DERIVED_KEYPAIR fallback (rejected)

The proposal is a card vault key seed `= sha256(wallet.signMessage("SolSend card v1:" + card_id))`. **Recommendation: do not build it.**

1. **It treats a signature as a secret.** Message signatures are designed to be public and verifiable. Wallets, sign-in flows, backends, analytics and extensions routinely send and store them. Anyone who ever sees the signature has the vault's private key forever.
2. **It is easy to phish.** The message is fixed and predictable (sequential `card_id`, no domain, no nonce). Any malicious site can ask the user to "verify your SolSend card" by signing the same string and then derive the keys to **every** card offline. Wallet UIs give no warning that this signature is a private key.
3. **It relies on deterministic signing.** Ed25519 is deterministic by spec, but wallets aren't obliged to be. MPC/threshold signers can use random nonces; Ledger wraps off-chain messages in a header; wallet updates or switching wallets can change the bytes. Any of these produces a different derived key, and funds in the old vault are **permanently unreachable**.
4. **The key lives in page JavaScript.** The derived private key sits in app memory, so XSS, a malicious dependency or a browser extension can exfiltrate it. Wallet keys, by contrast, stay in the wallet or enclave.
5. **It can't be rotated or revoked.** A leaked signature compromises that vault for good.
6. **It discards onchain enforcement.** A keypair-owned ATA can transfer, approve unlimited amounts or close directly through SPL, bypassing our program. Invariants I1–I6 would become advisory, and the README's claim that caps and locks are enforced onchain would be false.

**Secure alternatives, in order:**

- **A. PDA vault (preferred, if G0.4 passes).** Only the program can sign for the vault, so I1–I7 are enforceable.
- **B. One Privy HD embedded wallet per card** (`createWallet({ createAdditional: true })`, path `m/44'/501'/i/0'`).
  - Keys are generated with real entropy and held in Privy's TEE (AWS Nitro plus 2-of-2 Shamir shares). Our JavaScript never sees a private key, and Bridge sees an ordinary on-curve wallet.
  - Costs:
    - There's a per-user wallet cap, about 10, unverified for Solana.
    - It only works for embedded-wallet users.
    - Spending power is enforced by the SPL delegate amount plus Stripe `spending_controls` (`all_time` and `per_authorization`), not by our program.
    - Operator freeze becomes Stripe `status=inactive`, because the operator can't sign a revoke for a user-owned ATA.
  - Must be validated before committing to it: the cap and the signing prompts.
- **C. Squads smart-account vault** (`crypto_wallet[type]=squads`). This is a PDA with onchain spending limits. It's promising but undocumented, so investigate only if A fails and B's cap is a problem.
- **D. A random per-card key wrapped by a passkey (WebAuthn PRF).** This removes the phishing problem but keeps the JavaScript-memory and recovery problems. Not recommended for this timeline.
- **E. Tier 2/3 settle model.** Funds stay in PDA vaults and our program's `settle()` moves them, so onchain enforcement is kept. It costs the "issuer pulls directly" story.

## Revocation and expiry design (your override)

- **A delegate pull never calls our program.** The issuer program moves funds by CPI to SPL Token as the delegate, so a *lazy* `expire_card` check in our program **cannot** stop a previously approved delegate. Only an onchain `revoke` (or a smaller approval, or moving the funds out) removes spending power.
- **Design:**
  1. `expire_card` performs the `revoke` CPI and is permissionless.
  2. The operator runs a crank that calls it at the idle threshold.
  3. In the same step, the provider card goes `inactive`, as a network-side second layer.
  4. The armed amount is kept small and never exceeds the remaining cap, which limits exposure between crank runs.
- **G0.3b measures the actual behaviour.** It checks whether Stripe *declines* after a revoke, or approves and then fails the pull, which would be a different risk owner. The AT6 and AT9 designs will be adjusted to whatever we observe.

## One-time card closing (your override)

- **Don't close the vault right after use.** Refunds and reversals arrive asynchronously, may be batched (F6), and go to the card wallet's ATA. Closing that ATA could make a refund fail or strand it.
- **Proposed lifecycle:**
  1. After the first observed pull: `mark_used`, which revokes the delegate and cancels the provider card.
  2. The vault stays open until every authorization on the card is closed or captured **and** a refund grace window has passed. The window is sized from G0.6's measured latency.
  3. Only then is `close_card` allowed.
- **Effect on the program:** it needs a `refund_grace_secs` field in `Config`, and a `close_card` guard for `Used` cards. The guard is a change for the CP1 IDL review.

## Repository note (hard rule 1)

All five existing commits are your teammate's, dated Nov 16–17 (after Nov 13). However, `RITTUVIK/solsend` is currently **private**, and it must be **public** by submission. That's an outward-facing change for the team to make; I haven't touched it.

## What I need from you to finish Gate 0

**Next action:** sign up for the Lithic sandbox at https://app.lithic.com/signup, truthfully, as the team building SolSend, and turn on 2FA. Then put the Sandbox API key in `spikes/.env` as `LITHIC_API_KEY`. Please don't paste it into chat.

**Decision needed with your reply:** T2-D2, whether sandbox-only test-PAN handling in an isolated `merchant-sim` module is acceptable under hard rule 7.

**Still needed later, in order:**
1. **Devnet SOL.** 5 SOL to `deployer` `peENpfyrTzWyHejccTYto9Jg46UjqKfEaK3ye5xaP8L` from https://faucet.solana.com.
2. **Devnet USDC.** 20 or more USDC to `card-a-owner` `DEGx8bvPLZQDS65xbw79My2tV97cfqsKQfGos6Nq3nWe` from https://faucet.circle.com.
3. **QuickNode.** A Streams-enabled API key (free trial is fine).
4. **Privy.** A dev app with email login and test accounts enabled.

**Tier 1 (Stripe + Bridge).** Off the critical path. If you want it for after the hackathon, the documented route is Stripe sales (https://stripe.com/contact/embedded-finance), which leads to a program addendum and then a sandbox plus Bridge developer account.
