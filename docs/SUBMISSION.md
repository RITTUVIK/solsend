# Devpost submission (UBC 2026)

Deadline: Fri 2026-11-20 12:00 PM CST. The five questions below are the ones the guide asks, verbatim. Each answer is 150 words or fewer. Copy, then re-check against the live app before submitting.

## Short description (200 characters or fewer)

A burner card for every store. Each card is an onchain Solana allowance that holds $0: capped, store-locked, revocable in one transaction. Sandbox cards, devnet USDC.

## Project name

SolSend

## Tagline

A burner card for every store — your money stays in your wallet until the moment you pay.

## What did you build?

SolSend is a burner-card app on Solana. You log in with email, create a card for a store, and pay with it like any card. Each card is its own capped allowance in Solana's official Subscriptions & Allowances program, locked to one store by our program from creation; it holds $0 and your USDC stays in your wallet until the moment you pay. When a card is swiped, our server settles USDC onchain through our Anchor program and approves only after the transaction confirms. Free-trial cards expire onchain on their own. You can freeze, close or revoke every card in one transaction. It is a demo: Lithic sandbox cards and Solana devnet test USDC, no real merchant is charged.

## What problem does it solve?

Saved cards are liabilities. Numbers leak, stores get breached, and free trials quietly become subscriptions; consumers underestimate subscription spending by $133 a month and 42% pay for one they stopped using (CNBC, 2022). Burner cards help, but Privacy.com, the best-known, needs a US bank account and keeps the limits in its own systems. Cards that spend digital dollars from your own wallet exist, but the ones we could document give you one card backed by one spending approval shared by every store, so a single leak reaches the whole approved amount. SolSend gives each store its own capped, store-locked card. The most a hacked store, a leaked number, or even our own server can pull is the sum of your caps.

## How does it work?

Creating a card is one owner signature: an Allowances delegation whose only delegatee is a SolSend Card PDA, plus a card registration; our server pays fees. A Lithic sandbox card is issued alongside. On a swipe, Lithic calls our webhook, we send a `settle` transaction, and the program pulls USDC through the allowance into a treasury PDA, recording one permanent settlement record per authorization. We reply APPROVED only after the transaction confirms (0.9 s in our live run; Lithic allows 6 s); otherwise we decline. Voids refund onchain to your wallet. A QuickNode Stream on our program is an independent witness: it delivers each event from the chain's own log and cross-checks every settlement against the card authorization. Each payment must match the card's store ID, which our server relays from the authorization (our demo store sets it in this sandbox); Solana enforces the lock and the cap.

## What makes it unique?

As far as we could find, this is the first working demo that backs each payment card, here a Lithic sandbox card, with its own capped, expiring delegation in Solana's Subscriptions & Allowances program, plus a store lock enforced by our own program. Capped, expiring allowances per AI agent already exist on that program (BudgetRail, for example); we found none tied to individual payment cards. The Solana Foundation named card-linked spending as a use; we take it to one permission per card. The card holds $0, nothing is pre-funded, and you can revoke each permission yourself. Free-trial cards expire onchain (a live sandbox charge after expiry, declined: [`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet)). Our 41 program tests pass against both the devnet and the OtterSec-verified mainnet build of Allowances. Two AI-assisted security reviews, every High, Medium and Low finding fixed. Limits: sandbox, devnet, a trusted server relay, an upgradeable devnet program.

## What would you build next?

First, freeze the program or move to a multisig upgrade authority and commission a professional audit before any mainnet use; the full list is in docs/MAINNET-READINESS.md. Second, partner with a real card issuer, which brings compliance work, so SolSend can move from a sandbox to cards people use at real stores. Third, meet people where they shop: a checkout browser extension (SolSend's original idea) that makes a card for the store you are on, designed so card details stay in the issuer's secure fields, and funding by card or bank through an on-ramp so nobody needs to hold crypto first. Fourth, a refund-aware treasury with real treasury-to-issuer settlement, plus incremental authorizations and partial captures. Finally, clear previews of each upcoming subscription charge, and an opt-in setting to restore a limit after a refund.

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
| Repository | https://github.com/RITTUVIK/solsend (public) |
| Demo video | Added at submission (unlisted YouTube) |
| SolSend program (devnet) | https://explorer.solana.com/address/GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp?cluster=devnet |
| Evidence index | [EVIDENCE.md](EVIDENCE.md) |

## Team

**Draft: both teammates must confirm every sentence before it is submitted. Do not add anything that did not happen.**

- **Ritty** (Rithvik Balavikram): proposed the original idea (a temporary virtual card funded with USDC), created the repository, and leads the pitch, demo video and submission.
- **Darren** (Darren Deepak): led product and engineering. Set the requirements, reviewed and approved the architecture at each checkpoint (including moving from a Stripe + Bridge card program to Lithic, and building on Solana's Allowances program), created and configured the provider accounts (Lithic, QuickNode, Privy, Supabase, Vercel), ran the live rehearsals, and approved each release.

## If the form asks about AI tools

The rules say: "AI tools may be used, but builders must remain the primary creators." Answer any question about AI use plainly:

AI coding tools were used throughout, as the event allows. Most of the code, tests and documentation were written with an AI coding agent (Claude Code) under our direction, and the commit history shows it. We set the requirements, chose and approved the architecture, configured every provider account, ran the live tests and decided what shipped. The two security reviews were AI-assisted and are not a professional audit.

## Submission checklist

Owner in brackets. Darren = engineering, Ritty = repository owner, pitch, video and submission.

- [ ] **[Both]** Decide whether to ask the organizers about the "primary creators" wording before submitting; confirm you both meet the Devpost eligibility line ("Students only")
- [ ] **[Both]** Confirm every sentence of the Team section above, and of the AI answer if the form asks for one
- [ ] **[Ritty]** Choose a license (MIT is the usual hackathon choice) or decide to publish without one; add `LICENSE` before going public if chosen
- [ ] **[Ritty]** Update the GitHub repository description (it still describes the original browser-extension idea), e.g. "Burner cards for every store: capped, store-locked onchain allowances on Solana (sandbox + devnet)"; website https://solsend-ashen.vercel.app
- [x] **[Ritty]** Repository is public (since 18 November); the secret scan runs in CI on every push. Check that the README renders on GitHub
- [ ] **[Ritty]** Video 2 to 3 minutes, recorded on the live app per [VIDEO-PLAN.md](VIDEO-PLAN.md); the QuickNode badge appeared for real; no full card number, CVV or email on screen; link works in a private window
- [ ] **[Ritty]** All five answers pasted; each 150 words or fewer; Team section filled
- [ ] **[Ritty]** Track: Consumer Applications · chain award: Best use of Solana · bounty: QuickNode Streams, and opt in to each on Devpost
- [ ] **[Darren]** `/api/status` green; QuickNode stream on for the recording and the finals demo, paused otherwise
- [ ] **[Darren]** The test-money faucet wallet holds devnet USDC (each new user's claim takes 5); top it up from Circle's devnet faucet through Saturday
- [ ] **[Both]** Free-trial expiry proof links checked: the live Lithic-driven decline from the 2026-11-18 rehearsal ([`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet), [rehearsal-2026-11-18.md](evidence/rehearsal-2026-11-18.md)) and the direct program-level devnet test (scripts/ops/expiry-proof.ts)
- [ ] **[Both]** Submit a complete entry Thursday night and edit it Friday morning if needed; stop changing things at 11:00 AM; hard deadline Fri 2026-11-20 12:00 PM CST; someone must be in Austin for the closing ceremony to receive any prize
