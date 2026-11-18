# Demo script: "The breach and the bankruptcy"

Length: 3 to 4 minutes. Audience: hackathon judges. Everything is **Lithic sandbox + Solana devnet test USDC**. Say so in the first ten seconds and do not claim otherwise at any point. Merchant names are sandbox labels, always "(sandbox)".

URL: https://solsend-ashen.vercel.app (screens: Wallet, New card, Demo store, Activity).

## Pre-demo checklist (15 minutes before)

Run commands from `scripts/` (see [DEPLOY.md](DEPLOY.md) section 4; they read credentials in-process and print none).

| Check | How | Pass |
|---|---|---|
| App is healthy | open `https://solsend-ashen.vercel.app/api/status` | All checks green (genesis devnet, program executable, config live, settler and fee payer SOL, treasury ATA, Lithic sandbox, store reachable) |
| Settler SOL | `/api/status` shows settler and fee-payer balances | Both comfortably above zero. Each settle costs about 0.0015 SOL of record rent, so a rehearsal plus the demo is well under 0.1 SOL |
| Faucet USDC funded | the faucet wallet holds devnet USDC | Enough for the demo wallet. **Faucet default is 5 USDC per claim, once per hour per wallet, but the story needs at least $25 in the wallet** (a $23.17 charge). Raise `FAUCET_AMOUNT_BASE` on Vercel and redeploy, or pre-fund the demo wallet from the faucet wallet. See open questions |
| Stream is paused now | `pnpm qn:stream get` | `paused` |
| Reconcile cron healthy | GitHub Actions `reconcile` last run green | Green |
| Fresh demo account | a new email, or a wallet with no leftover cards | Clean Home screen |
| Rehearsed once | run beats 3 to 7 with a throwaway card | Void refund lands within about a minute |
| Fallback ready | screenshots opened in a tab; `pnpm merchant-sim list` works locally | See fallback plan |

**Right before you start:** `pnpm qn:stream activate` (moves the start slot to now, so the stream does not replay a backlog). **Right after you finish:** `pnpm qn:stream pause`, then `pnpm qn:stream get` must show `paused`. The trial bills per processed block, so never leave it active.

## Script

Timing is cumulative. "Say" is one sentence.

### 1. Login and wallet setup (0:00 to 0:35)

- **Click:** open the URL, log in with email, enter the code. On the Wallet screen tap **Set up wallet** and approve once.
- **Expect:** an embedded wallet appears; setup confirms with an Explorer link. No SOL needed anywhere.
- **Say:** "This is a sandbox with devnet test USDC; I log in with email, sign once, and our server pays every fee, so there is no gas and no seed phrase."

### 2. Get test USDC (0:35 to 0:50)

- **Click:** **Get test USDC**.
- **Expect:** a confirmation and a USDC balance on Home (at least $25, see checklist).
- **Say:** "That is devnet USDC in my own wallet; it stays there until a card is actually swiped."

### 3. Create a $40 Temu card (0:50 to 1:25)

- **Click:** **New card**, select **Temu**, limit **40**, **Create card**, approve the one signature. Wait for the stepper (onchain allowance, then issuing) to finish.
- **Expect:** a card ready, showing "Locked onchain to Temu (sandbox) from the moment it's created".
- **Say:** "One signature creates an allowance in Solana's official Allowances program whose delegatee is a SolSend PDA, so only our program can pull, and it is locked to Temu from birth."

### 4. Approved only after the devnet settle confirms (1:25 to 2:05)

- **Click:** **Demo store**, choose **Temu (sandbox)**, type **23.17**, **Pay with SolSend card**.
- **Expect:** the button reads "Settling onchain...", then **APPROVED**, a **View settlement on Explorer** link, and remaining limit **$16.83**. Open the Explorer link: a successful `settle` on devnet. Switch to **Activity**: a settled row sourced from QuickNode (appears within about a second or two of confirmation; measured +584 ms in our run).
- **Say:** "The card network asked us, we pulled the money onchain, and only after that transaction confirmed did we answer APPROVED; the feed row you see arrived through our QuickNode Stream."
- **Timing tip:** now click **Void this purchase** on the result (or on the card), then continue. The void is asynchronous in Lithic's sandbox, so the refund lands tens of seconds later while you do beat 5. This is safe because a refund never restores the limit, so beat 5's numbers do not change.

### 5. The leaked card and the over-limit charge (2:05 to 2:50)

- **Click (leaked card):** **Demo store**, choose **Amazon (sandbox)**, amount **10**, **Pay**.
- **Expect:** **DECLINED** (unauthorized merchant) with **View failed tx on Explorer**. Open it: the failed devnet transaction (`MerchantMismatch`). No USDC moved.
- **Say:** "A thief who has this number at any other store is declined onchain, even on first use, because the lock was written when the card was created."
- **Click (over limit):** choose **Temu (sandbox)**, amount **45**, **Pay**.
- **Expect:** **DECLINED** (insufficient funds / limit) with a failed-transaction link. Remaining limit still **$16.83**.
- **Say:** "A $45 charge on a $40 card is rejected by the Allowances program itself, so the cap is enforced by the chain, not by our server's goodwill."
- **Note:** the pre-lock is proven for a first-ever charge in the devnet smoke test (evidence P7 in [EVIDENCE.md](EVIDENCE.md)); in this live card the Temu charge already happened, but the lock was set at creation either way.

