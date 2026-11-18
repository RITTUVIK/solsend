# SolSend

> **Sandbox + devnet demo.** Cards are Lithic **sandbox** cards. Money is **Solana devnet test USDC**. No real merchant is ever charged, no real card network settles, and nothing here is on mainnet. Merchant names in the app are sandbox labels, always shown as "(sandbox)".

### A burner card for every store — your money stays in your wallet until the moment you pay.

- Each card is an **onchain allowance that holds $0**. Nothing is pre-funded and nothing sits on an issuer's balance sheet.
- Every card is **capped and locked to one store** from creation, by Solana, not by our server's goodwill.
- Your **blast radius** is the sum of your caps: the most anyone — a hacked store, a leaked card number, even our own server — can ever pull.

**Live app: https://solsend-ashen.vercel.app** (devnet + sandbox) · SolSend program (devnet): [`GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp`](https://explorer.solana.com/address/GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp?cluster=devnet)

UBC 2026 entry. Track: Consumer Applications. Chain award: Best use of Solana. Bounty: QuickNode Streams.

## Try it (30 seconds)

1. Open https://solsend-ashen.vercel.app and log in with email. Privy creates an embedded wallet; **our server pays all fees**.
2. **Wallet**: tap **Set up wallet** (one signature), then **Get test USDC**.
3. **New card**: pick Temu, $40, **Create card** (one signature). It is capped and locked to Temu from creation.
4. **Demo store**: Temu (sandbox), $12, **Pay with SolSend card**. APPROVED, with an Explorer link to the settle that confirmed *before* the card network was told yes.
5. Try Amazon (sandbox) with the same card: declined onchain, with the failed transaction as proof. Try $45 on the $40 card: declined by the cap.
6. **Activity**: the live QuickNode feed row. **Void this purchase** returns the USDC.
7. **Revoke all cards**: one transaction, sent straight to Solana's Allowances program.

The full presenter walkthrough is in [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md).

## The problem

- Saved cards are liabilities. Card numbers leak, stores get breached, and free trials quietly become subscriptions you forget about.
- Prepaid and burner cards fix some of that but make you **pre-fund** them, so your money sits with an issuer. When an issuer fails, the card stops working at best. Competitors and prior art are compared in [docs/POSITIONING.md](docs/POSITIONING.md).

## How it works

1. **Create a card for a store.** You sign one transaction. It creates an allowance (a capped delegation) in Solana's official **Subscriptions & Allowances** program and registers a SolSend card whose only delegatee is a SolSend **Card PDA**. We issue a matching Lithic sandbox card. Your USDC stays in your wallet.
2. **Swipe.** The card network calls our Lithic ASA webhook. Our server builds a `settle` transaction and the SolSend program pulls USDC through the allowance into a treasury PDA. We reply **APPROVED only after the settle is confirmed on devnet**. Anything else declines.
3. **Stay in control.** Freeze or close any card, or revoke every allowance in one transaction, sent directly to the Allowances program even if SolSend is down. Voids refund USDC onchain to your wallet.

**Merchant lock.** Enforced onchain: each payment must match the store ID the card network reports; SolSend's server relays it; Solana enforces the lock and the cap.

## How SolSend uses Solana

