# Devpost submission (UBC 2026)

Deadline: Fri 2026-11-20 12:00 PM CST. The five questions below are the ones the guide asks, verbatim. Each answer is 150 words or fewer. Copy, then re-check against the live app before submitting.

## Short description (200 characters or fewer)

A burner card for every store. Each card is an onchain Solana allowance that holds $0: capped, store-locked, revocable in one transaction. Sandbox cards, devnet USDC.

## Project name

SolSend

## Tagline

A burner card for every store — your money stays in your wallet until the moment you pay.

## What did you build?

SolSend is a burner-card app on Solana. You log in with email, create a card for a store, and pay with it like any card. Each card is an allowance in Solana's official Subscriptions & Allowances program, capped and locked to one store from creation; it holds $0 and your USDC stays in your wallet until the moment you pay. When a card is swiped, our server settles USDC onchain through our Anchor program and approves only after the transaction confirms. Free-trial cards expire onchain on their own. You can freeze, close or revoke every card in one transaction. It is a demo: Lithic sandbox cards and Solana devnet test USDC, no real merchant is charged.

## What problem does it solve?

Saved cards are liabilities. Numbers leak, stores get breached, and free trials quietly become subscriptions; consumers underestimate subscription spending by $133 a month and 42% pay for one they stopped using (CNBC, 2022). Prepaid and burner cards help, but make you pre-fund a balance held by an issuer, and when an issuer winds down (as Solflare's card issuer did) the card stops. Existing self-custodial Solana cards use one delegation per wallet, so one leak exposes everything. SolSend gives each store its own capped, locked allowance. Your blast radius is the sum of your caps: the most a hacked store, a leaked number, or even our own server can pull.

## How does it work?

Creating a card is one owner signature: an Allowances delegation whose only delegatee is a SolSend Card PDA, plus a card registration; our server pays fees. A Lithic sandbox card is issued alongside. On a swipe, Lithic calls our webhook, we send a `settle` transaction, and the program pulls USDC through the allowance into a treasury PDA, recording one permanent settlement record per authorization. We reply APPROVED only after the transaction confirms (hosted cold start 2.4 s against Lithic's 6 s limit); otherwise we decline. Voids refund onchain to your wallet. A QuickNode Stream on our program feeds the live activity page. Each payment must match the store ID the card network reports; our server relays it, Solana enforces the lock and the cap.

## What makes it unique?

One allowance per card, not one delegation per wallet, so caps and store locks are enforced by a Solana program rather than a company's database. The card holds $0: nothing to pre-fund, nothing for an issuer to lose, and revoke-all is one transaction sent straight to Solana's audited Allowances program, not ours. Free-trial cards expire onchain: after expiry every pull fails inside the Allowances program (a live sandbox charge after expiry, declined onchain: [`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet)). We approve only after a confirmed settle, with a permanent replay guard per authorization. 41 LiteSVM tests and two AI-assisted security reviews, all findings fixed. Limits: sandbox, devnet, a trusted server relay, an upgradeable devnet program.

## What would you build next?

First, freeze the program or move to a multisig upgrade authority and commission a professional audit before any mainnet use. Second, partner with a real card issuer, which brings compliance work, so SolSend can move from a sandbox to cards people use every day at real stores. Third, a refund-aware treasury with capped withdrawal and real treasury-to-issuer settlement, plus incremental authorizations and partial captures. Fourth, recurring-pull UX: clear previews of each upcoming subscription charge, so a subscription card shows what it will pull and when. Finally, an opt-in setting to restore a limit after a refund.

## Track, chain award, bounty

| | |
|---|---|
| Track | Consumer Applications |
| Chain award | Best use of Solana (program IDs: SolSend `GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp`, Allowances `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`; both devnet; see the README) |
| Bounty | QuickNode Streams (configuration in the README: network, dataset, filter, destination, and why) |

## Technologies

Solana (devnet), Anchor (Rust), Solana Subscriptions & Allowances program, SPL Token (USDC), LiteSVM, QuickNode (devnet RPC and Streams), Lithic (sandbox card issuing and ASA), Privy (email login, embedded wallets), Next.js 15, React 19, Tailwind CSS, TypeScript, Zod, Supabase (Postgres), Vercel, Playwright, Vitest, GitHub Actions, gitleaks.

## Links

| | |
|---|---|
| Live app (devnet + sandbox) | https://solsend-ashen.vercel.app |
| Repository | TODO: repository URL (must be public before submission) |
| Demo video | TODO: unlisted YouTube or Drive link (see [VIDEO-PLAN.md](VIDEO-PLAN.md)) |
| SolSend program (devnet) | https://explorer.solana.com/address/GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp?cluster=devnet |
| Evidence index | [EVIDENCE.md](EVIDENCE.md) |

## Team

TODO: team members and roles (names to be filled in by the team).

## Submission checklist

- [ ] Repo public; README renders; no secrets (gitleaks clean)
- [ ] Video 2 to 3 minutes, link works in a private window
- [ ] All five answers pasted; each 150 words or fewer
- [ ] Track, chain award and bounty selected
- [ ] `/api/status` green and the QuickNode stream state noted (paused outside demo windows)
- [ ] Free-trial expiry proof links checked: the live Lithic-driven decline from the 2026-11-18 rehearsal ([`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet), [rehearsal-2026-11-18.md](evidence/rehearsal-2026-11-18.md)) and the direct program-level devnet test (scripts/ops/expiry-proof.ts)
