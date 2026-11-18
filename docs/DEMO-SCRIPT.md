# Demo script: "A burner card for every store"

Tagline: **A burner card for every store — your money stays in your wallet until the moment you pay.**

About 4 minutes of demo. The 5-minute finals pitch in [PITCH.md](PITCH.md) wraps this demo; the 2:45 video ([VIDEO-PLAN.md](VIDEO-PLAN.md)) follows the same beats. Everything is **Lithic sandbox + Solana devnet test USDC**. Say so in the first ten seconds and never imply otherwise. Merchant names are sandbox labels, always "(sandbox)" in the UI.

Live app: https://solsend-ashen.vercel.app. Tabs at the bottom (mobile) or top (desktop): **Wallet**, **Demo store**, **Activity**. Labels below are quoted from the UI v2 code and screenshots ([evidence/ui-v2](evidence/ui-v2/README.md)); the screenshots there are **mock mode**, so exact dollar figures on your screen will differ.

Core idea to land: each card is an onchain allowance that **holds $0**. The blast radius is the sum of your caps: the most anyone, a hacked store, a leaked number, even our own server, can ever pull.

## Pre-demo setup

Commands run from `scripts/` ([DEPLOY.md](DEPLOY.md) section 4; credentials are read in-process and never printed).

| When | Do | Pass |
|---|---|---|
| 30 min before | Open `https://solsend-ashen.vercel.app/status` and `/api/status` | All checks green, including the settler SOL runway line and no failing refunds. Checkout returns 503 `demo_paused_low_sol` below 0.03 SOL |
| 30 min before | Log in on the presenter device; wallet funded with about **$20+ devnet USDC**; wallet already set up | **Wallet** shows the balance. The faucet default is 5 USDC per claim, once per hour per wallet, so raise `FAUCET_AMOUNT_BASE` on Vercel or pre-fund the wallet. Use **Add test USDC** if needed. (If the checklist still shows "Set up your wallet", tap **Set up wallet · free** and approve once) |
| 30 min before | Pre-create a spare Temu card (**New card**, Temu tile "First try", $40) | Visible as a card on **Wallet** |
| **At least 3 minutes before stage** | Create the Netflix 2-minute trial: **New card**, tile **Netflix** ("Free trial"), expiry chip **2 minutes (demo)**, then **Create Netflix card · $15.49** and approve once | Card named "Netflix free trial"; it will read "Expired" by the time you reach beat 5. If you create it too late, skip beat 5 |
| Right before | `pnpm qn:stream activate` | Then `pnpm qn:stream get` shows active |
| Right after | `pnpm qn:stream pause`, then `pnpm qn:stream get` | `paused` (the trial bills per processed block) |
| Always | Backup video open in a second window; a second browser profile already logged in | See fallback plan |

Demo store limits: amounts from $0.01 to $50.00; checkout has per-wallet limits (30 per day, 10 per minute), so rehearse sparingly.

## Script

Cumulative timing. "Say" is one or two plain sentences.

### 1. Hook (0:00 to 0:25)

- **On screen:** the landing page: headline "A burner card for every store." and the amber banner "Sandbox cards · Solana devnet USDC · no real merchants are charged".
- **Say:** "Every card you save online is a liability: stores get breached, numbers leak, and free trials quietly become subscriptions. Everything here is a sandbox with devnet test USDC, and SolSend gives you a burner card for every store while your money stays in your wallet until the moment you pay."

### 2. Create a $40 Temu card (0:25 to 1:00)

- **Click:** **Wallet**, then **New card**. Tap the **Temu** tile (tag "First try"; the limit presets to **$40**). The preview card shows it locked. Tap **Create Temu card · $40.00** and approve the one signature.
- **Expect:** the title "Creating your card", the stepper, then "Your Temu card is ready". The form text reads "Locked to Temu (sandbox) from the moment it's created, so a leaked number is useless anywhere else." Buttons: **Pay at the sandbox store** and **View card**.
- **Say:** "Temu is a store I am trying for the first time. One signature, no gas because our server pays, and the card is capped at forty dollars and locked to Temu from the moment it exists. It holds nothing; my USDC is still in my wallet."

### 3. Pay $12; settled onchain first (1:00 to 1:40)