| Program | ID | Role |
|---|---|---|
| **SolSend** (ours, Anchor, devnet) | [`GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp`](https://explorer.solana.com/address/GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp?cluster=devnet) | Card registry, merchant lock, per-tx cap, freeze and idle lock, `settle` and `refund`, one permanent `SettlementRecord` per authorization |
| **Subscriptions & Allowances** (official) | [`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`](https://explorer.solana.com/address/De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44?cluster=devnet) | The capped, revocable delegation behind every card; the spending cap and revocation live here |

- **The primitive.** The Allowances program is live on mainnet and devnet, was [audited by Cantina](https://github.com/solana-foundation/subscriptions/blob/main/audits/AUDIT_STATUS.md), and its mainnet build is [verified by OtterSec](https://verify.osec.io/status/De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44). Launch coverage: [Chainstack](https://docs.chainstack.com/docs/solana-subscriptions-and-allowances), [Helius](https://www.helius.dev/blog/solana-subscriptions-recurring-payments). We build on it rather than reinventing delegation. SolSend itself runs on devnet.
- **One allowance per card.** The delegatee is the card's Card PDA, which has no private key, so only the SolSend program can pull, and only inside `settle`. Existing self-custodial cards use a single delegation per wallet; per-store allowances are the difference ([POSITIONING](docs/POSITIONING.md)).
- **Settlement.** `settle` CPIs into Allowances, moving USDC from your wallet into the treasury PDA, and creates a `SettlementRecord` at `["settle", auth_hash]`. That record can never be closed, so an authorization pulls once in total.
- **Policy onchain.** Merchant lock, per-transaction cap, freeze, idle lock, and refunds only to your stored source account.
- **Speed.** Confirmation is fast enough to approve inside a card network's deadline: hosted cold start 2.4 s and warm p50 0.84 s against Lithic's 6 s hard limit.
- **Revocation.** Revoke-all is a transaction to the Allowances program, not ours.
- Accounts and PDAs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## QuickNode Streams configuration

| Setting | Value |
|---|---|
| Network | `solana-devnet` |
| Dataset | `programs_with_logs` (batch size 1) |
| Stream | `solsend-mvp-devnet`, id `7bad9332…` |
| Filter | [`infra/quicknode/filter.dist.js`](infra/quicknode/filter.dist.js), generated from the program IDL by [`build-filter.ts`](infra/quicknode/build-filter.ts). It decodes SolSend Anchor events (`CardRegistered`, `CardSettled`, `CardRefunded`, `CardFrozen`, `CardUnfrozen`, `CardClosed`, `ConfigUpdated`) from `Program data:` logs, tracking the program invoke stack so that frames of our program count and CPI "decoy" data lines from other programs are ignored. CI fails if the committed filter drifts from the IDL. |
| Destination | Webhook `POST /api/quicknode` on Vercel: HMAC-SHA256 signature over nonce, timestamp and body, timestamp window, replay-nonce guard; events are upserted idempotently into the Supabase feed |
| Consumer | The app's **Activity** feed (polled about every 1.5 s) |

**Why.** The feed is our live, authoritative activity view: every approve, decline, refund and freeze that hits the chain shows up as a row sourced from QuickNode. We use a Stream because the program emits its own events and `programs_with_logs` delivers exactly those. The Lithic token never appears onchain; the server joins the onchain `auth_hash` commitment back to the authorization.

**Measured:** `CardSettled` reached the deployed webhook **+584 ms after the settle was confirmed** ([evidence](docs/evidence/lead-deployed-e2e.md)). QuickNode devnet is also the hot-path RPC.

**Honest limits.** The trial allows one Solana stream, bills per processed block, has no reorg handling and its usage API is not readable with our key, so the stream stays **paused** outside test and demo windows. Stream rows are notifications; money decisions use RPC reads at `confirmed`. Stream lifecycle commands are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Architecture

```
Browser (Privy) -> Next.js on Vercel -> Solana devnet [SolSend program + Allowances program]
Lithic sandbox -> /api/lithic/asa (settle, confirm, reply)     Lithic events -> reconciler -> onchain refund
QuickNode Stream -> /api/quicknode -> feed                     Supabase (server-only) holds app state
```

Component and sequence diagrams, accounts, PDAs and the trust-boundary table are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**. The full trust model is in [docs/TRUST.md](docs/TRUST.md).

## Key invariants

All are tested; see [docs/TRUST.md](docs/TRUST.md).

1. **Confirmed-before-approve.** APPROVED only after the settle is confirmed (or a record for the same authorization is readable at `confirmed`). Errors, timeouts and unknown state decline.
2. **Per-authorization idempotency.** One permanent `SettlementRecord` per Lithic authorization. An authorization can pull once in total, across all cards.
3. **Refunds only to the source.** A refund goes only to the card's stored source token account, capped at settled minus already refunded.
4. **Fail-closed.** Hard 4.5 s deadline under Lithic's 6 s limit; the ASA path never throws. A settle that lands after a decline is refunded by the reconciler, which follows Lithic's transaction status.
5. **Chain is authoritative; Lithic is the outer limit.** Lithic card limits are set at 2x the onchain limit (single-use for one-time cards). They bound blast radius but never pre-empt an onchain decision in the normal range.

## Measured results

| What | Result | Evidence |
|---|---|---|
| Hosted ASA, **MOCK** (locally signed requests to our endpoint, real devnet settles), n=12 | cold first **1838 ms**, warm p50 **837 ms**, p95/max 1741 ms; 12/12 approved, 12/12 records found onchain | [lead-hosted-asa.md](docs/evidence/lead-hosted-asa.md) |
| Long-idle cold start, **MOCK** request | **2438 ms**, then warm **1043 ms**; real devnet settles, both verified onchain | [lead-hosted-asa.md](docs/evidence/lead-hosted-asa.md) |
| Real Lithic sandbox to hosted ASA | $0.37 approved (confirmed settle before reply); $0.52 declined onchain with a failed-tx signature | [lead-hosted-asa.md](docs/evidence/lead-hosted-asa.md) |
| Real Lithic flow on the deployed stack | approve, QuickNode delivery **+584 ms**, async void, reconciler refund | [lead-deployed-e2e.md](docs/evidence/lead-deployed-e2e.md) |
| Hot path on QuickNode RPC, **MOCK**, n=50 (CP0b, laptop) | 50/50 approved only after `confirmed`; p50 852 ms, p99 1027 ms | [GATE0.md](GATE0.md) |
| Program tests | 41 LiteSVM tests against the **real devnet Allowances binary** | [w1-program-devnet.md](docs/evidence/w1-program-devnet.md) |

Latencies are measured from Halifax; functions run in Vercel `iad1`. Every onchain claim is indexed with its devnet signature in **[docs/EVIDENCE.md](docs/EVIDENCE.md)**.

## Security work

- **Two adversarial security reviews, all findings fixed.** These were AI-assisted reviews: separate Claude review agents, each with fresh context and only the code to work from. They are not a professional third-party audit. The **program review** found no Critical issue and no fund-theft path; its High, Medium and Low findings were fixed in a devnet upgrade ([report](docs/evidence/audit-program-cp1.md)). The **backend review** found no Critical issue; its High, 5 Medium and Low findings were fixed and pinned as regression tests ([report](docs/evidence/audit-backend-cp1.md)). An earlier internal security review shaped the contract (no memo so Lithic tokens never go onchain, permanent replay records, Lithic outer limits).
- **Supabase lockdown.** RLS on all tables with no policies; `anon` and `authenticated` hold no privileges. Verification caught an ineffective `PUBLIC` execute grant, which was then revoked. `supabase/verify.mts` passes 11/11. The browser never talks to Supabase.
- **Unauthenticated calls** to the sensitive routes return 401 on the deployment.
- **Secret scanning.** gitleaks runs as a pre-commit hook and in CI. Secrets live only in Vercel env or gitignored local files.
- **Demo Merchant.** The sandbox card number is read in server memory only; it is never returned, logged or stored, and non-sandbox Lithic hosts are refused.

## Tracks and bounties

| Track | How SolSend fits |
|---|---|
| Consumer Applications | Blockchain interaction plus a user-facing app. Email login, no seed phrase, no fees for the user, one card per store, one-tap revoke-all. Meant for everyday use: a burner card for each new store or trial. |
| Best use of Solana | Program IDs above; Allowances delegation with a program-owned Card PDA as delegatee, per-authorization settlement records, onchain refunds and policy. |
| QuickNode Streams bounty | A real Stream with a filter and a destination (configuration above), driving the live activity feed, with measured delivery latency. |

## Repo map

| Path | What |
|---|---|
| [programs/solsend](programs/solsend) | Anchor program (register_card, settle, refund, freeze, unfreeze, close) and LiteSVM tests |
| [packages/shared](packages/shared) | IDL, PDAs, instruction builders, commitments, Zod API contracts |
| [apps/web](apps/web) | Next.js app: UI, API routes, ASA hot path, reconciler |
| [infra/quicknode](infra/quicknode) | Stream filter, build and self-test, stream control CLI |
| [supabase](supabase) | Migrations, migrate and verify scripts |
| [scripts](scripts) | Devnet deploy and smoke scripts, ops CLIs, `merchant-sim` fallback |
| [docs](docs) | [ARCHITECTURE](docs/ARCHITECTURE.md), [TRUST](docs/TRUST.md), [EVIDENCE](docs/EVIDENCE.md), [POSITIONING](docs/POSITIONING.md), [DEMO-SCRIPT](docs/DEMO-SCRIPT.md), [PITCH](docs/PITCH.md), [VIDEO-PLAN](docs/VIDEO-PLAN.md), [SUBMISSION](docs/SUBMISSION.md), [DEPLOY](docs/DEPLOY.md), [CP1-CONTRACTS](docs/CP1-CONTRACTS.md) |
| [GATE0.md](GATE0.md) | Early validation history (CP0b) |

## Local dev quickstart

Requires Node 22+ and pnpm 10.

```bash
pnpm install
cp .env.example apps/web/.env.local   # fill in your own devnet/sandbox values; never commit them
pnpm dev                               # http://localhost:3000
pnpm test                              # unit tests (shared + web)
pnpm test:program                      # LiteSVM program tests (needs Rust and the dumped Allowances .so)
```

Variables are documented in [`.env.example`](.env.example). Deployment and the Stream lifecycle are in [docs/DEPLOY.md](docs/DEPLOY.md). A UI-only mock mode (`NEXT_PUBLIC_MOCK_API=1`) exists for front-end work; no claim in this README comes from it.

## Limitations and trust assumptions

- **Sandbox + devnet only.** No real merchants, no card-network settlement, no mainnet. Treasury-to-issuer settlement is out of scope.
- **The settlement authority is trusted to relay the card network's authorization and merchant ID.** Lithic signs requests to us (HMAC-verified), but the program cannot verify that onchain. The chain enforces the caps and the lock; a compromised key can pull live cards only up to their remaining caps and only into the treasury PDA, and the admin can pause and rotate.
- **The program is upgradeable on devnet.** The deployer is the upgrade authority. Freezing the program after the hackathon is the mitigation.
- **Legacy records can't be refunded.** 43 SettlementRecords from before Upgrade 1 use the old seeds and cannot be refunded through the program (0.82 devnet USDC outstanding, accepted for devnet).
- **No treasury withdrawal in the MVP.** Funds leave the treasury only through refunds to the original source account.
- **Refunds do not restore the card limit.** Deliberate: we never silently re-grant spending permission.
- **Lithic sandbox voids are asynchronous.** The refund follows Lithic's event, not our local reply.
- **QuickNode trial limits** apply; the stream stays paused when not demoing.
- **Card creation is not atomic across systems** (onchain first, then Lithic, with a retry). An onchain card with no Lithic card cannot be pulled.
- **Public onchain:** owner wallet, card PDAs, settle and refund amounts and timing, and a pseudonymous `merchant_hash`. Never onchain: Lithic tokens, card numbers, merchant names, emails.

## Roadmap

- Freeze the program or move to a multisig upgrade authority, and re-audit, before any mainnet use.
- Free-trial cards that expire onchain, and subscription guardrails (in progress).
- Treasury-to-issuer settlement with a capped, refund-aware withdrawal.
- Incremental authorizations and partial captures; an opt-in "restore limit on refund".
- A live issuing partner and the compliance work that comes with it.
