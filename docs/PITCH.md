# Finals pitch (5 minutes + 2 minutes Q&A, in person)

Rules reference: finals are 5 minutes plus 2 minutes of Q&A. Judging criteria: Technical Execution, Product & UX, Innovation, Impact & Potential, Demo (UBC 2026 guide, p.18). Track: Consumer Applications (blockchain interaction plus a user-facing frontend; "use every day, not just once", p.8).

One idea to leave them with: **a burner card for every store; your money stays in your wallet until the moment you pay; your blast radius is the sum of your caps.**

State up front, once, calmly: this is Lithic sandbox cards and Solana devnet test USDC. Nothing real is charged.

## Timed outline

Labels in the "On screen" column are the exact UI text (UI v2). Full click path: [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

| Time | Beat | On screen | Maps to criterion |
|---|---|---|---|
| 0:00 to 0:30 | Hook and the sandbox disclaimer | Landing: "A burner card for every store." and the amber sandbox banner | Impact |
| 0:30 to 0:55 | The idea: cards that hold $0 | Wallet: "Most that can ever be pulled: $X across N live cards — even by SolSend." | Innovation |
| 0:55 to 1:25 | Create the $40 Temu card, one signature | **New card**, **Temu** tile, **Create Temu card · $40.00**, then "Your Temu card is ready" | Product & UX |
| 1:25 to 2:00 | Pay $12; settled before approved | **Earbuds $12**, **Pay $12.00 with ••••**, sheet: **Approved**, **Settled onchain first**, proof row, **Settlement streamed by QuickNode** | Demo, Technical |
| 2:00 to 2:40 | Leaked number at Amazon; $45 drone | **Try this card's number at Amazon**, **Declined**, **Rejected onchain**; **Drone $45** | Demo, Technical |
| 2:40 to 3:05 | The free trial that expired | Netflix free-trial card stamped **EXPIRED**; decline "This card expired when your free trial ended." | Innovation, Impact |
| 3:05 to 3:30 | The issuer dies: revoke all in one transaction | **Revoke all cards…**, then "All cards revoked in one transaction." | Impact |
| 3:30 to 4:30 | How it works and why we trust it | Architecture diagram | Technical |
| 4:30 to 5:00 | Honest limits and what is next | One slide | All |

The void (**Void (sandbox store)** on an Activity row) is shown only if time allows; it is asynchronous in Lithic's sandbox. If the free-trial card is not ready, drop that beat and give the time to the tech close. Start a stopwatch; the demo is the part to cut, not the limits slide.

## Speaking lines

**Hook (0:00).** "Every card you save online is a liability. Stores get breached, numbers leak, and free trials quietly become subscriptions you forget about. Everything you will see is a sandbox: Lithic sandbox cards and Solana devnet test USDC, no real merchant is charged."

**Idea (0:30).** "SolSend gives you a burner card for every store, and the card holds nothing. Each card is an allowance on Solana: capped, locked to one store, and your money stays in your wallet until the moment you pay. So the most anyone can ever pull, a hacked store, a leaked number, even our own server, is the sum of your caps."

**Create (0:55).** "I am trying Temu for the first time, so I create a $40 card. One signature, no gas, our server pays the fee. The card is capped and locked to Temu from the moment it exists."

**Pay (1:25).** "Earbuds, twelve dollars. Watch the order of events: the card network asks us, we pull the USDC on Solana, and only after that transaction confirms do we tell the network yes. 'Settled onchain first' is that order, this row is the proof, and the badge is our QuickNode Stream streaming the settlement."

**Leak (2:00).** "Now say Temu leaks this number and someone tries it at Amazon. Declined, onchain, on its first use, and here is the failed transaction. And a $45 drone is declined by the cap. To be precise about the trust model: each payment must match the store ID the card network reports; our server relays that ID, and Solana enforces the lock and the cap."

**Free trial (2:40).** "This Netflix free trial I started a few minutes ago has already expired, onchain. After expiry every pull fails inside Solana's Allowances program, so a trial can't quietly roll into a paid plan." *(The recorded proof of this failure came from a mock-signed run against real devnet, not a live card-network run; do not say otherwise.)*

**Issuer dies (3:05).** "On my home screen: the most that can ever be pulled through these cards, even by us. And when Solflare's card issuer wound down, the card stopped but people's money stayed in their wallets. Same idea here. If our issuer disappears, my money never left my wallet, and one transaction revokes every card. I tap Revoke all cards. It goes straight to Solana's audited Allowances program, not to us."

**Tech (3:30).** "Two programs: Solana's official Allowances program, audited by Cantina and verified by OtterSec, and our own Anchor program on top with a card PDA as the only delegatee. 41 tests run against the real Allowances binary, two independent security reviews, every finding fixed. We approve only after a confirmed settle. Hosted, a cold start is 2.4 seconds against Lithic's 6-second limit. And a QuickNode Stream on our program drives the live activity feed, about half a second after confirmation."

**Limits and next (4:30).** "Honest limits: sandbox cards and devnet; our server is trusted to relay the card network's authorization and the merchant ID, while the chain enforces the caps and the lock; and the program is upgradeable on devnet. Next: freeze or multisig the upgrade authority plus a professional audit, a real issuing partner, a refund-aware treasury, and recurring-pull UX."

## Live-demo safety plan

- **Setup before walking on:** logged in, wallet set up and funded with about $20+ devnet USDC (the faucet default is 5 USDC per claim, so raise `FAUCET_AMOUNT_BASE` or pre-fund), a spare Temu card created.
- **Netflix trial card:** pre-create it **at least 3 minutes before** you are on stage: **New card**, **Netflix** tile, expiry chip **2 minutes (demo)**, **Create Netflix card · $15.49**. It must read EXPIRED by beat 2:40.
- **Status page:** open `/status` and `/api/status` on the venue network; all green, settler SOL above the 0.03 SOL pause threshold.
- **Stream:** `pnpm qn:stream activate` just before walking up, `pnpm qn:stream pause` immediately after, then `pnpm qn:stream get` shows `paused`.
- **Backup video** (the 2:45 submission video, [VIDEO-PLAN.md](VIDEO-PLAN.md)) saved locally, open in a second window, volume tested.
- **Second device or browser profile** already logged in.
- **Cut rule:** if a step stalls for more than 10 seconds, say "that is the sandbox being slow", switch to the backup video at the matching beat, and continue. Do not debug on stage.
- **CLI fallback** (`merchant-sim`) is for rehearsal and emergencies only; Lithic's sandbox policy allows a handful of requests.
- The full click path and fallback table are in [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

## Q&A (ten likely questions)

1. **Is this real money?**
   No. The cards are Lithic sandbox cards and the money is Solana devnet test USDC. No real merchant is charged and no card network settles. The Solana transactions are real devnet transactions, so every claim has a signature in [EVIDENCE.md](EVIDENCE.md).

2. **What if your server is compromised?**
   The settlement key can pull live cards only up to their remaining caps, and only into our treasury PDA. It cannot withdraw, raise a limit, unfreeze or pay anyone else; refunds go only to your stored account. The admin can pause settles and rotate the key, and you can revoke every card yourself in Solana's Allowances program. The assumption we cannot remove is that our server relays the card network's authorization and merchant ID truthfully; the program cannot verify Lithic's signature onchain.

3. **How is the merchant lock enforced, if your server relays the merchant ID?**
   Each payment must match the store ID the card network reports. Our server relays it, and Solana enforces the lock and the cap. A thief using the number at another store gets a different ID from the network, so the program rejects it, even on first use. A compromised server could lie about the ID; that is the trust assumption above, and the cap still bounds the damage.

4. **Why not just a virtual card, or Privacy.com?**
   Privacy.com solved burner cards in fiat, and it is built on Lithic. The difference is custody and enforcement: our card holds $0, the cap is enforced by a Solana program rather than a company's database, and the card survives the issuer because your money never left your wallet. Existing self-custodial Solana cards use one delegation per wallet; we use one per card. See [POSITIONING.md](POSITIONING.md).

5. **Why Solana?**
   Capped, revocable delegation is a primitive in the Allowances program; PDAs make only our program able to pull; confirmation is fast enough to approve inside a card network's deadline (hosted cold 2.4 s, warm p50 about 0.84 s, against a 6 s limit); and a permanent record per authorization gives replay-proof idempotency.

6. **What happens if confirmation is slow?**
   We decline. There is a hard 4.5 s deadline under Lithic's 6 s limit. If the settle lands after we declined, the reconciler refunds it, driven by Lithic's final transaction status. We found and fixed a gap in exactly that path during testing.

7. **Why does a refund not restore the limit?**
   A deliberate MVP rule: a refund returns USDC, but SolSend never silently re-grants spending permission. To spend more, create a new card or top up with your own signature. An opt-in restore is on the roadmap.

8. **How does QuickNode fit?**
   Two ways. Its devnet RPC carries every settle on the hot path. A Stream on `solana-devnet` with the `programs_with_logs` dataset runs our generated filter on the program's events and delivers them to an HMAC-verified webhook that powers the live feed: +584 ms after confirmation in our deployed test. Trial limits: one stream, billed per block, no reorg handling, so we keep it paused outside demos and never base a money decision on a stream payload.

9. **Who audited this?**
   The Allowances program we build on was audited by Cantina. Our own code had two adversarial security reviews, one of the program and one of the backend. They were AI-assisted: separate review agents with fresh context, working from the code alone. Neither found a Critical issue; every High, Medium and Low finding was fixed and pinned as a regression test. To be clear, this is not a professional audit. That comes before any mainnet use, and the program is upgradeable on devnet.

10. **What is next, and is this a business?**
    Freeze or multisig the upgrade authority and get a professional audit before any mainnet use; a real issuing partner; a refund-aware treasury; recurring-pull UX. The pain is real: consumers underestimate subscription spending by $133 a month and 42% pay for one they stopped using ([CNBC](https://www.cnbc.com/2022/09/06/consumers-underestimate-monthly-subscription-costs-by-at-least-100.html)). We have not validated willingness to pay.
