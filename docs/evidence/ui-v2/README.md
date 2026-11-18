# UI v2: before and after

The UI redesign on branch `feat/ui-v2` (on top of `388d1e3`). All screenshots run in MOCK mode (`NEXT_PUBLIC_MOCK_API=1`), so every signature carries a `MOCK` tag and no real devnet data appears. Mobile shots are 390×844 at 2x. Desktop shots are 1440×900, downscaled.

## What changed (ranked by impact)
1. **Blocker fixed: the payment result appeared off-screen.**
   - Before, the APPROVED/DECLINED result on mobile rendered at y≈811 of 844, behind the tab bar (`before-03`).
   - Pay now opens a bottom sheet at once (a right-hand panel on desktop). It shows one honest progress line, then the outcome: amount, `Wallet $100 → $88`, remaining limit, and decision time.
   - An e2e test asserts the result is fully in view at 390×844.
2. **Design tokens.**
   - Paper and ink neutrals, with mint for brand moments only.
   - Violet means onchain proof; amber means sandbox.
   - Geist and Geist Mono come through `next/font`.
   - The primary button is ink-on-paper (19:1 contrast). The old white-on-emerald was 3.77:1.
3. **Cards.**
   - Real 1.586 aspect ratio and CSS art per store, using monograms and no logos.
   - Status shows on the card face: Frozen, Revoked, Expired, Idle.
   - "SANDBOX" appears as small print, like "DEBIT" on a real card.
4. **ProofRow.** Every onchain claim now uses one compact row: explorer link, short signature, an expandable full signature, the Lithic token, and the commitment. A QuickNode badge appears once per receipt, not on every row.
5. **Honesty labels.**
   - The banner text is unchanged (a test checks it). It is restyled in soft amber and wraps without stranding a "·".
   - Each surface carries at most one local sandbox mark.
   - Lock wording is accurate: "Locked to Temu (sandbox)". The info text says the store ID comes from the card network and is relayed by SolSend's server, and that Solana enforces the lock and the cap.
6. **Declines.** A short reason, then one sentence ending "Your USDC didn't move.", then an action that fixes it, for example "Pay at Temu instead".
7. **Home.**
   - A large balance figure.
   - A blast-radius line: *Most that can ever be pulled: $X across N live cards — even by SolSend.*
   - A 3-step checklist that shows one primary action at a time.
   - Cards stacked like Apple Wallet.
   - Revoke-all moved to a Safety row behind a confirm sheet.
8. **Free-trial cards.**
   - New presets: auto-expire after a 7-day trial, 14 days, 30 days, or 2 minutes (demo). The choice is sent as `expiresInMinutes`.
   - Netflix defaults to a free-trial template.
   - Expired cards are stamped "Expired". Their declines read "This card expired when your free trial ended. Your USDC didn't move."
9. **Store page.**
   - Products replace amounts; the $45 drone triggers the over-limit decline.
   - Trying a locked card at another store shows a leaked-number callout.
   - Activity shows one row per purchase, with a detail sheet.
   - Card detail has a Pay / Details / Freeze / More action row. Details shows Lithic's iframes on the card back; we never render the PAN or CVV ourselves.
10. **Accessibility.**
    - Native `<dialog>` sheets give focus trapping and Escape.
    - Arrow keys move between radio options.
    - Tap targets are 36–44 px.
    - Reduced-motion users get a static frame or a crossfade.
    - Tertiary text meets AA contrast in both themes.

## Files
| Before | After |
|---|---|
| `before-01-landing.png` | `after-01-landing.png` (loop captioned "Illustration of the sandbox demo") |
| `before-02-home-empty.png` | `after-02-home-checklist-blast-radius.png` |
| `before-03-after-pay-result-offscreen.png` | `after-03a-pay-sheet-settling.png`, `after-03b-pay-sheet-approved.png` |
| `before-04-approved.png` | `after-04-proofrow-expanded.png` |
| `before-05-decline.png` | `after-05-decline-leaked-number.png` |
| `before-06-activity.png` | `after-06-activity.png` |
| `before-07-card-detail.png` | `after-07-card-detail.png` |
| `before-08-card-details-desktop-dark.png` | `after-08-card-back-lithic-frames-dark.png` |
| — | `after-09-wallet-stack.png`, `after-10-new-card-free-trial.png`, `after-11-card-born.png`, `after-12-expired-free-trial.png`, `after-13-void-refunded-timeline.png` |
| — | `after-14-pay-sheet-approved-dark.png`, `after-15-desktop-pay-panel.png`, `after-16-desktop-dark-home.png` |

## Verification
- `pnpm exec tsc --noEmit` passes.
- `next build` passes in both mock and normal mode.
- vitest: 115 passed.
- Playwright e2e (system Chrome, mock): 10/10. New tests cover:
  - the approval sheet being in view at 390×844 with no horizontal scroll;
  - a free-trial card that expires, using the Playwright clock;
  - the blast-radius amounts.
- No new runtime dependencies.
