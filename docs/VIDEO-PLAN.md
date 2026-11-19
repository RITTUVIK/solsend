# Submission video plan (target 2:35 to 2:50; rules: 2 to 3 minutes)

Deadline for the whole submission: Fri 2026-11-20 12:00 PM CST (UBC 2026 guide). Finalists are shortlisted **from the submissions** before any live pitch, and the QuickNode bounty is judged from submissions only, so this video is the gate. Keep it under 3:00 including the end card.

Everything shown is **Lithic sandbox + Solana devnet**. The sandbox notice is a bar at the top of every phone-width screen (a corner pill on desktop). It is quiet, so say "sandbox" once out loud, keep the first-frame caption, and put the limits on the end card. No line may imply a real purchase.

## Before recording

| Who | What | Check |
|---|---|---|
| Darren | Top up the test-money faucet wallet and the presenter wallet from Circle's devnet faucet | Faucet wallet above 20 test USDC (each new user's claim takes 5); presenter wallet at $40 or more. With less, void each purchase between takes; the refund returns the money in under a minute |
| Darren | Check the plan and credits in the QuickNode dashboard. From `scripts/`: `pnpm qn:stream activate`, then `pnpm qn:stream get`. Make one small purchase and confirm the badge appears | `"status":"active"`. It costs about 450k credits an hour, so pause it right after recording |
| Darren | Open `/status` | All checks green, and the QuickNode line reads "delivering" |
| Presenter | Chrome, clean profile, bookmarks bar and extensions hidden, Do Not Disturb on. DevTools device mode: iPhone 14 Pro (393 × 852), light mode | The phone-width app fills the frame |
| Presenter | Log in. Create the **Netflix** card with the **2 minutes (demo)** expiry now | It must be at least 3 minutes old before clip 6 |
| Presenter | Open **Activity** | The header reads **Streamed by QuickNode · last event …**. If it says "paused or delayed", stop and fix the stream first |

## Rules for what appears on screen

- Record the live app only: https://solsend-ashen.vercel.app. Never the local mock build.
- Never show a full card number, expiry or CVV, even a sandbox one. Do not open card **Details** while recording.
- Never show `.env` files, terminals with secrets, dashboards, private keys or an email address.
- "Settlement streamed by QuickNode" must appear by itself. It shows only after the Stream really delivers. Never add it in editing.
- Never speed up footage. Trim waits instead.

## Clips to record

Record each clip as its own take, twice. Phone-width frame unless noted.

| Clip | What to do | Must be visible |
|---|---|---|
| 1 Wallet | **Wallet** tab, top of the screen. Hold 3 seconds. | Balance, and "Most that can ever be pulled: $X across N live cards — even by SolSend." |
| 2 Create | **New card** → **Temu** tile ($40) → **Create Temu card · $40.00** → approve → "Your Temu card is ready". | The stepper reaching **Ready**. |
| 3 Pay | **Pay at the sandbox store** → **Earbuds $12** → **Pay $12.00 with ••••**. Wait on the Approved sheet until the QuickNode badge appears. | "Settling on Solana before approval…" at real speed, then **Approved**, **Settled onchain first**, the time chip, "Wallet $X → $Y", and **Settlement streamed by QuickNode**. |
| 4 Proof | In the same sheet: **Settled on Solana** → **View settlement on Explorer (devnet)**. Full desktop window is fine. Hold 6 seconds. | **Success**, and the instruction list with both program addresses. |
| 5 Leak | Back in the sheet: **Try this card's number at Amazon** → the amber callout → **Try the leaked number at Amazon**. Hold the result 3 seconds. | The callout, then **Declined**, "Card locked to another store", "Your USDC didn't move". |
| 6 Trial | **Wallet**: the Netflix card stamped **EXPIRED**. Then **Demo store** → **Netflix** → **Monthly plan $15.49** → pay. | The stamp, then **Declined**: "This card expired when your free trial ended." |
| 7 Activity | **Activity** tab. Scroll slowly once, then open the $12 purchase and show **Seen by**. | The header **Streamed by QuickNode · last event …**, the $12 purchase, the two declines, and "Seen by: QuickNode Stream" (with the Solana slot if the new build is live). |
| 8 Revoke | **Wallet** → **Revoke all cards…** → **Revoke all cards** → approve. **Record this last: it really revokes every card.** | "All cards revoked in one transaction." and "Balance still $Y — nothing was moved." |
| 9 Brand (optional) | The Home page at phone width, 3 seconds. | The solsend wordmark. |

After recording: `pnpm qn:stream pause`, then `pnpm qn:stream get` must say `paused`.

## The edit: 2:35 to 2:50, about 265 spoken words

