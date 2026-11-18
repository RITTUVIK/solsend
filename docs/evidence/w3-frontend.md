# W3 frontend evidence (MOCK mode)

All screenshots below were captured by the Playwright e2e suite against a local production build with
`NEXT_PUBLIC_MOCK_API=1`. Every route is served by the in-browser fixtures (`apps/web/src/client/mock.ts`):
signatures are fake (`mockMockMock…`) and flagged "MOCK signature, not on devnet"; the header carries a
"MOCK DATA" badge. Nothing here is an onchain claim. No external network was used (the suite aborts every
non-localhost request).

Reproduce: `cd apps/web && E2E_SHOTS=$PWD/../../docs/evidence/w3-screenshots pnpm exec playwright test`
(uses system Chrome; `PW_CHANNEL=chromium` for a Playwright-downloaded browser).
Result: typecheck pass, build pass, e2e 7/7 pass.

| Step | Screenshot |
|---|---|
| Landing (desktop, dark) | `w3-screenshots/01-landing.png` |
| Home after faucet | `w3-screenshots/02-home-funded.png` |
| Home nudging the one-time wallet setup | `w3-screenshots/02b-setup-needed.png` |
| New card (explanation copy, preset pre-lock wording) | `w3-screenshots/03-new-card.png` |
| Creating: stepper (onchain allowance, then issuing) | `w3-screenshots/04-creating.png` |
| Card detail: pre-lock badge, per-field hosted iframes (mock stand-ins) | `w3-screenshots/05-card-detail.png` |
| Preset card declined at another store on FIRST use | `w3-screenshots/05b-prelock-decline.png` |
| Checkout APPROVED | `w3-screenshots/06-approved.png` |
| Void: refund signature + exact limit-stays-used message | `w3-screenshots/07-voided.png` |
| Checkout DECLINED over limit (onchain) | `w3-screenshots/08-declined.png` |
| Activity feed | `w3-screenshots/09-activity.png` |
| Card frozen | `w3-screenshots/10-frozen.png` |
| Issuer-outage panel | `w3-screenshots/11-home-outage.png` |
| `lithic_failed` with Retry | `w3-screenshots/12-lithic-failed.png` |
| Idle card with Reactivate | `w3-screenshots/12b-idle-reactivate.png` |
| `/status` | `w3-screenshots/13-status.png` |
| Desktop + dark home / status | `w3-screenshots/14-…`, `15-…` |

Covered by e2e: login, one-time wallet setup (explorer link, card creation blocked until it confirms), faucet,
Temu card, first-use decline at the wrong store (pre-lock), approve, void (exact message), onchain over-limit
decline, freeze, revoke all, `lithic_failed` + Retry, card-network safety-limit decline (no onchain tx), idle
decline + Reactivate, Other-store lock-on-first-charge, `/status`, desktop + dark mode.

Live Privy login has NOT been exercised: it needs the deployed origin and `http://localhost:3000` added to the
Privy dashboard's allowed origins plus `NEXT_PUBLIC_PRIVY_APP_ID`.
