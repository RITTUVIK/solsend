# Demo script: "A burner card for every store"

Tagline: **A burner card for every store — your money stays in your wallet until the moment you pay.**

Length about 4 minutes (the 5-minute finals pitch in [PITCH.md](PITCH.md) wraps this demo with an intro, tech close and Q&A hand-off; the 2:45 video is in [VIDEO-PLAN.md](VIDEO-PLAN.md)). Everything is **Lithic sandbox + Solana devnet test USDC**. Say so in the first ten seconds and never imply otherwise. Merchant names are sandbox labels, always "(sandbox)".

Live app: https://solsend-ashen.vercel.app (screens: Wallet, New card, Demo store, Activity).

Core idea to land: each card is an onchain allowance that **holds $0**. The blast radius is the sum of your caps: the most anyone, a hacked store, a leaked number, even our own server, can ever pull.

> **UI note for the presenter.** The beats below use the approval sheet ("settled on Solana before the card network approved"), the home-screen "Most that can ever be pulled" line and the expiring free-trial card. These were still being finished when this script was written. Rehearse each against the deployed app and fall back to the wording that the screen actually shows. Beat 5's proof is a placeholder until it has been recorded.

## Pre-demo checklist (15 minutes before)

Run commands from `scripts/` ([DEPLOY.md](DEPLOY.md) section 4; credentials are read in-process and never printed).

| Check | How | Pass |
|---|---|---|
| App healthy | open `https://solsend-ashen.vercel.app/api/status` | All checks green (genesis devnet, program executable, config live, settler SOL runway, treasury ATA, Lithic sandbox, store reachable, no failing refunds) |
| Settler SOL | status shows the settler runway line | Above the 0.03 SOL pause threshold with margin. Checkout returns 503 `demo_paused_low_sol` below it |
| Faucet funded | demo wallet has at least about $20 USDC | The faucet default is 5 USDC per claim, once per hour. A $12 payment needs more than one claim: raise `FAUCET_AMOUNT_BASE` on Vercel or pre-fund the wallet |
| Demo limits | demo store minimum is $1; per-wallet caps are 30/day and 10/min | Rehearse sparingly so you do not burn the day's budget |
| Cards pre-created | a spare Temu card, plus the 2-minute Netflix free-trial card created just before | Visible on Home; the Netflix card is created about 2 minutes before beat 5 (see beat 5) |
| Stream paused now | `pnpm qn:stream get` | `paused` |
| Reconcile healthy | `/api/status` shows no unreconciled or failing refunds | Green |
| Fresh account or clean cards | a new email, or revoke-all beforehand | Clean Home screen |
| Rehearsed once | beats 2 to 7 on a throwaway card | Void refund lands within about a minute |
| Fallback ready | backup video file open; screenshots tab; `pnpm merchant-sim list` works | See fallback plan |

**Right before you start:** `pnpm qn:stream activate`. **Right after:** `pnpm qn:stream pause`, then `pnpm qn:stream get` must show `paused`. The trial bills per processed block.

## Script

Timing is cumulative. "Say" is one or two plain sentences.

### 1. Hook (0:00 to 0:25)

- **On screen:** the landing page, sandbox banner visible.
- **Say:** "Every saved card is a liability: stores get breached, numbers leak, and free trials quietly turn into subscriptions. This is a sandbox with devnet test USDC; SolSend gives you a burner card for every store, and your money stays in your wallet until the moment you pay."

### 2. Create a $40 Temu card (0:25 to 1:10)

- **Click:** log in with email, enter the code. **Set up wallet**, approve once, then **Get test USDC**. **New card**, pick **Temu**, limit **40**, **Create card**, approve one signature.
- **Expect:** the stepper (onchain allowance, then issuing) completes; the card shows it is locked to Temu (sandbox) from the moment it was created. No SOL needed anywhere.
- **Say:** "Temu is a store I am trying for the first time. One signature, no gas, and the card is capped at $40 and locked to Temu from creation. The card itself holds nothing; my USDC is still in my wallet."

### 3. Pay $12; settled before approved (1:10 to 1:50)

