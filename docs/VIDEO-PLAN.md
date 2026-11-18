# Submission video plan (target 2:45; rules: 2 to 3 minutes)

Deadline for the whole submission: Fri 2026-11-20 12:00 PM CST (UBC 2026 guide). Keep the video under 3:00 even with a title card. Flow matches [DEMO-SCRIPT.md](DEMO-SCRIPT.md) and [PITCH.md](PITCH.md). Everything shown is **Lithic sandbox + Solana devnet**; a small "SANDBOX / DEVNET" caption stays on screen throughout, and no voiceover line implies a real purchase.

## Recording setup

| Item | Setting |
|---|---|
| Layout | Primary: the app in a 390 px-wide mobile frame (browser devtools device mode, or a narrow window) centered on a clean background; switch to a full desktop window only for the Explorer and architecture shots |
| Resolution | 1920x1080, 30 fps |
| Browser | Chrome, clean profile, bookmarks bar hidden, extensions hidden, notifications off (Do Not Disturb), zoom 125% for the app, 100% for Explorer |
| Theme | Light mode for the app and Explorer |
| Account | A fresh email account for the login shot. The Netflix free-trial card (expiry chip **2 minutes (demo)**) is created at least 3 minutes before its shot |
| Wallet | About $20+ devnet USDC (faucet default is 5 USDC per claim; see [DEMO-SCRIPT.md](DEMO-SCRIPT.md)) |
| Before recording | `/api/status` green; `pnpm qn:stream activate`; after recording `pnpm qn:stream pause` and confirm `paused` |
| Audio | External or headset mic, quiet room, record voiceover separately from the screen capture and sync in editing |
| Hide | Email address and any wallet balances not part of the story; no terminal showing secrets; never show `.env` files |

## Shot list and voiceover

| Time | Shot (screen) | Voiceover |
|---|---|---|
| 0:00 to 0:15 | Title card "SolSend", the tagline, caption "Sandbox cards + Solana devnet"; cut to the landing page: "A burner card for every store." | "Every card you save online is a liability. Stores get breached, numbers leak, and free trials quietly become subscriptions." |
| 0:15 to 0:30 | Landing page, banner "Sandbox cards · Solana devnet USDC · no real merchants are charged"; tap **Try the sandbox demo** | "SolSend is a burner card for every store. The card holds nothing: your money stays in your wallet until the moment you pay. This is a sandbox with devnet test USDC." |
| 0:30 to 0:55 | Home checklist: **Get free test USDC**, **Set up wallet · free**; then **New card**, tile **Temu**, **Create Temu card · $40.00**, one signature, "Your Temu card is ready" | "I log in with an email. One signature, our server pays the fee. I am trying Temu for the first time, so I create a forty-dollar card, capped and locked to Temu from the moment it exists." |
| 0:55 to 1:20 | **Pay at the sandbox store**, **Earbuds $12**, **Pay $12.00 with ••••**; sheet: "Settling on Solana before approval…", then **Approved**, **Settled onchain first**, proof row **Settled on Solana**, **View settlement on Explorer (devnet)**, badge **Settlement streamed by QuickNode** | "Twelve dollars of earbuds. The card network asks us, we pull the USDC on Solana, and only after that transaction confirms do we say yes. Here is the settlement on the explorer, delivered by our QuickNode Stream." |
| 1:20 to 1:45 | **Try this card's number at Amazon**, **Try the leaked number at Amazon**, **Declined**, "Card locked to another store", **Rejected onchain**, failed tx on Explorer; **Pay at Temu instead**, **Drone $45**, **Pay $45.00**, **Declined** | "If Temu leaks this number, a thief at Amazon is declined onchain, even on first use. A forty-five-dollar drone is declined by the cap. Each payment must match the store ID the card network reports; our server relays it, and Solana enforces the lock and the cap." |
| 1:45 to 2:00 | Netflix free-trial card on **Wallet** stamped **EXPIRED**; pay **Monthly plan $15.49**: "This card expired when your free trial ended. Your USDC didn't move." | "A Netflix free trial I started a few minutes ago has already expired onchain, so it can't quietly become a paid plan." (Pre-create this card at least 3 minutes before you record this shot, expiry chip **2 minutes (demo)**.) |
| 2:00 to 2:15 | **Wallet**: "Most that can ever be pulled: $X across N live cards — even by SolSend."; **Revoke all cards…**, **Revoke all cards**, "All cards revoked in one transaction." | "The most anyone can ever pull is the sum of my caps. And if the issuer disappears, my money never left my wallet: one transaction revokes every card, straight to Solana's audited Allowances program." |
| 2:15 to 2:35 | Architecture diagram from [ARCHITECTURE.md](ARCHITECTURE.md), then `/status` | "Underneath: Solana's official, audited Allowances program, plus our Anchor program. 41 tests against the real binary, two AI-assisted security reviews, every finding fixed. We approve only after a confirmed settle. A hosted cold start is 2.4 seconds against a 6-second limit." |
| 2:35 to 2:45 | Closing card: live URL, repo URL, "Sandbox + devnet", Consumer Applications, Best use of Solana, QuickNode Streams | "SolSend: a burner card for every store. Honest limits: sandbox cards and devnet, a trusted server relay, and an upgradeable program. Next: a professional audit, a real issuing partner." |

Word count of voiceover is about 330 words, which fits 2:45 at a calm pace; trim, do not speed up.

## Backup recording plan

- Record the whole flow **twice** in separate takes; keep both raw files.
- Record each beat as its own clip as well, so a failed take only costs one clip.
- If the live flow misbehaves (slow sandbox void, a stalled signature), restart the take; do not patch with mock footage.
- Never include mock-UI screenshots as if they were live; if a still is needed, caption it "MOCK UI".
- Save a copy of the final video locally for the finals backup ([PITCH.md](PITCH.md)).

## Upload checklist

- [ ] Length 2:00 to 3:00 (check the exported file, not the editor timeline)
- [ ] The sandbox / devnet caption is visible and audible in the first 30 seconds
- [ ] No secrets, emails, tokenized URLs or wallet balances of real accounts visible
- [ ] Captions or subtitles added (accessibility)
- [ ] Uploaded to YouTube **Unlisted** or Google Drive; link opened in a private window to confirm judges can view it (Drive: "Anyone with the link can view")
- [ ] Link pasted into the Devpost submission ([SUBMISSION.md](SUBMISSION.md)) and checked once more
- [ ] Final video downloaded as a local backup for finals
- [ ] `pnpm qn:stream pause` run and verified after recording
- [ ] Submitted before Fri 2026-11-20 12:00 PM CST, with margin