- **Click:** **Pay at the sandbox store** (or the **Demo store** tab). The header shows "Temu (sandbox)". In "Add to cart" tap **Earbuds $12**. Tap **Pay $12.00 with •••• NNNN**.
- **Expect:** a sheet opens at once: "Pay Temu (sandbox)", "$12.00", then "Settling on Solana before approval…". Then **Approved**, "$12.00 at Temu (sandbox)", chips **Settled onchain first**, the decision time in ms, and "$28.00 left on card". "Wallet $X → $Y" shows the drop. A proof row **Settled on Solana** expands to **View settlement on Explorer (devnet)**. A badge reads **Settlement streamed by QuickNode**. Open the Explorer link: a successful `settle`.
- **Say:** "The card network asked us, we pulled the money onchain, and only after that transaction confirmed did we answer yes. The proof row is the transaction, and that badge is our QuickNode Stream delivering it."
- **Do not tap Done yet.**

### 4. The leaked number and the drone (1:40 to 2:25)

- **Click:** in the same sheet tap **Try this card's number at Amazon**. The store switches to Amazon and an amber callout appears: "This card is locked to Temu (sandbox). Paying at Amazon simulates a thief using a leaked card number." Tap **Try the leaked number at Amazon**.
- **Expect:** **Declined**, "Card locked to another store", and "This card only works at Temu (sandbox). A leaked number is useless anywhere else. Your USDC didn't move." The proof row reads **Rejected onchain** with **View failed tx on Explorer (devnet)**; open it: a failed devnet transaction. Wallet "didn't move".
- **Say:** "If Temu leaks this number, a thief at Amazon is declined onchain, even on first use, with the failed transaction as proof. Each payment must match the store ID the card network reports; our server relays it, and Solana enforces the lock and the cap."
- **Click:** **Pay at Temu instead**, then tap **Drone $45**, then **Pay $45.00 with •••• NNNN**.
- **Expect:** **Declined** by the card's remaining limit (only $28.00 is left); the sheet's explanation and its fix button come from the decline copy, so read what it says. Rejected-onchain proof row again.
- **Say:** "A forty-five-dollar drone is declined by the cap: the Allowances program itself refuses it." Tap **Done**.

### 5. The free trial that cancels itself (2:25 to 3:00)