| Time | Clip | Voiceover | Caption on screen |
|---|---|---|---|
| 0:00–0:10 | 5 | "A store just leaked my card number. A thief tries it at Amazon. *(Declined appears.)* Declined. That number is useless anywhere else." | First 2 s: **This card number just leaked.** Then: Sandbox card · test money · no real purchase |
| 0:10–0:22 | 9, then 1 | "This is SolSend: a burner card for every store. Each card holds zero dollars. My money stays in my own wallet until the moment I pay." | **solsend** · A burner card for every store |
| 0:22–0:38 | 2 | "A new store gets a new card. Temu only, forty dollars at most. One tap to approve. I signed in with my email: no seed phrase, and we pay the network fees." | Email login · no seed phrase · no fees |
| 0:38–1:02 | 3 | "Now, twelve-dollar earbuds. Watch the order. The card network asks us to approve. We move the money on Solana first. *(Approved appears.)* Only when that is confirmed do we say yes." Then read the time chip aloud. | **Money moves first. Approval second.** |
| 1:02–1:14 | 4 | "This is that payment on Solana's public explorer. Our program calls the Solana Foundation's Allowances program. That is where the card's limit lives, not in our database." | Box the two programs and label them: **SolSend program** · **Solana Subscriptions & Allowances** |
| 1:14–1:36 | 3 (zoom on the badge), frame, then 7 | "And we don't just take our own server's word for it. A QuickNode Stream reads our program's events straight from Solana and delivers each one to us. That badge appears only when the delivery really arrives." **If the new build is live, add:** "The line under it is the Stream's own cross-check: same amount, same card." | **QuickNode Streams: an independent witness** |
| 1:36–1:54 | 6 | "Free trials. I started a Netflix trial earlier, on a card that expires by itself. Now Netflix tries to bill me. *(Declined.)* Declined. Nothing to cancel." | Demo expiry: 2 minutes. Real cards: 7, 14 or 30 days |
| 1:54–2:14 | 8 | "And if I ever want out, one tap switches every card off. I sign it myself, and it goes to Solana's own Allowances program, so the permissions are gone on the chain, not just in our app. My balance never moved." | One transaction. Every card off. |
| 2:14–2:36 | End card | "Everything you saw is a working sandbox: test cards and test money on Solana's test network, and every result is a public transaction. Next: a real card issuer and a professional audit. SolSend. A burner card for every store." | (the end card carries it) |

- **The time chip:** say "under a second" only if the chip shows less than 1000 ms. Otherwise read the number.
- **Cut order if over 2:55:** shorten clip 4 to 8 seconds, then trim clip 2. Never cut the QuickNode segment, the sandbox caption or the end card.
- **Length rule:** 2 to 3 minutes (guide, "What to Submit"). Check the exported file, not the editor timeline.

## The QuickNode stream: when it is on, and what it costs

The stream has been paused since 18 November, on purpose. Production has recorded two deliveries in total, so the video is where the real Stream evidence gets made.

- **It costs about 450,000 credits an hour** (30 credits per devnet block). The trial has 10 million, shared with the RPC that every card approval uses. A full day would burn the whole trial and could take approvals down with it.
- **So do not leave it on through judging** unless the QuickNode dashboard shows a larger plan (the guide lists a $49/month plan as a participant perk). Darren: check the plan and remaining credits in the dashboard before recording. Our API key cannot read them.
- **Turn it on only with `pnpm qn:stream activate`**, never with the dashboard's resume button. The command moves the start to the current block first. Resuming from the dashboard would replay 39 hours of backlog, about 18 million credits.
- **On the trial:** on for the recording (two hours at most), off right after, on again 15 minutes before the finals demo. After each change run `pnpm qn:stream get` and read the status back.

## If something goes wrong

| Problem | Do this |
|---|---|
| Wallet too low for another take | Void the last purchase (Activity → **Simulate store refund**), wait for "Refunded to your wallet", retake. |
| "Waiting for QuickNode Stream…" for more than 5 seconds | Stop. `pnpm qn:stream get`. If it is paused, `activate`. Do not record around it. |
| The stream cannot be restored in 20 minutes | Record without the badge, drop the 1:14 segment, Then decide whether to keep the bounty entry, citing the recorded 18 November delivery ([lead-deployed-e2e.md](evidence/lead-deployed-e2e.md)) instead. Never fake the badge. |
| A payment declines for time | That is the product declining by design. Retake. |
| A wallet approval window fails | Switch to a second browser profile that is already logged in. |
| Netflix card not expired yet | Wait. It needs two minutes from creation. |
| No time to edit | One continuous take of clips 5, 3, 6, 8 with live narration, trimmed to under 3:00, plus the end card. A plain complete video beats a polished late one. |

## Production

- **Frame:** the phone-width app at full frame height on a 16:9 canvas, captions in the space beside it. Use the full desktop window only for Explorer.
- **Audio:** a human voice on a headset or external mic, recorded separately and synced. Trim, never speed up.
- **Captions:** burned in, plus an `.srt` uploaded to YouTube (accessibility).
- **Thumbnail:** the Declined sheet.
- **Cursor:** large, slow, no wiggling. Pause one beat after each result before moving on.

## Upload checklist

- [ ] Length between 2:00 and 3:00 in the exported file
- [ ] "Sandbox" visible in the first frame and spoken once
- [ ] No full card number, CVV, expiry, email address, key or dashboard anywhere
- [ ] The QuickNode badge in clip 3 appeared by itself
- [ ] YouTube **Unlisted** (or Drive "Anyone with the link"); opened in a private window on another device
- [ ] Captions uploaded
- [ ] Link pasted into Devpost and clicked from there
- [ ] A local copy saved, cut into per-beat clips for the finals backup
