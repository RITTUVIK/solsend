# SolSend trust model (CP1)

SolSend is a **sandbox + Solana devnet** demo. No real merchants are charged and no real card network
settles. This document states exactly who can do what and which assumptions are offchain.

## Where the money lives
Your USDC **never leaves your wallet until a card authorization is settled**. Each card is an
allowance in Solana's official **Subscriptions & Allowances** program (`De1egAFM…R44`):

- **Store-locked and one-time cards** use a `FixedDelegation` (a lifetime cap).
- **Subscription cards** use a `RecurringDelegation` (a per-period cap).

The delegatee is the card's SolSend Card PDA. A PDA has no private key: only the SolSend program
can sign for it, and only inside `settle`.

## Actors and powers
| Actor | Can | Cannot |
|---|---|---|
| **You (owner, Privy embedded wallet)** | Create, freeze, unfreeze and close cards. Revoke any delegation **directly in the Allowances program, without SolSend** (escape hatch). Move your USDC freely. | — |
| **Settlement authority** (server hot key, devnet) | `settle` **one** Lithic authorization: only while the card is Active, not paused, not idle, at the locked merchant, ≤ per-tx max, ≤ the delegation's remaining cap. Funds go **only to the treasury PDA**. `refund`: only to the card's stored source token account, capped at the amount settled for that authorization. Freeze a card (reduce-only). | Withdraw from the treasury. Raise limits. Unfreeze. Pull a revoked, closed or used card. Pay anyone else. Settle the same authorization twice (SettlementRecord PDA). |
| **Admin** (deployer key, devnet; must be the program upgrade authority to initialize) | Pause or unpause settles (kill switch; refunds keep working). Rotate the settlement authority. | Touch user wallets or delegations. Change a card's limits or source account. **Withdraw from the treasury: there is no withdrawal instruction in the MVP.** Treasury funds can leave **only** through refunds to the original source accounts. Treasury → issuer settlement is out of scope (sandbox). A post-MVP withdrawal would be capped at the treasury balance minus outstanding refundable amounts. |
| **Fee payer** (server key) | Pay fees and rent for **server-built** transactions. It co-signs only a message byte-identical to a stored, unexpired, unconsumed intent (CP0b G0.8). | Move user funds. Sign arbitrary transactions. |
| **Program upgrade authority** (deployer key) | Upgrade the SolSend program on devnet. **This is the largest trust assumption**; freezing the program after the hackathon is the mitigation. | — |

## Invariants (tested; never weakened)
1. **Confirmed-before-approve.** The Lithic ASA reply is `APPROVED` only after the settle transaction is
   **confirmed** on devnet, or when an existing SettlementRecord for the same authorization is readable at
   confirmed commitment. Everything else declines, including errors, timeouts and unknown state.
2. **Atomic, permanent idempotency.** There is one SettlementRecord PDA per **authorization**, with seeds
   `["settle", auth_hash]`. Records are **never closed**: the program has no close instruction. A Lithic
   authorization can therefore pull **once in total**, across all cards. A duplicate, re-delivered or replayed
   authorization can never pull twice, no matter how old it is. Each record costs about 0.0015 devnet SOL of rent,
   which is acceptable for the MVP. A redelivery is approved only when the existing record's amount equals the
   requested amount; any other amount for the same token is declined, because incremental authorizations are not
   supported in the MVP.
3. **Correct refunds.** A refund goes only to `card.source_token_account` and is capped at
   `record.amount − record.refunded`.
4. **Late settles are refunded.** If a settle confirms after we declined or timed out, the reconciler
   refunds it. The reconciler's source of truth is the **Lithic transaction status** (`DECLINED`,
   `VOIDED` or `EXPIRED` → refund the remainder), not our database.
