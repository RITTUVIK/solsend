# Finals pitch (4 minutes + 2 minutes Q&A, in person)

Rules reference: finals are **4 minutes** plus 2 minutes of Q&A. The live official guide changed this from 5 minutes after our copy was saved on 16 November; both places in the guide now say 4 (checked 19 November). Judging criteria: Technical Execution, Product & UX, Innovation, Impact & Potential, Demo. Track: Consumer Applications (blockchain interaction plus a user-facing frontend; "use every day, not just once"; "the crypto is invisible").

One idea to leave them with: **a burner card for every store; your money stays in your wallet until the moment you pay; the most anyone can take is the sum of your limits.**

State up front, once, calmly: this is Lithic sandbox cards and Solana devnet test USDC. Nothing real is charged.

## Timed outline

Target 3:45 on a stopwatch. A little under half of it is the live product; slides carry only the ideas the product can't show.

| Time | Slide or screen | What happens | Criterion |
|---|---|---|---|
| 0:00 to 0:20 | **Cover** "A burner card for every store." | Hook, then the sandbox sentence | Impact |
| 0:20 to 0:30 | **"One leaked number works everywhere."** | The problem in two sentences | Product & UX |
| 0:30 to 0:40 | **"Each card holds $0."** | The idea; switch to the app | Innovation |
| 0:48 to 2:25 | **Live app** (cue slide "Three things to watch") | (1) Pay $12 with a card that holds $0; (2) the same card's number tried at Amazon, declined, pause; (3) the expired free trial, declined | Demo, Technical |
| 2:25 to 3:00 | **"Money moves first. Approval second."** | Network asks → Solana moves the money → then yes; 0.9 s of a 6 s limit; why Solana; QuickNode in one sentence | Technical |
| 3:00 to 3:45 | **"Worst case: the sum of your limits."** | The guarantee, revoke-all in words, what you still trust, everyday use, what is next, the closing line; leave the slide up | Impact |

Six slides in all. Cut rule: if the live part passes 2:25, skip the Explorer tab first, then say step 3 over the next slide. Never cut the limits. Revoke-all is no longer done live: it needs a wallet approval window, the slowest step on stage. Show it only if a judge asks.

**Never show a full card number, expiry or CVV on the projector, even a sandbox one.** Do not open card **Details** on stage. The masked card (`•••• 1234`) is enough.

## Speaking lines

About 300 words outside the live part.

**Hook (0:00).** "Every store you shop at keeps your card number. One breach, and that number works everywhere. In the next two minutes you'll watch a leaked number fail everywhere except the one store it was made for. This is a sandbox: test cards, test money, and real public transactions on Solana's test network."

**Problem (0:20).** "A saved card works at any store, for any amount, until you notice. Free trials bill you for the same reason: the card still works."

**Idea (0:30).** "SolSend gives every store its own card, and the card holds nothing. Your money stays in your own wallet until the second you pay. Watch."

**Pay (live 1).** Point at "Most that can ever be pulled". Demo store, **Earbuds $12**, **Pay**. Stay silent through "Settling on Solana before approval…". At **Approved**: "The money moved first, on Solana. Then we said yes." When **Settlement streamed by QuickNode** appears: "And that badge is a QuickNode Stream delivering the event to us." Open the Explorer link only if you are ahead of time.

**Leaked number (live 2).** "Now imagine Temu leaks this card's number." Tap **Try this card's number at Amazon**, then **Try the leaked number at Amazon**. **Declined.** Pause for two full seconds. "Useless anywhere else. My money didn't move."

