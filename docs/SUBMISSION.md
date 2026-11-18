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

Saved cards are liabilities. Numbers leak, stores get breached, and free trials quietly become subscriptions; consumers underestimate subscription spending by $133 a month and 42% pay for one they stopped using (CNBC, 2022). Burner cards help, but Privacy.com, the best-known, needs a US bank account and keeps the limits in its own systems. Cards that spend digital dollars from your own wallet exist, but the ones we could document give you one card backed by one approval for the whole account, so a single leak reaches the whole approved amount. SolSend gives each store its own capped, store-locked allowance. The most a hacked store, a leaked number, or even our own server can ever pull is the sum of your caps.

## How does it work?

Creating a card is one owner signature: an Allowances delegation whose only delegatee is a SolSend Card PDA, plus a card registration; our server pays fees. A Lithic sandbox card is issued alongside. On a swipe, Lithic calls our webhook, we send a `settle` transaction, and the program pulls USDC through the allowance into a treasury PDA, recording one permanent settlement record per authorization. We reply APPROVED only after the transaction confirms (hosted cold start 2.4 s against Lithic's 6 s limit); otherwise we decline. Voids refund onchain to your wallet. A QuickNode Stream on our program feeds the live activity page. Each payment must match the store ID the card network reports; our server relays it, Solana enforces the lock and the cap.

## What makes it unique?

As far as we could find, this is the first working demo in which every card is its own capped, expiring, store-bound allowance in Solana's Subscriptions & Allowances program, so each limit is a separate permission you can revoke from your own wallet rather than a rule in an issuer's database. The Solana Foundation named card-linked spending as a use for the program; we take it to one allowance per card. The card holds $0, nothing is pre-funded, and revoke-all is one transaction sent straight to the Allowances program, not ours. Free-trial cards expire onchain: after expiry the trial cannot charge that card (a live sandbox charge after expiry, declined onchain: [`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet)). 41 LiteSVM tests and two AI-assisted security reviews, all findings fixed. Limits: sandbox, devnet, a trusted server relay, an upgradeable devnet program.

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

**Draft: both teammates must confirm every sentence before it is submitted. Do not add anything that did not happen.**

- **Ritty** (Rithvik Balavikram): proposed the original idea (a temporary virtual card funded with USDC), created the repository, and leads the pitch, demo video and submission.
- **Darren** (Darren Deepak): led product and engineering. Set the requirements, reviewed and approved the architecture at each checkpoint (including moving from a Stripe + Bridge card program to Lithic, and building on Solana's Allowances program), created and configured the provider accounts (Lithic, QuickNode, Privy, Supabase, Vercel), ran the live rehearsals, and approved each release.

## AI assistance (disclosure)

Most of SolSend's code, tests and documentation were written by Claude Code, Anthropic's AI coding agent, working under Darren's direction in this event's window (repository created 16 November 2026). The two security reviews were done by separate AI review agents; they are not a professional audit. The commit history records this: 75 of the 76 commits carry a Claude co-author trailer. The humans decided what to build, approved the design at each checkpoint, tested it on the live deployment, and decided what shipped.

Open question for the organizers (ask before submitting, in the hackathon Telegram): the Devpost rules reportedly say "AI tools may be used, but builders must remain the primary creators." We read that as allowing an AI-written codebase directed by the team, but it is the organizers' call, not ours.

## Submission checklist

Owner in brackets. Darren = engineering, Ritty = repository owner, pitch, video and submission.

- [ ] **[Both]** Ask the organizers (hackathon Telegram) about the AI rule before submitting, quoting the disclosure above; confirm the Devpost eligibility wording ("Students only" in the header vs a broader rules body)
- [ ] **[Both]** Confirm every sentence of the Team and AI-assistance sections above
- [ ] **[Ritty]** Choose a license (MIT is the usual hackathon choice) or decide to publish without one; add `LICENSE` before going public if chosen
- [ ] **[Ritty]** Update the GitHub repository description (it still describes the original browser-extension idea), e.g. "Burner cards for every store: capped, store-locked onchain allowances on Solana (sandbox + devnet)"; website https://solsend-ashen.vercel.app
- [ ] **[Ritty]** Make the repository public only after the final secret scan on the release commit; README renders on GitHub
- [ ] **[Ritty]** Video 2 to 3 minutes, recorded on the live app per [VIDEO-PLAN.md](VIDEO-PLAN.md); the QuickNode badge appeared for real; no full card number, CVV or email on screen; link works in a private window
- [ ] **[Ritty]** All five answers pasted; each 150 words or fewer; Team section filled
- [ ] **[Ritty]** Track: Consumer Applications · chain award: Best use of Solana · bounty: QuickNode Streams, and opt in to each on Devpost
- [ ] **[Darren]** `/api/status` green; QuickNode stream state decided (paused outside demo windows, or left on through judging if credits allow)
- [ ] **[Both]** Free-trial expiry proof links checked: the live Lithic-driven decline from the 2026-11-18 rehearsal ([`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet), [rehearsal-2026-11-18.md](evidence/rehearsal-2026-11-18.md)) and the direct program-level devnet test (scripts/ops/expiry-proof.ts)
- [ ] **[Both]** Submit by Thursday 21:00 CST; hard deadline Fri 2026-11-20 12:00 PM CST; someone must be in Austin for the closing ceremony to receive any prize