### 6. Void and refund; the limit stays used (2:50 to 3:20)

- **Click:** go back to the voided purchase or **Activity**.
- **Expect:** a refund row and the message "USDC returned to your wallet. This card's spending limit stays used - create a new card to spend more." Balance on **Wallet** is back up by $23.17; card remaining stays **$16.83**.
- **Say:** "Voids refund onchain to the wallet, but the limit stays used on purpose: we never silently re-grant spending permission, you create a new card or top up with your own signature."

### 7. "Issuer outage": revoke all cards (3:20 to 3:50)

- **Click:** **Wallet** (Home), the outage panel, **Revoke all cards**, approve once.
- **Expect:** "All cards revoked in one transaction" with an Explorer link. Cards show closed or revoked.
- **Say:** "If an issuer fails or goes bankrupt, the money never left my wallet; one signature revokes every allowance directly in the Allowances program, with or without SolSend."
- **Optional close (10 s):** "Same architecture, real issuing partner, mainnet, after an audit and with the program frozen: that is the roadmap."

**After:** `pnpm qn:stream pause`, confirm `paused`.

## Fallback plan

| Failure | Do this |
|---|---|
| Demo store checkout errors, or Lithic sandbox is slow | Use the CLI fallback from [DEPLOY.md](DEPLOY.md) section 5, run from `scripts/`: `pnpm merchant-sim list`, then `pnpm merchant-sim buy <cardToken> TEMU 2317`, `pnpm merchant-sim void <txToken>`. It hits the same Lithic simulation API and the same ASA. It reads local credentials and never prints the card number. Use it sparingly: sandbox policy allows a handful of requests, no load testing |
| Privy login or wallet popup fails | Use a pre-logged-in second browser profile with a funded account |
| QuickNode feed row does not appear | Say so. The settle and the Explorer link are the proof; the feed is a notification layer. Check `pnpm qn:stream get` shows `active`, and that the webhook is reachable |
| Void refund is slow | Continue; the reconciler cron and the Lithic event both trigger it. Point to the earlier recorded refund in [EVIDENCE.md](EVIDENCE.md) (E3) |
| Everything is down | Walk the screenshots in [evidence/w3-screenshots](evidence/w3-screenshots), and be explicit that they are **MOCK UI mode** captures with fake signatures; then show the real devnet signatures in [EVIDENCE.md](EVIDENCE.md) |

## Judge Q&A prep

1. **Is this real money?**
   No. Cards are Lithic sandbox cards and the money is devnet test USDC. No real merchant is charged and no card network settles. What is real is the Solana side: every settle, decline and refund is a real devnet transaction you can open.

2. **What if your server is compromised?**
   The settlement key can only pull live cards up to their remaining caps, and only into the treasury PDA; it cannot withdraw, raise limits, unfreeze, or pay anyone else, and refunds go only to each card's stored source account. The admin can pause settles and rotate the key, and you can revoke every allowance yourself in the Allowances program. We state this trust assumption openly: the program cannot verify Lithic's attestation onchain.

3. **Why not just a virtual card?**
   A normal virtual card needs a funded account or a linked bank, and a leak exposes that. Here the card has no balance; it can pull only the capped, store-locked amount you delegated, at the instant of a swipe, and you can kill it with one onchain signature even if the issuer is gone.

4. **Why Solana?**
   The Allowances program gives capped, revocable delegation as a primitive; PDAs let only our program act as the delegatee; sub-second confirmation fits inside a card network's 6-second approval window (hosted warm p50 about 0.84 s, cold 1.8 to 2.4 s); and one-record-per-authorization PDAs give replay-proof idempotency.

5. **What happens if the confirmation is slow?**
   We decline. There is a hard 4.5 s deadline under Lithic's 6 s limit, and any timeout or unknown state declines. If the settle lands after we declined, the reconciler refunds it, driven by Lithic's final transaction status. We found and fixed a gap in exactly this path during testing (evidence in [w2-backend.md](evidence/w2-backend.md)).

6. **Why does a refund not restore the limit?**
   It is a deliberate MVP product decision: a refund returns USDC, but SolSend never silently re-grants spending permission. To spend more, create a new card or top up the allowance with your own signature. An opt-in restore is on the roadmap.

7. **How does QuickNode fit?**
   Two ways. Its devnet RPC carries every settle and confirmation on the hot path. Its Streams product watches the SolSend program, decodes our events in a filter, and pushes HMAC-signed deliveries to our webhook that power the live activity feed (+584 ms after confirmation in our deployed test). We know the trial limits: one stream, billed per block, no reorg handling, so we pause it outside demos and never base a money decision on a stream payload.

8. **What's next?**
   Freeze or multisig the upgrade authority and re-audit; a capped, refund-aware treasury withdrawal and real issuer settlement; incremental authorizations and partial captures; an opt-in restore-limit-on-refund; then a live issuing partner. Known limits today: devnet program is upgradeable, 43 pre-upgrade records cannot be refunded through the program, and Lithic sandbox voids are asynchronous.

## Do not say

- That a real purchase happened at Temu, Amazon or Netflix.
- That card-network settlement is live, or that anything runs on mainnet.
- That the screenshots are live captures (they are mock UI mode).
- Numbers that are not in [EVIDENCE.md](EVIDENCE.md).
