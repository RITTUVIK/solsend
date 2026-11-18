# W2 evidence: free-trial card expiry, plus SUBSCRIPTION / ONE_TIME live checks

Wed 2026-11-18, 15:59–16:04 UTC. Solana **devnet** (QuickNode devnet RPC, endpoint redacted).
Program `GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp` (Upgrade 1). Owner `DEGx8bvPLZQDS65xbw79My2tV97cfqsKQfGos6Nq3nWe` (card-a-owner).
**No Lithic calls.** The live ASA checks are **MOCK**: locally signed ASA requests to local `next dev` → REAL devnet settles.

## How expiry works
- A free-trial card's Allowances delegation carries `expiry_ts` (`PrepareCardRequest.expiresInMinutes` → `now + minutes·60`; 0 = none).
- After `expiry_ts`, every pull fails **onchain** inside the Allowances program with **Custom 128 = `delegationExpired`** (0x80).
  This is per the pinned upstream IDL error table, and proven below.
- The ASA maps it to `CARD_PAUSED`, reason **"card expired (free trial ended)"**.
  - That text is stored in `authorizations.reason`, so the Demo Merchant shows the same reason.
- `CardView.expiresAt` / `expired` are read from the delegation account, and an expired card is never shown as usable.

## 1. Proof with the shared builders only (`scripts/ops/expiry-proof.ts`, PASS)

| Step | Result | Devnet signature |
|---|---|---|
| create the card: FixedDelegation 1.00 USDC with `expiry_ts` = chain now + 120 s (16:01:47Z), plus `register_card` | ok, slot 523683066 | [`41DPkYJ7…`](https://explorer.solana.com/tx/41DPkYJ7zTQi2Lb7vTircqD3S7WK6srHvL7AGV8KZuCZH7tmsU5jNfDq7DohfUoYih3Tc4XSetM263GneKiuwQoM?cluster=devnet) |
| settle 0.10 **before** expiry (block time 15:59:49Z) | **ok** | [`3BovUnii…`](https://explorer.solana.com/tx/3BovUniidkydXRQMBfFY9KMdv38hSsKyfsADmv12FtvpwdDAoy4mG1f8eJADSM2GZ2xjwwXg65rVRDKYTwuu3CDt?cluster=devnet) |
| settle 0.10 **after** expiry (block time 16:01:52Z) | **failed `InstructionError [1, Custom 128]`**. Log: `Program De1egAFM… failed: custom program error: 0x80` | [`42fhAuNK…`](https://explorer.solana.com/tx/42fhAuNKvytc4iR6sRaH9RTsRNNXqqaqskG2k4z7yf7JL7AMC5yLFTs7cN2JJJzkKQCuHEvrGC1pVgECVVJCtd8W?cluster=devnet) |
| cleanup refund of the 0.10 (refunds still work on an expired card) | ok | [`35JA1a6V…`](https://explorer.solana.com/tx/35JA1a6VP6YLdH5FLBNtDFCBEYrDyyWH5LXw4SUmyZCnCWjcy28hLwjtHCrLjHQYV56dZ9RrBPudTvRhkZo48ES1?cluster=devnet) |

Card `ADRzZjcP3FwvaUfiGbd8NjyEosvuxfWXvKZ2VaqxYzwx` (cardId 11086586735857990512).

## 2. The same expiry through the app path (MOCK ASA → local next dev)

The card was created through OUR `prepareCard` with `expiresInMinutes: 2`, then submitted via `submitTx`:
card `JECpnrF6jLwdstpDv4b6eknEvTnKUREZhPxBm8R7ohwR`, register tx `2aWFjsTg…`. It is preset-locked to Netflix.

| MOCK request | ASA reply | Devnet |
|---|---|---|
| $0.50 before expiry | `APPROVED` settled_confirmed (confirmed_at 16:01:55.130Z ≤ replied_at 16:01:55.130Z) | settle `5byQend5…` |
| $0.50 after expiry | **`CARD_PAUSED` card_expired** → "card expired (free trial ended)" | failed `5VgRskXb…`, no record |

## 3. Previously untested paths (MOCK ASA → local next dev → REAL devnet)

| Card | MOCK request | ASA reply | Devnet |
|---|---|---|---|
| SUBSCRIPTION $3.00 / 30 days, `2N1Fmice…` (register `4eNCJwRd…`) | $1.00 | `APPROVED` settled_confirmed | settle `4oRmqrVeHWU77NWNWrj8GdVRgHaUu9gqW2k5F525dFLW3xcEriMNusjfukFXp5sY9uS49cWHcS4bwL1cx17gqJR1` |
| same | $2.50 (only $2.00 left this period) | **`VELOCITY_EXCEEDED`** period_limit_exceeded (Allowances 400) | failed `E1tFKiV4WLSYUvzxStwM6q2aaFirArR8emT1FeAyE51TuoZg7QD8hbDVLgHqzCku2DbB1jwwTkTHJKzBPzQP19q`, no record |
| ONE_TIME $2.00, `EBqbBrBT…` (register `8Saq91bS…`) | $1.00 | `APPROVED` settled_confirmed | settle `4coZX2NM92VnjFqdTiXPmyDmGhUoWmNzGbdmwwimB6DH1QA1bvq72fWrMqYhPhovQjfZWzdn2MxzxNWP9i7L74Vg` |
| same | second request, $0.50 | **`CARD_PAUSED`** card_not_active (SolSend 6003, card Used) | failed `2iwZzJFERLEnuknstQ22vutgjgj2SyTFAvSoiMD3gxGuiHCJSnjeYiWHsYvrdS2VRHf8TJhMcnahPdNJnqEaSf1N`, no record |

## Remaining limit in Activity without QuickNode
After an APPROVED settle, the ASA after-hook reads the Card PDA and the delegation in one batched call, off the hot path.
It writes `remaining_base` on the `authorization_approved` feed row:

- a USED one-time card → `0`;
- a recurring card → the period-aware remaining;
- otherwise → the delegation's remaining.

This is unit-tested in `apps/web/src/server/cards/expiry.test.ts`.
