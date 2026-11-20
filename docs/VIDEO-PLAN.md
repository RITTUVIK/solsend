# Submission video plan (desktop-first, 16:9; target 2:35 to 2:50; rules: 2 to 3 minutes)

Deadline for the whole submission: Fri 2026-11-20 12:00 PM CST (UBC 2026 guide). Finalists are shortlisted **from the submissions** before any live pitch, and the QuickNode bounty is judged from submissions only, so this video is the gate.

Everything shown is **Lithic sandbox + Solana devnet**. On desktop the sandbox notice is a pill in the bottom-left corner of every frame. Say "sandbox" once out loud and keep the limits on the end card. No line may imply a real purchase. Store names are sandbox labels.

The video opens on a purchase, then the leak, then the decline, so the decline reads as a story and not as a security test.

## Two settings that decide how the video looks

No code changes. Both are things you do in the browser.

| Setting | Do this | Why |
|---|---|---|
| **Record a 1280 × 720 page, not a 1920 × 1080 one** | Chrome DevTools → device toolbar → **Responsive**, 1280 × 720, zoom 100%, device type **Desktop**. Record exactly that area on a Retina screen and export at 1920 × 1080 | At a 1920-wide page the approval panel is 400 px wide and the QuickNode badge is 11 px text. In a 1080p video it is unreadable. At 1280 × 720 everything is 1.5 times larger in the same frame |
| **Drag the app pane to its widest** | Drag the divider between the purple page and the app all the way left (or click it and press **Home**). It stops with about a third of the frame purple | By default the purple landing page takes 54% of the frame and never changes. Widened, the product takes two thirds and the landing becomes a brand strip |

**Checked and fine at that framing:** desktop readability, the checkout screen, the Approved and Declined panels, the Activity header, and the wallet line. No high-impact visual problem needs a code change.

**Three smaller things to handle in the recording or the edit:**

- **The Pay button sits just below the fold** on the store page at 720 px high. Scroll the app pane down a little before the first shot so the card, the store, the item and the Pay button are all in frame.
- **The line under the QuickNode badge is small** (grey, 11 px). Punch in on the right-hand panel when you talk about it. Recording on a Retina screen gives you the pixels to do that.
- **The arrow pattern is busy.** Use hard cuts and punch-ins on the app side. Avoid slow zooms or pans across the purple side; fine patterns shimmer when they move, and they cost video bitrate.

**Captions:** put burned-in captions in one solid dark box over the lower part of the purple column, where "How it works" sits (roughly x 48 to 612, y 745 to 985 in the 1080p frame). That text is the least readable part of the frame, the box never covers the product, and the sandbox pill under it stays visible. Upload the `.srt` to YouTube as well.

**Mobile footage:** not needed. If you want one phone shot, use the Declined sheet at phone width as a three-second cutaway. Do not mix formats beyond that.

## Before the first shot

Stream OFF for all of this.

| # | Who | Do | Check |
|---|---|---|---|
| 1 | Ritty | Set up the window as in section 1. Hide the bookmarks bar. Do Not Disturb on. Undock DevTools into its own window | A 10-second test capture is sharp and shows only the page |
| 2 | Ritty | Sign in. **Close the old Temu card** from its card page. One approval | Only cards you will use on camera remain |
| 3 | Ritty | **New card** → **Netflix** → **More options** → expiry **2 minutes (demo)** → create. One approval | It must be at least 3 minutes old before take F |
| 4 | Ritty | Drag the app pane to its widest. Open **Wallet** | Balance about $28. Two $12 payments fit |
| 5 | Darren | From `scripts/`: `pnpm qn:stream activate`, then `pnpm qn:stream get` | `"status":"active"`. Start recording within a few minutes |

Rules while recording:

- Record the live app only: https://solsend-ashen.vercel.app.
- Never show a full card number, expiry or CVV. Do not open card **Details**.
- Do not hover over **Log out**: its tooltip may show your email.
- The QuickNode badge must appear by itself. Never add it in editing.
- Never speed up footage. Trim waits.

## Takes, in recording order

| Take | Do | Must be visible | Used at |
|---|---|---|---|
| **A** (first shot) | **New card** → **Temu** ($40) → **Create Temu card · $40.00** → approve → "Your Temu card is ready" → **Pay at the sandbox store** → scroll so the Pay button shows → **Pay $12.00 with ••••** → wait | The stepper reaching **Ready**; the store with **Temu (sandbox)**, **Earbuds $12**; then **Approved**, **Settled onchain first**, the time chip, "Wallet $28.00 → $16.00"; then **Settlement streamed by QuickNode** and the line under it. Hold 5 seconds | 0:00, 0:27 |
| **A2** | **Done**. Then **Pay $12.00** again and wait, without talking | The same result at real speed. This payment is warm, so the time chip is the one to read aloud | 0:42, 1:16 |
| **B** | In the open panel: **Settled on Solana** → **View settlement on Explorer (devnet)**. Hold 6 seconds | **Success**, and the instruction list with both program addresses | 1:04 |
| **C** | Back in the app: **Try this card's number at Amazon** → the amber callout → **Try the leaked number at Amazon**. Hold 3 seconds | The callout, then **Declined**, "Card locked to another store", "Your USDC didn't move" | 0:07 |
| **D** | **Done** → **Wallet**. Hold 4 seconds | The balance and "Your cards can spend at most $X." | 0:16 |
| **E** | **Activity**. Scroll once slowly, then open the $12 purchase | **Streamed by QuickNode · last event …**; in the purchase, **Seen by** with the slot line | 1:16 |
| **F** | **Wallet**: the Netflix card stamped **EXPIRED**. Then **Demo store** → select the Netflix card → **Monthly plan $15.49** → pay | The stamp, then **Declined**: "This card expired when your free trial ended." | 1:38 |
| **G** (last) | **Wallet** → **Revoke all cards…** → **Revoke all cards** → approve. **This really revokes every card** | "All cards revoked in one transaction." and "Balance still $X — nothing was moved." | 1:56 |