5. **Fail-closed.** There is a hard ASA deadline, below Lithic's 6 s limit. Timeouts decline.
6. **The chain is the authoritative spending gate; Lithic is an outer circuit breaker.** Every approval needs
   a confirmed onchain `settle`. Onchain declines carry the failed devnet transaction signature as evidence.
   Lithic limits are set **looser** than the onchain policy, so they never pre-empt an onchain decision in the
   normal range. They still bound the blast radius if the ASA path ever approved without a confirmed settle:
   - Store-locked: `VIRTUAL`, `spend_limit` 2× the onchain limit, `FOREVER`.
   - One-time: `SINGLE_USE` (closed by Lithic after the first successful authorization), 2× the limit, `TRANSACTION`.
   - Subscription: `VIRTUAL`, 2× the per-period limit, `MONTHLY`.
   - An account-level daily cap of $500, where the sandbox supports it.
   - Lithic `MERCHANT_LOCKED` is deliberately **not** used. The onchain merchant lock is authoritative and has to stay
     observable. A Lithic-side lock could decline before our ASA is ever called.
   - If Lithic declines first, the UI says "Declined by card-network safety limit (sandbox)" and shows no onchain transaction.
7. **The ASA path fails closed.** Only `AUTHORIZATION` and `FINANCIAL_AUTHORIZATION` in USD can settle. Balance
   inquiries, credits and unknown statuses decline. A `$0` authorization (card verification) approves without
   settling. A card whose Lithic state is not `OPEN` declines.

## Card policy notes
- **Merchant lock.** A card created for a known store is **pre-locked at registration**, so a leaked card is
  declined everywhere else, even on its first use. A card for "another store" locks to the first merchant that
  successfully charges it.
- **Idle lock.** A store-locked or one-time card that goes unused for `idle_secs` (30 days on devnet) stops paying.
  The owner re-activates it with an explicit signature (`unfreeze_card`). Subscription cards are exempt; their
  recurring per-period cap governs them.
- **Freeze.** The owner or the settlement authority can freeze a card (reduce-only). Only the owner can unfreeze it.

## Product decision: refunds do not restore the limit (MVP)
A void or refund returns the USDC to your wallet, but **the card's consumed allowance stays consumed**.
SolSend never silently re-grants spending permission. To spend more, create a new card or top up the
allowance with your own signature. The UI states this on every refund.

## Privacy: what is public onchain
- **Public, and inherent to an onchain design:** the owner wallet, card PDAs, settle and refund amounts and their
  timing, and `merchant_hash`.
- `merchant_hash` = `sha256("solsend:merchant:v1:" + acceptor_id)`. It is a **pseudonym, not hiding**: merchant ids are
  low-entropy and public, so it only links repeat purchases at the same merchant.
- **Never onchain:** Lithic transaction tokens, card numbers, merchant names, emails.
- Each settle is tied to its authorization by a **commitment**,
  `auth_hash = sha256("solsend:auth:v1:" + lithic_token)`. The Lithic token is a UUIDv4 with 122 random bits, so
  the commitment hides the token from the public. Anyone who holds the token, such as the cardholder in the app,
  can recompute it and match it to the `CardSettled` event on the explorer. Settle transactions carry **no memo**.

## Offchain trust assumptions (stated honestly)
- **Authorization facts are attested by our ASA handler.** Lithic signs the authorization request to
  us (HMAC-verified). The merchant identity (`acceptor_id` → `merchant_hash`), the amount and the token
  come from that request. The program cannot verify Lithic's signature onchain.
- **A compromised settlement key** can, at worst, pull live cards **up to their remaining caps into the
  treasury PDA**. It cannot send funds anywhere else. The admin can pause settles and rotate the key.
- **The card ↔ Card PDA mapping** comes from Lithic card `tags`, written only by our server when the
  card is issued.
- **Treasury → card-network settlement** (fiat) is out of scope: sandbox only.
- **Card creation is not atomic across systems.** The onchain card is registered first; the Lithic
  card is issued afterwards and can be retried. An onchain card without a Lithic card can never be
  pulled, because nothing can authorize it.
- **Demo Merchant.** The sandbox-only checkout reads the sandbox card number **in server memory only**,
  to call Lithic's official simulation API. It is never returned to the browser, logged, stored or
  committed. It refuses any non-sandbox Lithic host, enforces bounded amounts and is rate-limited.
- **Devnet is not mainnet.** There is no reorg handling beyond `confirmed` commitment, and the
  QuickNode stream runs only during test and demo windows (`GATE0.md`).
