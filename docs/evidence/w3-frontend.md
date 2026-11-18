# W3 frontend evidence (MOCK mode)

All screenshots below were captured by the Playwright e2e suite against a local production build with
`NEXT_PUBLIC_MOCK_API=1`. Every route is served by the in-browser fixtures (`apps/web/src/client/mock.ts`):
signatures are fake (`mockMockMock…`) and flagged "MOCK signature, not on devnet"; the header carries a
"MOCK DATA" badge. Nothing here is an onchain claim. No external network was used (the suite aborts every
non-localhost request).

Reproduce: `cd apps/web && E2E_SHOTS=$PWD/../../docs/evidence/w3-screenshots pnpm exec playwright test`
(uses system Chrome; `PW_CHANNEL=chromium` for a Playwright-downloaded browser).

| Step | Screenshot |
|---|---|
| Landing (desktop, dark) | `w3-screenshots/01-landing.png` |
| Home after faucet | `w3-screenshots/02-home-funded.png` |
| New card (explanation copy) | `w3-screenshots/03-new-card.png` |
| Creating: stepper (onchain allowance, then issuing) | `w3-screenshots/04-creating.png` |
| Card detail: lock badge, hosted-iframe stand-in | `w3-screenshots/05-card-detail.png` |
| Checkout APPROVED | `w3-screenshots/06-approved.png` |
| Void: refund signature + exact limit-stays-used message | `w3-screenshots/07-voided.png` |
| Checkout DECLINED over limit | `w3-screenshots/08-declined.png` |
| Activity feed | `w3-screenshots/09-activity.png` |
| Card frozen | `w3-screenshots/10-frozen.png` |
| Issuer-outage panel | `w3-screenshots/11-home-outage.png` |
| `lithic_failed` with Retry | `w3-screenshots/12-lithic-failed.png` |
| `/status` | `w3-screenshots/13-status.png` |
| Desktop + dark home / status | `w3-screenshots/14-…`, `15-…` |

Live Privy login has NOT been exercised: it needs `http://localhost:3000` added to the Privy dashboard's allowed
origins (manual action) plus `NEXT_PUBLIC_PRIVY_APP_ID`.
