# Live rehearsal on the deployed app (2026-11-18)

A teammate ran the demo script on https://solsend-ashen.vercel.app with a real Privy email login, real Lithic **sandbox** card authorizations (demo store), and Solana **devnet** USDC. The lead then checked every result independently: what the deployed backend stored in Supabase, the onchain account state, and each transaction's USDC balance changes (`getTransaction` pre/post token balances). The checks used read-only scripts: `scripts/program/card-state.ts`, `scripts/program/auth-state.ts`, and a signature/balance verifier.

Presenter wallet: `FB5ovrafjpVcnEfDkPckDTwu6pxnn8eUzU7SuguLQH6P`. Its USDC account is `Dp2LcNda…`.

| # | Beat | Devnet transaction | Onchain result | USDC moved |
|---|---|---|---|---|
| R1 | Netflix free-trial card created ("2 minutes (demo)" expiry) | [`5yqAbqM2…`](https://explorer.solana.com/tx/5yqAbqM26s8CHz6KqCoRzxW1yr6EC6foRM7FaoFnYa5DVC31jg2MU9Uf2Zf77y3AsAHR4PvHM7MMGk4aYZAPGAue?cluster=devnet) | ok | none |
| R2 | $1.00 Netflix charge after the trial ended → declined "card expired (free trial ended)" | [`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet) | failed: Allowances `delegationExpired` (Custom 128) | none |
| R3 | $40 Temu card created | [`jcLjGimb…`](https://explorer.solana.com/tx/jcLjGimbMsdVzAZszFymm7LXx5FEbeQ3Fdejdd21DhWnLsjYtz4g8pu2DkEkPNiW4vETX81AtB6vonsNa3hMFLY?cluster=devnet) | ok | none |
| R4 | $12 Temu earbuds → approved after the settle confirmed (ASA total 915 ms) | [`2QT4k4cK…`](https://explorer.solana.com/tx/2QT4k4cKpZiZKCRRPpVyEaMTCU6qibDfwQj9wqoq5fgp5NwaLnrjqHW2tY3TcuaCCHKXZ3A6K29bUttAnDYvzBee?cluster=devnet) | ok | wallet −12.00 → treasury +12.00 |
| R5 | $5 at Amazon with the Temu card's number → declined | [`ko4XZjax…`](https://explorer.solana.com/tx/ko4XZjaxq6btWc4mnojTe1VzPvf9p8KBkfZpkEE6t3JNdyJJNZDfdTaD2H6otsReMQjFWajat1uVoxKKzMfvLTP?cluster=devnet) | failed: SolSend `MerchantMismatch` (6005) | none |
| R6 | $45 Temu drone with $28 left → declined | [`b6sGxACn…`](https://explorer.solana.com/tx/b6sGxACnkkYBm9Lnm9huRqgZ1iNn4A4bjFwAg7zm4PRBFgHrv5a5LZBamJbDDaRidtcdYi8wK5bHXPz2S66r7s9?cluster=devnet) | failed: Allowances over cap (Custom 300) | none |
| R7 | Void of an earlier $1.14 Temu purchase (from Activity) | [`63fBvpBw…`](https://explorer.solana.com/tx/63fBvpBwpFd8cr2iaZoeSaiK5DfJpMhHKA6cqURAJnincqicdhUU4KX1tmvhjp3t1VzZG795pFKFwKg2h76d7mB?cluster=devnet) | ok. SettlementRecord amount 1.14, refunded 1.14 (cannot refund again). The refund went to the card's stored source account, which is the owner's own USDC account. | treasury −1.14 → wallet +1.14 |

State read back after the rehearsal: the Temu card has $28.00 remaining on its fixed allowance (40 − 12) and the wallet holds 13.00 USDC.

R2 is the first **live card-network** run of free-trial expiry: a real Lithic sandbox authorization reached the deployed ASA handler. The earlier proof in [w2-free-trial-expiry.md](w2-free-trial-expiry.md) used locally signed (MOCK) ASA requests.

## Two bugs found and fixed (commit `0e4cf98`)

1. **Revoke all was blocked.** The confirmation sheet is a native modal `<dialog>`. Browsers draw a modal dialog in the top layer and make the rest of the page inert. The sheet stayed open while Privy's approval window opened, which covered Privy's window and made it unreachable by mouse or Tab.
   - **What happened onchain:** nothing was submitted. The backend shows two `revoke_all` intents (18:08:21 and 18:08:44 UTC), both unsigned and expired. No revoke transaction touches the wallet. All three cards were still ACTIVE with live allowances.
   - **Fix:** the sheet now closes before signing starts, and progress shows inline.
   - **Regression test:** the mock wallet now behaves like Privy's window, and the end-to-end test must click it. That test fails on the old code (a modal dialog is still open) and passes on the fix. It also covers cancel and retry.
2. **Card details stayed masked.** Lithic's modern embed iframes render **masked by default**. Revealing the details requires the official `lithic-embed` SDK's `toggleMasking()`, which sends a `postMessage` to Lithic's origin; the details are then fetched inside Lithic's frame. We had rendered raw iframes, so nothing could reveal them.
   - **Fix:** the card back now mounts the fields with the SDK (pinned `0.1.0-beta.1`, tarball reviewed) and reveals them when the owner taps Details.
   - **Data handling:** PAN, CVV and expiry stay inside Lithic's origin. SolSend only relays the single-use session, which is never logged.
   - **Verification status:** the reveal against live Lithic still needs a check in the cardholder's own browser. We deliberately did not reveal card data in automation.
