# Positioning: where SolSend sits

SolSend is a **burner card per store whose limit is its own allowance on Solana, funded straight from your own wallet**. Burner cards are a solved problem in fiat, self-custodial crypto cards exist, and card limits enforced by a Solana program exist. What we did not find anywhere is the combination: **every payment card has its own capped, expiring allowance that the user creates and can revoke from their own wallet, plus a store lock enforced by a program.** This page states only what its sources support. "Not established" means our sources do not say, not that the answer is no. The sandbox and devnet caveats in the [README](../README.md) apply to SolSend itself: the products below are shipping, and SolSend is a demo.

*Sources re-checked on 2026-11-18.*

## Comparison

| | Custody | A card per merchant | Where the limit is enforced | If the issuer fails | Cards per user |
|---|---|---|---|---|---|
| **Privacy.com** [1][2] | Fiat. Funded from a linked US bank or debit card; US residents only. Its parent company is Lithic, the issuer API our sandbox uses | Yes: merchant-locked and single-use cards | The company's systems | n/a (fiat) | Many |
| **Rain scoped cards** (launched 2026-11-10) [3] | Stablecoin balance held for the cards (pre-funded vault) | Yes: "a fixed amount, merchant, and expiry" per card | Rain's authorization engine ("checked by Rain at authorisation") | Not established | Many; sold for AI agents |
| **Bridge cards program** (used by Phantom's card) [4] | Self-custodial: one token approval to a program-derived delegate | Not established (the program has a `merchant_id`, but its README does not define it) | A Solana program: per-transaction and per-period limits set by the issuer | Not established | One delegate per token account |
| **MoonPay MoonAgents Card** [5] | Self-custodial: spends from your Solana wallet up to the SPL Approve allowance you set | Not established | The allowance amount (one SPL approval) | Not established | One per user at launch; "Multi-card support is on the roadmap" |
| **MetaMask Card** [6][7] | Self-custodial: a spending-cap approval; funds stay in the account until spent | Not established | The spending-cap approval | Not established | "You can only create one MetaMask Card" |
| **Solflare Card** [8] | Self-custodial: spends from the wallet at purchase | Not established | Not established | The card paused on 2026-07-28 when its issuer Kulipa failed; Solflare says funds stayed "completely safe" in wallets | One |
| **SolSend** (sandbox, devnet) | Self-custodial: the card holds $0; USDC stays in your wallet until a swipe settles | Yes: each card is locked to one store from creation | Solana: the cap and expiry in the Allowances program; the store lock in our program, checked against the merchant ID our server relays | The card stops, but your money never left your wallet, and you can revoke every card yourself in the Allowances program | Many: one allowance and one Card PDA per card |

## What is different, precisely

- **One allowance per card.** The self-custodial cards we could document (MoonPay, MetaMask, Bridge-powered cards) back one card with one spending approval shared by every store. A leaked number or a breached store can therefore reach the whole approved amount. A SolSend wallet also makes a single token approval, to Solana's Allowances program, but inside that program every card is its own capped, expiring delegation, so the most a store, a leak or our server can pull is the sum of your caps.
- **The limit is not a row in an issuer's database.** Privacy.com and Rain offer per-merchant, capped, expiring cards, but the rules live in the company's systems and, for Rain, the balance is funded in advance. In SolSend each card's cap and expiry are enforced by Solana's Allowances program, and the store lock is checked onchain against the merchant ID our server relays (see the trust model in [TRUST.md](TRUST.md)).
- **The issuer is not your custodian.** When Solflare's issuer failed, the card stopped but the money stayed in wallets [8]. That is the argument for not pre-funding. SolSend's revoke-all is an instruction to the Allowances program, not to ours. If SolSend disappeared, your money would still be in your wallet, and you could revoke with any Solana wallet tool and a little SOL for fees. (Inside the app, our server builds that transaction and pays its fee.)
- **Credit where due.** When the Solana Foundation launched the Subscriptions & Allowances program it named card-linked spending as a use: "a wallet can simultaneously authorize a card program and one or more subscription plans" [9]. That describes one authorization per card program. SolSend takes it down to one authorization per card.
- **Burner cards are not new**, and neither are onchain card limits or per-spender allowances. BudgetRail already gives each AI agent a capped, expiring, revocable allowance on the same Subscriptions & Allowances program, for x402 payments rather than cards [18]. Our claim is the combination above, tied to individual payment cards, as far as we could find. We searched products, hackathon projects and public code and may still have missed one.

## Why caps onchain matter, and the risk that comes with them

A cap in a provider's database is a promise. Onchain card stacks carry exploit risk of their own: Gnosis Pay's onchain card modules were exploited on 2026-06-01 [10]. That is why we build on Solana's audited Allowances program and keep our own program small and reviewed: 41 LiteSVM tests against the real Allowances binaries (the devnet build and the verified mainnet build), and two adversarial **AI-assisted** security reviews with every High, Medium and Low finding fixed ([audit-program-cp1](evidence/audit-program-cp1.md), [audit-backend-cp1](evidence/audit-backend-cp1.md)). Those reviews are not a professional audit.

## The consumer pain

- Consumers underestimate their subscription spending by $133 a month, and 42% pay for a subscription they stopped using (CNBC, 2022) [11].
- The FTC's "click-to-cancel" rule was vacated in July 2025 [12]. The FTC reopened rulemaking on the Negative Option Rule in March 2026; no replacement rule is in force [13]. The burden of ending a subscription stays with the consumer.
- A SolSend free-trial card expires onchain: after expiry every pull fails inside the Allowances program, so the trial cannot quietly charge that card. Proven live on 2026-11-18 with a real Lithic sandbox authorization ([rehearsal-2026-11-18.md](evidence/rehearsal-2026-11-18.md)).

## The primitive we build on

Solana's **Subscriptions & Allowances** program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) was published by the Solana Foundation on 2026-06-02 and built by Moonsong Labs. It is live on mainnet and devnet. The program is audited by Cantina (audit scope is commit-based) [14], and its mainnet build is verified against the public source through OtterSec's service [15]; devnet, where SolSend runs, has a newer build, and our program tests pass against both ([MAINNET-READINESS.md](MAINNET-READINESS.md)). Launch coverage: [16][17]. We did not write it. SolSend runs on devnet.

## Honest limits of this positioning

- SolSend is a sandbox on devnet; every product above is shipping. We compare designs, not maturity.
- Our server is trusted to relay the card network's authorization and merchant ID. The chain enforces the caps, the expiry and the lock on what it is told.
- Card-network realities a production version must handle (final amounts that differ from the authorization, force-posted charges, disputes) are outside the demo; see the README's limitations.
- Competitor details come only from the linked pages, which may change.

## Sources

1. Privacy.com, virtual cards (merchant-locked, single-use; US eligibility): https://www.privacy.com/blog/how-to-use-virtual-mastercard
2. Privacy.com on its parent company Lithic: https://privacy.com/blog/virtual-card-companies
3. Rain launches Agent Vaults and scoped cards (2026-11-10): https://thepaypers.com/payments/news/rain-launches-agent-vaults-to-embed-payments-in-ai-agents and https://www.rain.xyz/resources/introducing-the-agent-control-layer
4. Bridge cards program (open-source Solana program): https://github.com/withbridge/bridge-cards
5. MoonPay MoonAgents Card: https://support.moonpay.com/en/articles/629708-moonagents-card-crypto-funded-virtual-payment-cards
6. MetaMask Card FAQ ("You can only create one MetaMask Card"): https://support.metamask.com/trade/metamask-card/card-faq/
7. MetaMask Card funding (spending-cap approval): https://support.metamask.com/trade/metamask-card/funding/
8. Solflare: card paused on 2026-07-28 after its issuer wound down: https://help.solflare.com/en/articles/17335647-solflare-card-pauses-july-28th-and-returns-with-apple-pay-higher-limits-and-cashback
9. Solana Foundation launch post for Subscriptions & Allowances: https://github.com/solana-foundation/solana-com/blob/main/apps/media/content/posts/subscriptions-and-allowances.mdx
10. Gnosis Pay incident analysis (CertiK; public estimates of the loss differ): https://www.certik.com/blog/gnosispay-incident-analysis
11. CNBC, subscription costs: https://www.cnbc.com/2022/09/06/consumers-underestimate-monthly-subscription-costs-by-at-least-100.html
12. FTC click-to-cancel vacated, July 2025: https://www.lw.com/en/insights/eighth-circuit-vacates-ftc-click-to-cancel-rule
13. FTC reopens Negative Option rulemaking, March 2026: https://www.cov.com/en/news-and-insights/insights/2026/03/ftc-launches-new-rulemaking-on-the-negative-option-rule
14. Cantina audit status of the Allowances program: https://github.com/solana-foundation/subscriptions/blob/main/audits/AUDIT_STATUS.md
15. OtterSec verified build status: https://verify.osec.io/status/De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
16. Chainstack: https://docs.chainstack.com/docs/solana-subscriptions-and-allowances
17. Helius: https://www.helius.dev/blog/solana-subscriptions-recurring-payments
18. BudgetRail (per-agent allowances on the Subscriptions program): https://github.com/vignesh-chaturvedi/BudgetRail

Hackathon rules referenced by the rest of the package (UBC 2026 official guide; live document re-read 2026-11-19): deadline Fri 2026-11-20 12:00 PM CST; finalists are shortlisted from submissions; finals 4 min + 2 min Q&A in person (the live guide changed this from 5; checked 2026-11-19); judging criteria Technical Execution, Product & UX, Innovation, Impact & Potential, Demo; video 2 to 3 minutes; Consumer track "use every day, not just once"; Best use of Solana asks for program IDs and a README explanation; QuickNode Streams asks for a configured Stream with a filter and destination, explained in the README.