- **Click:** **Demo store**, **Temu (sandbox)**, amount **12** (earbuds), **Pay with SolSend card**.
- **Expect:** "Settling onchain...", then **APPROVED**; the approval sheet shows the payment settled on Solana before the card network was told yes; a proof row with an Explorer link. Open it: a successful `settle`. **Activity** shows the settled row from QuickNode.
- **Say:** "The card network asked us, we pulled the money onchain, and only after that transaction confirmed did we answer yes. This feed row arrived through our QuickNode Stream."
- **Timing tip:** tap **Void this purchase** now (Lithic's sandbox void is asynchronous, so the refund lands tens of seconds later, during beat 4). Safe: a refund never restores the limit.

### 4. The leaked number and the drone (1:50 to 2:35)

- **Click:** **Demo store**, **Amazon (sandbox)**, amount **10**, **Pay**.
- **Expect:** **DECLINED**, with **View failed tx on Explorer**. Open it: a failed devnet transaction (`MerchantMismatch`). No USDC moved.
- **Say:** "Imagine Temu leaks this number and someone tries it at Amazon. Declined onchain, even on its very first use, because the lock was written when the card was created. Enforced onchain: each payment must match the store ID the card network reports; our server relays it, and Solana enforces the lock and the cap."
- **Click:** **Temu (sandbox)**, amount **45** (a drone), **Pay**.
- **Expect:** **DECLINED** by the cap, failed-transaction link, remaining limit unchanged.
- **Say:** "And a $45 drone on a $40 card is rejected by the Allowances program itself."
- **Note:** a first-ever-charge decline on a pre-locked card is recorded in [EVIDENCE.md](EVIDENCE.md) (P7).

### 5. The free trial that cancels itself (2:35 to 3:05)

- **Pre-created before the demo:** a Netflix (sandbox) free-trial card using the 2-minute demo expiry, created about 2 minutes before this beat, so it has expired by now.
- **Click:** **Demo store**, **Netflix (sandbox)** with the trial card, **Pay**.
- **Expect:** **DECLINED** because the card's allowance has expired onchain; failed-transaction link.
- **Say:** "This is a free trial I signed up for two minutes ago. It expired on its own, onchain, with no cancel button to hunt for and no click-to-cancel flow to fight."
- **Proof (devnet):** settle before expiry [`3BovUnii…`](https://explorer.solana.com/tx/3BovUniidkydXRQMBfFY9KMdv38hSsKyfsADmv12FtvpwdDAoy4mG1f8eJADSM2GZ2xjwwXg65rVRDKYTwuu3CDt?cluster=devnet) ok; the same settle after expiry [`42fhAuNK…`](https://explorer.solana.com/tx/42fhAuNKvytc4iR6sRaH9RTsRNNXqqaqskG2k4z7yf7JL7AMC5yLFTs7cN2JJJzkKQCuHEvrGC1pVgECVVJCtd8W?cluster=devnet) fails onchain with Allowances `delegationExpired` (Custom 128). See [w2-free-trial-expiry.md](evidence/w2-free-trial-expiry.md). Live demo: pre-create a "2 minutes (demo)" trial card at least 3 minutes before going on stage.

### 6. Blast radius, void and refund (3:05 to 3:30)

- **Click:** **Wallet**. Point at the home-screen line **"Most that can ever be pulled: $X"**. Show the refund row from the void in beat 3.
- **Expect:** the refund message "USDC returned to your wallet. This card's spending limit stays used - create a new card to spend more." and the balance back up by $12.
- **Say:** "This is the blast radius: the most anyone can ever pull is the sum of my caps. The void sent my USDC back, but the limit stays used on purpose; we never silently re-grant spending permission."

### 7. The issuer dies (3:30 to 4:00)

- **Click:** **Revoke all cards**, approve once.
- **Expect:** "All cards revoked in one transaction" with an Explorer link.
- **Say:** "When Solflare's card issuer Kulipa wound down, the card paused but the money stayed in wallets. Same here: if our issuer disappears, my money never left my wallet, and one transaction revokes every card, sent straight to Solana's audited Allowances program, not ours."

### 8. Tech close (4:00 to 4:20)

- **On screen:** [ARCHITECTURE.md](ARCHITECTURE.md) diagram or the `/status` page.
- **Say:** "Underneath: Solana's official, audited Allowances program plus our own Anchor program, with 41 LiteSVM tests and two independent security reviews with every finding fixed. We approve only after a confirmed settle, a hosted cold start of 2.4 seconds against Lithic's 6-second limit, and a QuickNode Streams live feed delivering about half a second after confirmation."
- **After:** `pnpm qn:stream pause`, confirm `paused`.

## Fallback plan

| Failure | Do this |
|---|---|
| Demo store checkout errors or Lithic sandbox is slow | CLI fallback ([DEPLOY.md](DEPLOY.md) section 5), from `scripts/`: `pnpm merchant-sim list`, `pnpm merchant-sim buy <cardToken> TEMU 1200`, `pnpm merchant-sim void <txToken>`. Same Lithic simulation and same ASA; it never prints the card number. A handful of requests only |
| Privy login or wallet popup fails | A pre-logged-in second browser profile with a funded account |
| QuickNode feed row does not appear | Say so; the settle and Explorer link are the proof, the feed is a notification layer. Check `pnpm qn:stream get` is `active` |
| Void refund slow | Continue; the Lithic event and the reconciler both trigger it. Point to the recorded refund (E3 in [EVIDENCE.md](EVIDENCE.md)) |
| Everything is down | Play the backup video, or walk [evidence/w3-screenshots](evidence/w3-screenshots) and state that they are **MOCK UI** captures with fake signatures; then show the real devnet signatures in [EVIDENCE.md](EVIDENCE.md) |

## Judge Q&A prep

Longer, finals-format answers are in [PITCH.md](PITCH.md). Short versions:

1. **Is this real money?** No: sandbox cards, devnet test USDC, no real merchant charged. The Solana transactions are real devnet transactions you can open.
2. **What if your server is compromised?** The settlement key can only pull live cards up to their remaining caps, only into the treasury PDA; it cannot withdraw or pay anyone else. The admin can pause and rotate it, and you can revoke every card yourself in the Allowances program.
3. **Why not just a virtual card?** A virtual card needs a funded balance or a linked account. Ours holds $0 and can pull only the capped, store-locked amount at the instant of a swipe, and you can kill it even if the issuer is gone.
4. **Why Solana?** The Allowances program gives capped revocable delegation as a primitive, PDAs make only our program the delegatee, and confirmation is fast enough to approve inside a card-network deadline.
5. **What if confirmation is slow?** We decline: hard 4.5 s deadline under Lithic's 6 s. A settle that lands late is refunded by the reconciler.
6. **Why does a refund not restore the limit?** A deliberate MVP rule: SolSend never silently re-grants spending permission; create a new card or top up with your own signature.
7. **How does QuickNode fit?** Its devnet RPC carries every settle, and a Stream on our program feeds the live activity page (+584 ms after confirmation in our deployed test).
8. **What is next?** Freeze or multisig the upgrade authority and re-audit, free-trial and subscription guardrails, real issuer settlement, a live issuing partner.

## Do not say

- That a real purchase happened at Temu, Amazon or Netflix.
- That card-network settlement is live, or that anything runs on mainnet.
- That the screenshots are live captures.
- Any number not in [EVIDENCE.md](EVIDENCE.md) or this repo's evidence files.
