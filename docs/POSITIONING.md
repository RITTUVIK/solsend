# Positioning: where SolSend sits

SolSend is a **burner card per store with onchain caps, funded straight from your own wallet**. Burner cards are a solved problem in fiat; self-custodial crypto cards exist. The combination, one capped and store-locked allowance per card, did not turn up in the sources below. This page only states what those sources support. Cells marked "not established" mean our sources do not say, not that the answer is no. Sandbox + devnet caveats from the [README](../README.md) apply to SolSend itself.

## Comparison

| | Custody | Per-merchant cards | Onchain spending caps | Survives issuer failure | Multiple cards per wallet |
|---|---|---|---|---|---|
| **Privacy.com** [1] | Fiat; funded from a bank account. It runs on Lithic, the same issuer API as our sandbox | Yes. Burner cards are fiat-solved [1] | No (not crypto) | n/a (fiat) | Yes |
| **Solflare Card** [2] | Self-custodial: spends from your wallet with one SPL delegation per wallet | Not established | Delegation amount is the cap | Partly: when its issuer Kulipa wound down, the card paused but funds stayed in users' wallets [3] | No: one delegation per wallet [2] |
| **MoonPay MoonAgents Card** [4] | Crypto-funded virtual cards; one delegation | Not established | Not established | Not established | "Multi-card support is on the roadmap" [4] |
| **MetaMask Card** [5] | Self-custodial; funded via a spending-cap approval | Not established | A spending-cap approval | Not established | Not established |
| **Gnosis Pay** [6] | Not established here | Not established | Not established | Its Delay module was exploited for about $265k on 2026-06-01; Gnosis said it would cover user losses [6] | Not established |
| **KAST, RedotPay** (custodial crypto cards) | Custodial: the provider holds the funds | Not established | No (offchain) | No: funds are with the provider | Not established. *No source in our verified set; do not quote this row externally without one* |
| **SolSend** | Self-custodial: the card holds $0; USDC stays in your wallet until a swipe settles | Yes: each card is locked to one store, enforced onchain from creation | Yes: the cap is the Allowances delegation, enforced by Solana | Yes: revoke every card in one transaction directly in Solana's Allowances program, not ours | Yes: one allowance and one Card PDA per card |

## What is different, precisely

- **Existing self-custodial Solana cards use one SPL delegation per wallet** [2][4][5]. A leak or a breached store exposes the whole delegation. SolSend uses **one allowance per card**, so the blast radius is the sum of your caps: the most anyone can ever pull.
- **The issuer is not your custodian.** Solflare's card paused when Kulipa wound down, but the money stayed in wallets [3]. That precedent is the argument for not pre-funding. SolSend's revoke-all goes to the Allowances program directly, so it works even if SolSend is gone.
- **Burner cards are not new.** Privacy.com solved them for fiat [1]. Our difference is self-custody plus caps enforced by a program instead of a company's database.
- **Why caps onchain matter.** A cap in a provider's database is a promise. The Gnosis Pay incident [6] shows that onchain card stacks carry exploit risk of their own, which is why we build on Solana's audited Allowances program [7] and keep our own program small and reviewed (41 LiteSVM tests, two independent security reviews with all findings fixed: [audit-program-cp1](evidence/audit-program-cp1.md), [audit-backend-cp1](evidence/audit-backend-cp1.md)).

## The consumer pain

- Consumers underestimate their subscription spending by $133 a month, and 42% pay for one they stopped using (CNBC, 2022) [8].
- The FTC "click-to-cancel" rule was vacated in July 2025 [9], so the burden of ending a subscription stays with the consumer. A card that holds $0 and expires on its own ends a free trial without a cancellation flow. (Free-trial expiry is in progress; see the [roadmap](../README.md#roadmap).)

## The primitive we build on

Solana's **Subscriptions & Allowances** program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) is live on mainnet and devnet, audited by Cantina, and OtterSec-verified for its mainnet build [7][10]. Launch coverage [11][12].

## Honest limits of this positioning

- SolSend is a sandbox on devnet; competitors are shipping products. We compare designs, not maturity.
- The settlement authority is trusted to relay the card network's authorization and merchant ID; the chain enforces the caps and the lock.
- Competitor details come only from the linked pages, which may change.

## Sources

1. Privacy.com on Lithic: https://support.privacy.com/hc/en-us/articles/360039642653-What-is-Lithic
2. Solflare Card funding (single SPL delegation per wallet): https://help.solflare.com/en/articles/12866865-funding-and-using-your-solflare-card
3. Ready (Solflare card) shuts the program after the issuer winds down; funds stayed in wallets: https://thedefiant.io/news/cefi/ready-shuts-card-program-after-issuer-winds-down
4. MoonPay MoonAgents Card: https://support.moonpay.com/en/articles/629708-moonagents-card-crypto-funded-virtual-payment-cards
5. MetaMask Card funding (spending-cap approval): https://support.metamask.io/trade/metamask-card/funding/
6. Gnosis Pay exploit, about $265k, 2026-06-01: https://www.theblock.co/news/regulation/2026-06-01-gnosis-will-cover-all-user-losses-amid-exploit-related-to-gnosis-pay-co-founder-koppelmann-says-403147
7. Cantina audit status of the Allowances program: https://github.com/solana-foundation/subscriptions/blob/main/audits/AUDIT_STATUS.md
8. CNBC, subscription costs: https://www.cnbc.com/2022/09/06/consumers-underestimate-monthly-subscription-costs-by-at-least-100.html
9. FTC click-to-cancel vacated, July 2025: https://www.lw.com/en/insights/eighth-circuit-vacates-ftc-click-to-cancel-rule
10. OtterSec verified build: https://verify.osec.io/status/De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
11. Chainstack: https://docs.chainstack.com/docs/solana-subscriptions-and-allowances
12. Helius: https://www.helius.dev/blog/solana-subscriptions-recurring-payments

Hackathon rules referenced by the rest of the package (UBC 2026 official guide, PDF): deadline Fri 2026-11-20 12:00 PM CST; finals 5 min + 2 min Q&A in person (judging criteria p.18); video 2 to 3 minutes; Consumer track "use every day, not just once" (p.8); Best use of Solana asks for program IDs and a README explanation (p.9); QuickNode Streams asks for a configured Stream with a filter and destination, explained in the README (p.13).