Then, from `scripts/`: `pnpm qn:stream pause`, and `pnpm qn:stream get` must say `paused`.

## The edit: 2:35 to 2:50

| Time | Footage | Voiceover | Caption |
|---|---|---|---|
| 0:00–0:07 | A, trimmed: the store, the click on **Pay**, **Approved** | "I'm buying from a store I've never used. So I pay with a card that only works there." | Sandbox card · test money · no real purchase |
| 0:07–0:16 | C | "Later that store leaks my number, and a thief tries it at Amazon. *(Declined appears.)* Declined. Useless anywhere else." | **The same card number, tried at another store** |
| 0:16–0:27 | D, punch in on the balance and the line under it | "This is SolSend: a burner card for every store. Each card holds zero dollars. My money stays in my own wallet until the moment I pay." | **solsend** · A burner card for every store |
| 0:27–0:42 | A, the card-creation part | "Making that card took one tap. Temu only, forty dollars at most. I signed in with my email: no seed phrase, and we pay the network fees." | Email login · no seed phrase · no fees |
| 0:42–1:04 | A2 at real speed, punched in on the right-hand panel | "Now watch a payment slowly. The card network asks us to approve. We move the money on Solana first. *(Approved appears.)* Only when that is confirmed do we say yes." Then read the time chip aloud | **Money moves first. Approval second.** |
| 1:04–1:16 | B | "This is that payment on Solana's public explorer. Our program calls the Solana Foundation's Allowances program. That is where the card's limit lives, not in our database." | Box and label the two programs: **SolSend program** · **Solana Subscriptions & Allowances** |
| 1:16–1:38 | A2 punched in on the badge and its line; then the architecture frame for 5 seconds; then E | "And we don't just take our own server's word for it. A QuickNode Stream reads our program's events straight from Solana and delivers each one to us. That badge appears only when the delivery really arrives. The line under it is the Stream's own cross-check: same amount, same card." | **QuickNode Streams: an independent witness** |
| 1:38–1:56 | F | "Free trials. I started a Netflix trial earlier, on a card that expires by itself. Now Netflix tries to bill me. *(Declined.)* Declined. Nothing to cancel." | Demo expiry: 2 minutes. Real cards: 7, 14 or 30 days |
| 1:56–2:16 | G | "And if I ever want out, one tap switches every card off. I sign it myself, and it goes to Solana's own Allowances program, so the permissions are gone on the chain, not just in our app. My balance never moved." | One transaction. Every card off. |
| 2:16–2:38 | End card | "Everything you saw is a working sandbox: test cards and test money on Solana's test network, and every result is a public transaction. Next: a real card issuer and a professional audit. SolSend. A burner card for every store." | (on the card) |

- **The time chip:** say "under a second" only if it shows less than 1000 ms. Otherwise read the number. It measures the whole sandbox checkout, including the simulator.
- **Store names are sandbox labels.** No purchase is made at any real store. The pill in the corner of every frame says so.
- **Cut order if over 2:55:** shorten B to 8 seconds, then trim the card creation. Never cut the QuickNode segment or the end card.
- **Length rule:** 2 to 3 minutes. Check the exported file.

## The QuickNode stream

- It bills every block while it is on, whether or not anything happens. The estimate is about 450,000 credits an hour; your dashboard is the only place to see the real figure.
- Turn it on only with `pnpm qn:stream activate`, never the dashboard's resume button. The command moves the start to the current block first.
- On for the recording, off right after, on again 15 minutes before the finals demo. After each change read the status back with `pnpm qn:stream get`.
- It ran for 11.5 minutes on 19 November for the smoke test and processed 2,946 blocks.

## If something goes wrong

| Problem | Do this |
|---|---|
| Wallet too low for another take | **Activity** → **Simulate store refund** on the last purchase, wait for "Refunded to your wallet", retake |
| "Waiting for QuickNode Stream…" for more than 15 seconds | Stop. Check `pnpm qn:stream get`. Do not record around it |
| The line under the badge starts with "Stream alert" | Stop and note the exact wording before doing anything else |
| A payment declines for time | That is the product declining by design. Retake |
| A wallet approval window fails | Use a second browser profile that is already signed in |
| Netflix card not expired yet | Wait. It needs two minutes from creation |
| No time to edit | One continuous take of A, C, F and G with live narration, trimmed under 3:00, plus the end card |

## Upload checklist

- [ ] 2:00 to 3:00 in the exported file, 1920 × 1080
- [ ] The sandbox pill is visible in the first frame, and "sandbox" is spoken once
- [ ] No full card number, CVV, expiry, email address, key or dashboard anywhere
- [ ] The QuickNode badge appeared by itself
- [ ] YouTube **Unlisted**, captions uploaded, opened in a private window on a second device
- [ ] Link pasted into Devpost and clicked from there
- [ ] A local copy saved, cut into per-beat clips for the finals