- **Click:** **Demo store**, choose the **Netflix free trial** card under "Pay with", tile **Netflix**, chip **Monthly plan $15.49**, **Pay $15.49 with •••• NNNN**.
- **Expect:** **Declined**. The explanation for an expired card reads "This card expired when your free trial ended. Your USDC didn't move." Open the card on **Wallet**: the card face is stamped **EXPIRED**.
- **Say:** "This is a free trial I signed up for a few minutes ago. It expired on its own, onchain, so it can never quietly roll into a paid plan, and there is no cancel button to hunt for."
- **Proof (real devnet, not a Lithic run):** after expiry the same pull fails inside the Allowances program with error 128 (`delegationExpired`): [`42fhAuNK…`](https://explorer.solana.com/tx/42fhAuNKvytc4iR6sRaH9RTsRNNXqqaqskG2k4z7yf7JL7AMC5yLFTs7cN2JJJzkKQCuHEvrGC1pVgECVVJCtd8W?cluster=devnet). That test used locally signed requests (MOCK ASA) against real devnet; see [w2-free-trial-expiry.md](evidence/w2-free-trial-expiry.md). Do not say it was a live card-network run.

### 6. Blast radius, void and refund (3:00 to 3:30)

- **Click:** **Activity**. On the $12 Temu row tap **Void (sandbox store)**, then in the sheet "Void this purchase?" tap **Void purchase**. Then go to **Wallet**.
- **Expect:** the row shows "Refund on its way: sandbox voids are asynchronous (usually under a minute)", then "Refunded to your wallet" with **Refund transaction (devnet)**; the row reads "Refunded +$12.00 · onchain". Home shows "Most that can ever be pulled: $X across N live cards — even by SolSend." Void timeline order: Approved, Voided by the store, Refunded to your wallet onchain.
- **Say:** "The home screen shows my blast radius: the most anyone can ever pull is the sum of my caps. The void sends my USDC back onchain, but the card's limit stays used on purpose, because we never silently re-grant spending permission."
- **Timing tip:** do the void right after beat 3 if the refund is slow on rehearsal; the Lithic sandbox void is asynchronous and the refund follows its event.

### 7. The issuer dies (3:30 to 4:00)

- **Click:** on **Wallet**, scroll to the Safety card "If the card issuer goes down". Tap **Revoke all cards…**. In the sheet "Revoke N cards?" tap **Revoke all cards**, approve once.
- **Expect:** "All cards revoked in one transaction." "Balance still $Y — nothing was moved. No card can pull again." and a **Revoked on Solana** proof row.
- **Say:** "When Solflare's card issuer Kulipa wound down, the card paused but the money stayed in wallets. Same here: if our issuer disappears, my money never left my wallet, and one transaction revokes every card, sent straight to Solana's audited Allowances program, not ours."
- **Optional:** the URL `/home?demo=outage` shows the Safety card as "Card issuer unreachable (simulated)".

### 8. Tech close (4:00 to 4:20)

- **On screen:** the architecture diagram ([ARCHITECTURE.md](ARCHITECTURE.md)) or `/status`.
- **Say:** "Underneath: Solana's official, audited Allowances program plus our Anchor program, with 41 tests against the real Allowances binary and two independent security reviews with every finding fixed. We approve only after a confirmed settle; a hosted cold start is 2.4 seconds against Lithic's 6-second limit; and a QuickNode Stream drives the live feed, about half a second after confirmation."
- **After:** `pnpm qn:stream pause`, confirm `paused`.

## Fallback plan

| Failure | Do this |
|---|---|
| Demo store errors or Lithic sandbox is slow | CLI from [DEPLOY.md](DEPLOY.md) section 5, run from `scripts/`: `pnpm merchant-sim list`, `pnpm merchant-sim buy <cardToken> TEMU 1200`, `pnpm merchant-sim void <txToken>`. Same Lithic simulation and ASA; never prints the card number. A handful of requests only |
| Privy login or a signature popup fails | Switch to the second browser profile, already logged in and funded |
| QuickNode badge or feed row does not appear | Say so; the settle and Explorer link are the proof, the feed is a notification layer. Check `pnpm qn:stream get` shows active |
| Void refund is slow | Continue; the Lithic event and the reconciler both trigger it. Show the recorded refund (E3 in [EVIDENCE.md](EVIDENCE.md)) |
| Netflix card was not created in time or has not expired | Skip beat 5 and give the time to beat 8 |
| Everything is down | Play the backup video, or walk [evidence/ui-v2](evidence/ui-v2/README.md) screenshots, stating they are **mock mode** with illustrative signatures; then show the real devnet signatures in [EVIDENCE.md](EVIDENCE.md) |

## Judge Q&A prep

Longer answers are in [PITCH.md](PITCH.md). Short versions:

1. **Is this real money?** No: sandbox cards, devnet test USDC, no real merchant charged. The Solana transactions are real devnet transactions you can open.
2. **What if your server is compromised?** The settlement key can only pull live cards up to their remaining caps, only into the treasury PDA; it cannot withdraw or pay anyone else. The admin can pause and rotate it, and you can revoke every card yourself in the Allowances program.
3. **Why not just a virtual card?** A virtual card needs a funded balance or linked account. Ours holds $0, pulls only the capped, store-locked amount at the instant of a swipe, and can be killed even if the issuer is gone.
4. **Why Solana?** The Allowances program gives capped, revocable delegation; PDAs make only our program the delegatee; confirmation fits a card network's deadline.
5. **What if confirmation is slow?** We decline: hard 4.5 s deadline under Lithic's 6 s. A settle that lands late is refunded by the reconciler.
6. **Why does a refund not restore the limit?** A deliberate MVP rule: SolSend never silently re-grants spending permission.
7. **How does QuickNode fit?** Its devnet RPC carries every settle, and a Stream on our program feeds the live feed (+584 ms after confirmation in our deployed test).
8. **What is next?** Freeze or multisig the upgrade authority plus a professional audit, a real issuing partner, a refund-aware treasury, and recurring-pull UX.

## Do not say

- That a real purchase happened at Temu, Amazon, Netflix or Corner Cafe.
- That card-network settlement is live, or that anything runs on mainnet.
- That the screenshots are live captures (they are mock mode).
- That the free-trial expiry proof came from a Lithic run. It was a direct program-level devnet test (settlement-authority signed, no card network involved).
- Any number not in [EVIDENCE.md](EVIDENCE.md) or the evidence files.
