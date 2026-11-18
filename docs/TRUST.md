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
| **Admin** (deployer key, devnet) | Pause or unpause settles (kill switch; refunds keep working). Rotate the settlement authority. `admin_withdraw` treasury funds **only to `treasury_destination`, which is fixed at initialization** (stand-in for the issuer's settlement account). | Touch user wallets or delegations. Change a card's limits or source account. Redirect withdrawals. |
| **Fee payer** (server key) | Pay fees and rent for **server-built** transactions. It co-signs only a message byte-identical to a stored, unexpired, unconsumed intent (CP0b G0.8). | Move user funds. Sign arbitrary transactions. |
| **Program upgrade authority** (deployer key) | Upgrade the SolSend program on devnet. **This is the largest trust assumption**; freezing the program after the hackathon is the mitigation. | — |

## Invariants (tested; never weakened)
1. **Confirmed-before-approve.** The Lithic ASA reply is `APPROVED` only after the settle transaction is
   **confirmed** on devnet, or when an existing SettlementRecord for the same authorization is readable at
   confirmed commitment. Everything else declines, including errors, timeouts and unknown state.
2. **Atomic idempotency.** One SettlementRecord PDA per (card, sha256(lithic_token)). A duplicate
   authorization cannot pull twice.
3. **Correct refunds.** A refund goes only to `card.source_token_account` and is capped at
   `record.amount − record.refunded`.
4. **Late settles are refunded.** If a settle confirms after we declined or timed out, the reconciler
   refunds it. The reconciler's source of truth is the **Lithic transaction status** (`DECLINED`,
   `VOIDED` or `EXPIRED` → refund the remainder), not our database.
5. **Fail-closed.** There is a hard ASA deadline, below Lithic's 6 s limit. Timeouts decline.
6. **The chain is the only spending policy.** Lithic cards are issued without Lithic spend limits or
   merchant locks, so every approve or decline is decided by the onchain `settle` result. Declines carry
   the failed devnet transaction signature as evidence.

## Product decision: refunds do not restore the limit (MVP)
A void or refund returns the USDC to your wallet, but **the card's consumed allowance stays consumed**.
SolSend never silently re-grants spending permission. To spend more, create a new card or top up the
allowance with your own signature. The UI states this on every refund.

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
  QuickNode trial has its own limits (`GATE0.md`).