**Free trial (live 3).** "I started this Netflix free trial before I walked up here. It has already expired." Pay **Monthly plan $15.49**: declined. "No cancellation flow. The card just stopped." *(Proof: on 2026-11-18 a real Lithic sandbox authorization after the trial ended was declined inside Allowances with `delegationExpired` (128), [`3q4HQCQf…`](https://explorer.solana.com/tx/3q4HQCQfRUkiSCgrzykYLMCozJrbAtW9LzAQsXXB2kbUcwiBsc1fjBfYvTHo8UguX4DPrxSV4mcTfq2khezLw4md?cluster=devnet). See [rehearsal-2026-11-18.md](evidence/rehearsal-2026-11-18.md).)*

**How it works (2:25).** "What you just watched: the card network asked us to approve twelve dollars. Before answering, we asked a program on Solana to move the money. Solana, not our server, checks the limit and the expiry, and checks the store against the ID we relay. Only after it confirmed did we say yes: nine tenths of a second in our live test, against six allowed. The limit lives in the Solana Foundation's Allowances program, which is audited. Our own code is not professionally audited yet."

**Worst case and close (3:00).** "So the worst case is a number you chose: the sum of your limits. A hacked store, a leaked number, even our own server cannot take more, and one tap revokes every card. You'd reach for this at every new store and every free trial: email login, no seed phrase, no fees. Next is the hard part, and we know it: a real card issuer, a professional audit, and a checkout extension so the card appears where you shop. SolSend: a burner card for every store." Stop. Leave the slide up. (What you still trust, if asked: our server reports which store is charging, and on the test network we can still upgrade the program.)

## Live-demo safety plan

- **Network:** your own phone hotspot first, venue Wi-Fi second. The deck runs offline.
- **T-30:** logged in on the presenter laptop, wallet funded with **$40+** devnet USDC, wallet set up, a Temu card created. Create the **Netflix 2-minute trial** card now; it stays expired, so early is fine.
- **T-10:** `pnpm qn:stream activate` (from `scripts/`), then open **Activity** and confirm the header reads **Streamed by QuickNode · last event …**. Open `/status`: all green.
- **Backup:** the submission video saved locally and cut into per-beat clips, open in a second window, volume tested. A second browser profile already logged in.
- **If a step stalls for 8 seconds:** "If Solana can't confirm in time, we decline by design." Retry once, then play that beat's clip. Do not debug on stage.
- **No test checkouts on the stage wallet in the last hour** (demo checkout and Lithic sandbox limits).
- **Test money:** the stage wallet needs at least $13 of devnet USDC for the $12 purchase; check the balance on **Wallet** at T-30.
- **After:** pause the stream only once judging is over (`pnpm qn:stream pause`). Revoke-all really revokes the presenter's cards; if a judge asks to see it, recreate cards before any second showing.

## Q&A (2 minutes: answer in one sentence, give one proof, stop)

1. **Is this real money?**
   No. The cards are Lithic sandbox cards and the money is Solana devnet test USDC. No real merchant is charged and no card network settles. The Solana transactions are real devnet transactions, so every claim has a signature in [EVIDENCE.md](EVIDENCE.md).

2. **Can I use one of these cards at Amazon today?**
   No. These are sandbox cards, and Lithic's sandbox is not connected to payment networks, so no real store can accept them. The store names in the demo are sandbox labels. What you watched is a simulated checkout whose approval or decline is decided by a real Solana transaction. Real stores need a production issuer. A checkout extension that makes a card for the site you are on is the natural next surface, and it was this project's original idea. We have not built it, and it has to be designed so card numbers stay in the issuer's secure fields.

3. **Why isn't this on mainnet?**
   The Allowances program we build on is live on mainnet at the same address, so the permission layer is not a devnet-only idea. Our own program holds the store lock and decides when money moves, it has not had a professional audit, and its upgrade key is still ours. We chose not to put that next to real money to win a weekend. The card side is the longer road: real cards need a licensed issuer and a sponsor bank, which is weeks of onboarding, not an API key.

4. **What if your server is compromised?**
   The settlement key can pull live cards only up to their remaining caps, and only into our treasury PDA. It cannot withdraw, raise a limit, unfreeze or pay anyone else; refunds go only to your stored account. The admin can pause settles and rotate the key, and you can revoke every card yourself in Solana's Allowances program. The assumption we cannot remove is that our server relays the card network's authorization and merchant ID truthfully; the program cannot verify Lithic's signature onchain.

5. **How is the merchant lock enforced, if your server relays the merchant ID?**
   The cap and the expiry are enforced by Solana with no trust in us. The store check is also onchain, but it trusts the store ID our server relays from the card authorization, and in this sandbox our own demo store sets that ID. A compromised server could lie about the store; it could never exceed your caps. With real cards the ID would come from the card network, and stores that bill under several IDs are an open problem we would solve with lock-on-first-use or a merchant registry.

6. **Why not just a virtual card, or Privacy.com?**
   They are real products and we are a sandbox. Privacy.com (built on Lithic) needs a US bank account and keeps the limits in its own systems; Rain's new scoped cards do the same with a pre-funded balance. The self-custodial cards we could document back one card with one spending approval shared by every store. In SolSend every card is its own allowance on Solana that you created and can revoke yourself, nothing is pre-funded, and if the issuer fails the card stops but your money never left your wallet. See [POSITIONING.md](POSITIONING.md).

7. **Why Solana?**
   Capped, revocable delegation is a primitive in the Allowances program; PDAs make only our program able to pull; confirmation is fast enough to approve inside a card network's deadline (real sandbox approvals took 0.9 to 1.1 s; Lithic declines at 6 s and recommends 3 s); and a permanent record per authorization gives replay-proof idempotency.

8. **What happens if confirmation is slow?**
   We decline. There is a hard 4.5 s deadline under Lithic's 6 s limit. If the settle lands after we declined, the reconciler refunds it, driven by Lithic's final transaction status. We found and fixed a gap in exactly that path during testing.

9. **Why does a refund not restore the limit?**
   A deliberate MVP rule: a refund returns USDC, but SolSend never silently re-grants spending permission. To spend more, create a new card or top up with your own signature. An opt-in restore is on the roadmap.

10. **How does QuickNode fit?**
   Two ways. Its devnet RPC carries every settle on the hot path. And a Stream is our independent witness: on `solana-devnet`, with the `programs_with_logs` dataset, it runs a filter generated from our program's IDL and delivers each program event to an HMAC-verified webhook. That marks the Activity row as seen onchain, adds the slot, and cross-checks each settlement against the card authorization; a settlement with no approved authorization raises an alert. One delivery measured 584 ms after confirmation. Money decisions never wait on it, and it bills per block, so it runs during demo windows. On 19 November it delivered a live $5 settlement 356 ms after confirmation, with a matching cross-check.

11. **Who audited this?**
   The Allowances program we build on was audited by Cantina; that is its mainnet build, and our tests pass against both that build and the newer devnet one. Our own code had two adversarial security reviews, one of the program and one of the backend. They were AI-assisted: separate review agents with fresh context, working from the code alone. Neither found a Critical issue; every High, Medium and Low finding was fixed and pinned as a regression test. To be clear, this is not a professional audit. That comes before any mainnet use, and the program is upgradeable on devnet.

12. **What is next, and is this a business?**
    Freeze or multisig the upgrade authority and get a professional audit before any mainnet use; a real issuing partner; a refund-aware treasury; recurring-pull UX. The pain is real: consumers underestimate subscription spending by $133 a month and 42% pay for one they stopped using ([CNBC](https://www.cnbc.com/2022/09/06/consumers-underestimate-monthly-subscription-costs-by-at-least-100.html)). We have not validated willingness to pay.
