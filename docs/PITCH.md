# Finals pitch (5 minutes + 2 minutes Q&A, in person)

Rules reference: finals are 5 minutes plus 2 minutes of Q&A. Judging criteria: Technical Execution, Product & UX, Innovation, Impact & Potential, Demo (UBC 2026 guide, p.18). Track: Consumer Applications (blockchain interaction plus a user-facing frontend; "use every day, not just once", p.8).

One idea to leave them with: **a burner card for every store; your money stays in your wallet until the moment you pay; your blast radius is the sum of your caps.**

State up front, once, calmly: this is Lithic sandbox cards and Solana devnet test USDC. Nothing real is charged.

## Timed outline

About half of the five minutes is the live product; slides carry only the ideas the product can't show. The deck has eight main slides and five appendix slides used only for questions. Every slide's speaker notes hold the lines below.

| Time | Slide or screen | What happens | Criterion |
|---|---|---|---|
| 0:00 to 0:20 | **Cover** "A burner card for every store." | Hook, then the sandbox sentence | Impact |
| 0:20 to 0:40 | **"One leaked number works everywhere."** | The problem in three sentences | Product & UX |
| 0:40 to 0:55 | **"Each card holds $0."** | The idea; switch to the app | Innovation |
| 0:55 to 3:15 | **Live app** (cue slide "Four things to watch") | (1) Pay $12 with a card that holds $0; (2) the same card's number tried at Amazon, declined, pause; (3) the expired free trial declined; (4) revoke every card at once | Demo, Technical |
| 3:15 to 3:45 | **"Money moves first. Approval second."** | Network asks → Solana moves the money → then yes; 0.9 s of a 6 s limit; why Solana | Technical |
| 3:45 to 4:10 | **"Worst case: the sum of your limits."** | The guarantee, and what you still trust | Impact |
| 4:10 to 4:40 | **"Every new store. Every free trial."** | Everyday use; what is next | Impact & Potential |
| 4:40 to 5:00 | **Close** | Closing line; leave the slide up for questions | All |

Cut rule: if the live part passes 3:15, skip the Explorer tab first, then do step 4 (revoke) in words over the next slide. Never cut the limits.

**Never show a full card number, expiry or CVV on the projector, even a sandbox one.** Do not open card **Details** on stage. The masked card (`•••• 1234`) is enough.

## Speaking lines

**Hook (0:00).** "Every store you shop at keeps your card number. One breach, and that number works at every other store, for any amount. In the next three minutes you'll watch a leaked card number fail everywhere except the one store it was made for. Everything you'll see is a sandbox: test cards and test money on Solana's test network. The transactions are real and public."

**Problem (0:20).** "A saved card works at any store, for any amount, until you notice and cancel it. Free trials work the same way: they turn into charges because the card still works."

**Idea (0:40).** "SolSend gives you a separate card for every store, and the card holds nothing. Each card is a permission with a limit: this store only, up to this much, until this date. Your money stays in your own wallet until the second you pay. Let me show you."

**Pay (live 1).** Point at "Most that can ever be pulled". Demo store, **Earbuds $12**, **Pay**. Stay silent through "Settling on Solana before approval…". At **Approved**: "The money moved first, on Solana. Then we said yes." Wait for **Settlement streamed by QuickNode** to appear, then open the Explorer link for five seconds.

**Leaked number (live 2).** "Now imagine Temu leaks this card's number." Tap **Try this card's number at Amazon**, then **Try the leaked number at Amazon**. **Declined.** Pause for two full seconds. "Useless anywhere else. My money didn't move. That rejection happened on Solana: here's the failed transaction."

