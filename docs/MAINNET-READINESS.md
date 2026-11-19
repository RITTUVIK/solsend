# Mainnet readiness: what stands between this demo and real money

*Reviewed 19 November 2026. SolSend runs on Solana devnet with Lithic sandbox cards. Nothing here is on mainnet, and no real money has moved.*

We looked hard at putting part of SolSend on mainnet before the hackathon deadline and decided not to. This page says why, what we verified instead, and what has to be true first. The review was AI-assisted (separate review agents working from the code and from public sources) and is not a professional audit.

## The short answer

| Level | What it would mean | Where it stands |
|---|---|---|
| A | A real allowance and a real USDC transfer on mainnet | The permission layer is live there today. Solana's Subscriptions & Allowances program runs on mainnet at the same address we use on devnet. Our own program is not deployed there. |
| B | This app pointed at mainnet, card authorizations still simulated | **Not safe as built.** Real USDC would move on simulated swipes into a treasury that has no way to pay anyone out, and the test-money faucet would hand out real USDC. |
| C | Cards a real store accepts | **Weeks away at best.** Every route needs a legal entity, a signed program agreement, a sponsor bank and card-network approval. |
| D | A public financial product | **Months.** Licensing or a licensed partner, KYC and AML, dispute handling, reserves, and a professional audit. |

## What we verified without touching mainnet

- **The devnet and mainnet builds of the Allowances program are different.** Mainnet (133,856 bytes, deployed in slot 438,440,823) is the audited one: its bytes, with trailing padding removed, hash to `056ca97c…0318`, the hash [OtterSec's service](https://verify.osec.io/status/De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44) verified against the public source. Devnet (133,280 bytes, slot 506,642,674) is a newer build.
- **Our program works against both.** All 41 program tests pass against the devnet build and against the mainnet build, in a local Solana VM, with no transaction sent to either network.

Reproduce it:

```bash
bash scripts/program/fetch-allowances.sh            # devnet build
bash scripts/program/fetch-allowances.sh mainnet    # mainnet build (read-only RPC)
pnpm test:program                                   # 41 tests, devnet build
pnpm test:program:mainnet                           # the same 41 tests, mainnet build
```

This is a statement about compatibility, not about deployment: it shows that the store lock, the caps, the one-pull-per-payment record and the refund rules behave the same on the build that holds real money.

## Why we did not deploy

1. **Our program has not had a professional audit, and one key can upgrade it.** Every card's delegatee is an address our program controls. Whoever holds the upgrade key could change what the program does with each card's remaining limit and with the treasury. That is fine for test money. For real money the key must be frozen or moved to a multisig first.
2. **A mainnet transfer that no card decision depends on would be for show.** The honest version of "real money" is the whole loop, and the card half of that loop cannot be real this week.
3. **"Real USDC" next to simulated card authorizations is a mixed message.** We would rather show one thing clearly: a complete sandbox, with every result a public transaction.

## What must be fixed before real money

From the 19 November review. Severity is for a public product holding real funds.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Critical | The program's upgrade authority is a single key | Multisig or freeze; then a professional audit |
| 2 | High | The treasury has no way out except refunds, so it cannot settle with a card issuer | A capped, audited settlement path to the issuer |
| 3 | High | Two rare paths can leave a late settlement unrefunded until someone runs the reconciler by hand: the database write after a reply fails, or a settle lands more than about 30 seconds after a decline | Write the authorization before replying; reconcile from the chain as well as from the database; alert on any settlement with no approved authorization (our QuickNode Stream cross-check already raises that alert) |
| 4 | High | The settlement key alone can pull each live card up to its limit into the treasury. It cannot send funds anywhere else | Move the key to a hardware-backed signer; cap pulls per time window onchain |
| 5 | Medium | The wallet's one token approval to the Allowances program is unlimited and is never revoked | Revoke it when the last card closes; say so in the app |
| 6 | Medium | Approvals wait for `confirmed`, not `finalized` | Keep `confirmed` (finality is too slow for a card deadline), keep per-payment caps low, alert if a settle fails to finalize |
| 7 | Medium | No priority fees | Add them before mainnet congestion makes settles miss the deadline |
| 8 | Medium | The final cleared amount is never compared with what was pulled | Reconcile clearing against settlement: tips, fuel and hotel holds, partial captures, charges posted without an authorization |
| 9 | Medium | Rent for cards and payment records is never reclaimed, and fees are sponsored without strong limits | Close instructions; per-user sponsorship limits |
| 10 | Low | The devnet-only guard checks the RPC address, not the network's identity | Check the genesis hash at start-up |

What held up: every instruction validates every account, the call into Allowances pins the program address, a payment can pull only once, refunds go only to the account the money came from, and arithmetic is checked. The reviewer found no way for someone who holds none of our keys to take funds through the program as deployed.

## The card side

A just-in-time USDC pull covers one moment: the authorization. Real card networks also clear for different amounts than they authorized, post charges with no authorization, approve on the issuer's behalf when its endpoint is slow, and reverse payments weeks later through disputes. The program owner carries those losses and normally holds a reserve against them.

We found no issuer today that honours several independently scoped onchain permissions on one wallet. The closest stablecoin card programs use one wallet-level approval and keep per-card limits in their own systems. So a production SolSend needs an issuing partner willing to authorize against per-card onchain permissions, or its own program with a sponsor bank.

## Order of work

1. Multisig upgrade authority, hardware-backed settlement key, genesis check, authorization written before the reply.
2. Professional audit of the program and the payment path.
3. A small closed pilot on mainnet with the team's own funds and low caps.
4. An issuing partner: sandbox first, then production testing with employee cards.
5. Clearing and dispute handling, reserves, licensing or a licensed partner.
