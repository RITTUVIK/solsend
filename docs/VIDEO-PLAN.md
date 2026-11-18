# Submission video plan (target 2:45; rules: 2 to 3 minutes)

Deadline for the whole submission: Fri 2026-11-20 12:00 PM CST (UBC 2026 guide). Finalists are shortlisted **from the submissions** before any live pitch, so this video is the gate to the finals. Keep it under 3:00 including the end card.

Everything shown is **Lithic sandbox + Solana devnet**. The amber sandbox banner is on every app screen; say "sandbox" once out loud and put the limits on the end card. No line may imply a real purchase.

## Rules for what appears on screen

- **Record the live app only** (https://solsend-ashen.vercel.app). The local mock build shows MOCK badges and fake signatures; never use it.
- **Never show a full card number, expiry or CVV, even sandbox ones.** Do not open card **Details** while recording. The masked card (`•••• 1234`) is enough: say "imagine this number leaked".
- Never show `.env` files, terminals with secrets, the Vercel or Supabase dashboards, private keys, or the presenter's email address.
- **QuickNode evidence must be real.** "Settlement streamed by QuickNode" appears only after the Stream actually delivers the settlement. If the sheet says "Waiting for QuickNode Stream…" for more than about 5 seconds, or "Not streamed yet", the stream is not running: stop and fix it before continuing. Do not record around it.

## Before recording (T-30 to T-0)

| When | Who | Step | Check |
|---|---|---|---|
| T-30 | Darren | Fund the presenter wallet to at least **$40 devnet USDC** (Circle devnet faucet, or **Add test USDC** in the app) | Wallet balance shows $40+ |
| T-20 | Darren | From `scripts/`: `pnpm qn:stream activate`, then `pnpm qn:stream get` | `"status":"active"` |
| T-20 | Darren | Open `/status` | All checks green |
| T-15 | Presenter | Chrome, clean profile, bookmarks bar and extensions hidden, Do Not Disturb on. DevTools device mode: iPhone 14 Pro (393×852), **DPR 3**, light mode | Phone frame at full height |
| T-15 | Presenter | Log in. If the wallet is new: **Get free test USDC**, then in the **Turn on cards** step tap **Set up wallet · free** (one approval) | Home shows the balance |
| T-10 | Presenter | **New card** → **Netflix** tile → expiry **2 minutes (demo)** → **Create Netflix card · $15.49** → approve | Must be at least 3 minutes old before the trial shot |
| T-5 | Presenter | Open **Activity** | The header line says **Streamed by QuickNode · last event …** (the Netflix card's registration was delivered). If it says "paused or delayed", the stream is not running: fix it first |

## Recording sequence (the order you actually record)

Record each numbered clip as its own take, **twice**. Never speed up footage; trim waits in editing instead.

1. **Wallet.** Home, top of screen: balance and "Most that can ever be pulled: $X across N live cards — even by SolSend." Hold 3 seconds.
2. **Create.** **New card** → **Temu** tile ($40) → **Create Temu card · $40.00** → approve in the wallet window → stepper **Setting your limit** → **Issuing sandbox card** → **Ready** → "Your Temu card is ready". (Edit out the wait between steps.)
3. **Pay.** **Pay at the sandbox store** → **Earbuds $12** → **Pay $12.00 with ••••**. Keep "Settling on Solana before approval…" at **real speed**. Then **Approved**, the chips **Settled onchain first** and the decision time, "Wallet $X → $Y", and **wait on screen until the badge "Settlement streamed by QuickNode" appears** (usually 1 to 3 seconds).
4. **Proof.** In the same sheet open **Settled on Solana** → **View settlement on Explorer (devnet)**. On the Explorer tab (full desktop window is fine): show **Success** and the instruction list (the SolSend program calling the Allowances program). Hold 5 seconds.
5. **Leaked number.** Back in the sheet: **Try this card's number at Amazon** → the amber callout → **Try the leaked number at Amazon** → **Declined**, "Card locked to another store", "Your USDC didn't move", proof row **Rejected onchain**. Optionally open the failed transaction on Explorer.
6. **Over the limit (cut first if long).** **Pay at Temu instead** → **Drone $45** → **Pay $45.00** → **Declined**, over the card's limit.
7. **Free trial.** Wallet → the Netflix card stamped **EXPIRED** → Demo store → **Netflix** → **Monthly plan $15.49** → **Declined**: "This card expired when your free trial ended. Your USDC didn't move."
8. **Activity (cut second if long).** **Activity**: the header **Streamed by QuickNode · last event …** and the rows: the $12 purchase "$28.00 left on card", the two declines, the cards.
9. **Revoke all.** Wallet → Safety card → **Revoke all cards…** → **Revoke all cards**. The sheet closes, the card shows "Approve the revoke in your wallet window", the wallet window opens: approve. "All cards revoked in one transaction." and "Balance still $Y — nothing was moved." **This really revokes every card on the presenter wallet**: do it last, and create fresh cards afterwards for the finals.

Immediately after: `pnpm qn:stream pause`, then `pnpm qn:stream get` shows `paused` (the trial bills per processed block). Exception: if the team decides to keep the stream on for judging, leave it active and note the credit cost.

## Edit order (what the viewer sees), about 2:45 and about 270 words

| Time | Clip | On screen | Voiceover | Caption |
|---|---|---|---|---|
| 0:00 to 0:10 | 5 | The leaked number declined at Amazon | "Say a store leaks my card number. Someone tries it somewhere else. Declined. It's useless anywhere else." | Sandbox card · test money · no real purchase |
| 0:10 to 0:24 | 1 | Wallet, zoom on "Most that can ever be pulled" | "This is SolSend. Every store gets its own card, and the card holds zero dollars. My money stays in my wallet until the moment I pay." | |
| 0:24 to 0:40 | 2 | Create the $40 Temu card | "A new store, a new card: forty dollars, Temu only. One tap to approve. No seed phrase, no fees." | Email login · no seed phrase · we pay the fees |
| 0:40 to 1:10 | 3 | Settling…, Approved, time chip, wallet change, QuickNode badge arriving | "Twelve-dollar earbuds. Watch the order. The card network asks us, we move the money on Solana first, and only after that confirms do we say yes. Under a second." | The money moves first, then the approval |
| 1:10 to 1:22 | 4 | Explorer: Success, Allowances program in the log (boxed) | "That's the real transaction. The limit lives in Solana's own Allowances program, not in our database." | Solana devnet transaction |
| 1:22 to 1:36 | 5 (Explorer) | The failed transaction for the Amazon attempt | "And the leaked-number attempt: a failed transaction. Nothing moved." | The store ID comes from the card network, relayed by our server, checked on Solana |
| 1:36 to 1:56 | 7 | Netflix card stamped EXPIRED; $15.49 declined | "I started a Netflix free trial earlier. The card expired on its own. No cancellation flow, no surprise charge." | Demo expiry: 2 minutes (real: 7, 14 or 30 days) |
| 1:56 to 2:04 | 8 | Activity, streamed live | "Every event arrives through a QuickNode Stream." | |
| 2:04 to 2:24 | 9 | Revoke all, approve, all cards off, balance unchanged | "And if I want out, one tap turns every card off. It goes straight to Solana, even if we disappear." | |
| 2:24 to 2:40 | End card | Tagline, tracks, live URL, repo URL, one line of limits | "SolSend: a burner card for every store. Today it's sandbox cards and test money; next is a real card issuer and a professional audit." | Sandbox cards · Solana devnet · Consumer Applications · Best use of Solana · QuickNode Streams |

Cut order if over 3:00: clip 8 first, then the clip 5 Explorer shot, then clip 6 (already left out above).

## Production

- **Frame:** the phone-width app at full frame height on a 16:9 canvas, captions in the space beside it. Use the full desktop window only for Explorer.
- **Audio:** a human voice on a headset or external mic, recorded separately and synced. Trim, never speed up.
- **Captions:** burned in, plus an `.srt` uploaded to YouTube (accessibility).
- **Thumbnail:** the Declined sheet.
- **Cursor:** large, slow, no wiggling. Pause one beat after each result before moving on.

## Upload checklist

- [ ] Length 2:00 to 3:00 (check the exported file, not the editor timeline)
- [ ] "Sandbox" is visible in the first frame and said once
- [ ] No full card number, CVV, expiry, email address, key or dashboard anywhere in the video
- [ ] The QuickNode badge in clip 3 actually appeared (not added in editing)
- [ ] YouTube **Unlisted** or Google Drive "Anyone with the link can view"; opened in a private window
- [ ] Link pasted into Devpost ([SUBMISSION.md](SUBMISSION.md)) and checked again
- [ ] A local copy saved for the finals backup
- [ ] `pnpm qn:stream pause` run (unless the team chose to keep the stream on for judging)
- [ ] Submitted before Fri 2026-11-20 12:00 PM CST, with margin