**Free trial (live 3).** "I started this Netflix free trial before I walked up here. It has already expired." Pay **Monthly plan $15.49**: declined. "No cancellation flow. The card just stopped." *(Proof: on 2026-11-18 a real Lithic sandbox authorization after the trial ended was declined inside Allowances with `delegationExpired` (128), [`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet). See [rehearsal-2026-11-18.md](evidence/rehearsal-2026-11-18.md).)*

**Revoke (live 4).** "And if I want out, or the card company disappears: **Revoke all cards**, one approval, every card off. It goes straight to Solana's Allowances program, not to us, and my balance hasn't moved."

**How it works (3:15).** "What you just watched: the card network asked us to approve twelve dollars. Before answering, we asked a program on Solana to move the money. That program, not our server, checks the limit, the store and the expiry. Only after it confirmed did we say yes: nine tenths of a second in our live test, against six seconds allowed. Solana is fast and cheap enough to do that for every payment, and the limit lives in the Solana Foundation's own Allowances program, which was audited by Cantina. Our own code is not professionally audited yet."

**Worst case (3:45).** "So the worst case is a number you chose: the sum of your limits. A hacked store, a leaked number, even our own server cannot take more. Two things you still trust us for: our server passes along which store is charging, and on the test network we can still upgrade the program. Before real money, that gets locked and audited."

**Everyday (4:10).** "You'd reach for this every time you try a store you don't know yet, and every time you start a free trial. A card takes one tap: email login, no seed phrase, no fees. What comes next is the hard part and we know it: a real card issuer, and a professional audit."

**Close (4:40).** "SolSend: a burner card for every store. It holds nothing, it works in one place, and you can switch them all off at once." Stop. Leave the slide up.

## Live-demo safety plan

- **Network:** your own phone hotspot first, venue Wi-Fi second. The deck runs offline.
- **T-30:** logged in on the presenter laptop, wallet funded with **$40+** devnet USDC, wallet set up, a Temu card created. Create the **Netflix 2-minute trial** card now; it stays expired, so early is fine.
- **T-10:** `pnpm qn:stream activate` (from `scripts/`), then open **Activity** and confirm the header reads **Streamed by QuickNode · last event …**. Open `/status`: all green.
- **Backup:** the submission video saved locally and cut into per-beat clips, open in a second window, volume tested. A second browser profile already logged in.
- **If a step stalls for 8 seconds:** "If Solana can't confirm in time, we decline by design." Retry once, then play that beat's clip. Do not debug on stage.
- **No test checkouts on the stage wallet in the last hour** (demo checkout and Lithic sandbox limits).
- **After:** `pnpm qn:stream pause`. Revoke-all really revokes the presenter's cards; recreate cards before any second showing.

## Q&A (ten likely questions)

1. **Is this real money?**
   No. The cards are Lithic sandbox cards and the money is Solana devnet test USDC. No real merchant is charged and no card network settles. The Solana transactions are real devnet transactions, so every claim has a signature in [EVIDENCE.md](EVIDENCE.md).

2. **What if your server is compromised?**
   The settlement key can pull live cards only up to their remaining caps, and only into our treasury PDA. It cannot withdraw, raise a limit, unfreeze or pay anyone else; refunds go only to your stored account. The admin can pause settles and rotate the key, and you can revoke every card yourself in Solana's Allowances program. The assumption we cannot remove is that our server relays the card network's authorization and merchant ID truthfully; the program cannot verify Lithic's signature onchain.

3. **How is the merchant lock enforced, if your server relays the merchant ID?**
   Each payment must match the store ID the card network reports. Our server relays it, and Solana enforces the lock and the cap. A thief using the number at another store gets a different ID from the network, so the program rejects it, even on first use. A compromised server could lie about the ID; that is the trust assumption above, and the cap still bounds the damage.

4. **Why not just a virtual card, or Privacy.com?**
   They are real products and we are a sandbox. Privacy.com (built on Lithic) needs a US bank account and keeps the limits in its own systems; Rain's new scoped cards do the same with a pre-funded balance. The self-custodial cards we could document use one approval for the whole account. In SolSend every card is its own allowance on Solana that you created and can revoke yourself, nothing is pre-funded, and if the issuer fails the card stops but your money never left your wallet. See [POSITIONING.md](POSITIONING.md).

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
