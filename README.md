# SolSend

> **Sandbox + devnet demo.** Cards are Lithic **sandbox** cards. Money is **Solana devnet test USDC**. No real merchant is ever charged, no real card network settles, and nothing here is on mainnet. Merchant names in the app are sandbox labels, always shown as "(sandbox)".

**Burner cards for every store, spending straight from your Solana wallet.**

Live demo: **https://solsend-ashen.vercel.app** (devnet + sandbox) · Program (devnet): [`GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp`](https://explorer.solana.com/address/GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp?cluster=devnet)

UBC 2026 entry. Tracks: Consumer Applications, Best use of Solana, and the QuickNode Streams bounty.

## The problem

- Card numbers leak. One breached store and your main card is compromised.
- Prepaid and burner cards fix that, but force you to **pre-fund** them. Your money sits on someone else's balance sheet, and you cannot get it out when the issuer has an outage or goes bankrupt.

## How it works

1. **Create a card for a store.** You sign one transaction. It creates an allowance (a capped delegation) in Solana's official **Subscriptions & Allowances** program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) and registers a SolSend card. We then issue a matching Lithic sandbox card. Your USDC stays in your wallet.
2. **Swipe.** The card network calls our Lithic ASA webhook. Our server builds a `settle` transaction; the SolSend program pulls USDC through the allowance into a treasury PDA. We reply **APPROVED only after the settle is confirmed on devnet**. Anything else declines.
3. **Stay in control.** Freeze or close any card, or revoke every allowance in one transaction, directly in the Allowances program even if SolSend is down. Voids refund USDC onchain to your wallet.

## Why Solana

| Need | What Solana gives us |
|---|---|
| Spend from a wallet without pre-funding | The Allowances program: a capped, revocable delegation per card. Nothing moves until a swipe. |
| "Only SolSend can pull, and only inside `settle`" | The delegatee is a **Card PDA**. A PDA has no private key; only our program can sign for it. |
| Approve inside a card-network deadline (Lithic hard limit 6 s) | Sub-second confirmation. Measured hosted approvals: cold 1.8 to 2.4 s, warm p50 about 0.84 s, all within our 4.5 s budget. |
| Replay-proof authorizations | One `SettlementRecord` PDA per authorization, created atomically with the pull. |
| A UI that proves what happened | Every approve, decline, refund and freeze has a public devnet signature. |

## QuickNode Streams

A `programs_with_logs` Stream on the SolSend program decodes our Anchor events (`CardSettled`, `CardRefunded`, `CardFrozen`, ...) in a sandboxed filter and delivers them to an HMAC-authenticated, replay-protected webhook (`POST /api/quicknode`). The app's **Activity** page polls the resulting feed, so a swipe appears as a settled row sourced from QuickNode.

- Measured in the deployed stack: `CardSettled` delivered **+584 ms after the settle was confirmed** ([evidence](docs/evidence/lead-deployed-e2e.md)).
- The Lithic token is never onchain. The server joins the onchain `auth_hash` commitment back to the authorization.
- Hot-path RPC is also QuickNode devnet.
- Honest limits: the trial allows one Solana stream, bills per processed block, and has no reorg handling. The stream is kept **paused** outside test and demo windows. Feed rows are notifications; money decisions use RPC reads at `confirmed`.

## Try it (30 seconds)

1. Open https://solsend-ashen.vercel.app and log in with email. Privy creates an embedded wallet; **our server pays all fees**.
2. **Wallet**: tap **Set up wallet** (one signature), then **Get test USDC** (devnet).
3. **New card**: pick Temu, $40, **Create card** (one signature). It is locked to Temu from creation.
4. **Demo store**: choose Temu, amount 12, **Pay with SolSend card**. You get APPROVED plus an Explorer link to the confirmed settle. Try Amazon: declined onchain, with the failed transaction as evidence.
5. **Activity**: watch the QuickNode feed row (while the stream is active), then **Void this purchase** to see USDC return.

The full 3 to 4 minute walkthrough is in [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md).

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
2. **Per-authorization idempotency.** One permanent `SettlementRecord` per Lithic authorization (`["settle", auth_hash]`, never closed). An authorization can pull once in total, across all cards.
3. **Refunds only to the source.** A refund goes only to the card's stored source token account, capped at settled minus already refunded.
4. **Fail-closed.** Hard 4.5 s deadline under Lithic's 6 s limit; the ASA path never throws. A settle that lands after a decline is refunded by the reconciler, which follows Lithic's transaction status.
5. **Chain is authoritative; Lithic is the outer limit.** Lithic card limits are set at 2x the onchain limit (single-use for one-time cards). They bound blast radius but never pre-empt an onchain decision in the normal range.

## Measured results

| What | Result | Evidence |
|---|---|---|
| Hosted ASA, **MOCK** (locally signed requests to our endpoint, real devnet settles), n=12 | cold first **1838 ms**, warm p50 **837 ms**, p95/max 1741 ms; 12/12 approved, 12/12 records found onchain | [lead-hosted-asa.md](docs/evidence/lead-hosted-asa.md) |
| Long-idle cold start, **MOCK** request (first-ever invocation of a fresh deploy) | **2438 ms**, then warm **1043 ms**; real devnet settles, both verified onchain | [lead-hosted-asa.md](docs/evidence/lead-hosted-asa.md) |
| Real Lithic sandbox to hosted ASA | $0.37 approved (confirmed settle before reply); $0.52 declined onchain with a failed-tx signature | [lead-hosted-asa.md](docs/evidence/lead-hosted-asa.md) |
| Real Lithic flow on the deployed stack | approve, QuickNode delivery **+584 ms**, async void, reconciler refund | [lead-deployed-e2e.md](docs/evidence/lead-deployed-e2e.md) |
| Hot path on QuickNode RPC, **MOCK**, n=50 (CP0b, laptop) | 50/50 approved only after `confirmed`; p50 852 ms, p99 1027 ms | [GATE0.md](GATE0.md) |
| Program tests | LiteSVM against the **real devnet Allowances binary** | [w1-program-devnet.md](docs/evidence/w1-program-devnet.md) |

Latencies are measured from Halifax; functions run in Vercel `iad1`. Every onchain claim is indexed with its devnet signature in **[docs/EVIDENCE.md](docs/EVIDENCE.md)**.

## Security work

- **A security review and an independent program audit, with fixes shipped.** The review produced contract amendments (no memo so Lithic tokens never go onchain, permanent replay records, Lithic outer limits, a fail-closed status gate, Supabase secret keys). The audit found no Critical issue and no fund-theft path; its High, Medium and Low findings were fixed in a devnet upgrade. See [audit-program-cp1.md](docs/evidence/audit-program-cp1.md).
- **Supabase lockdown.** RLS on all 9 tables with no policies; `anon` and `authenticated` hold no privileges. Verification caught an ineffective `PUBLIC` execute grant on a SECURITY DEFINER function, which was then revoked. `supabase/verify.mts` passes 11/11. The browser never talks to Supabase.
- **Unauthenticated calls** to the ASA, QuickNode, cards, reconcile, admin and demo-checkout routes all return 401 on the deployment.
- **Secret scanning.** gitleaks runs as a pre-commit hook and in CI. Secrets live only in Vercel env or gitignored local files.
- **Demo Merchant.** The sandbox card number is read in server memory only; it is never returned, logged or stored, and non-sandbox Lithic hosts are refused.

## Tracks and bounties

| Track | How SolSend fits |
|---|---|
| Consumer Applications | Email login, no seed phrase, no fees for the user, one card per store, one-tap revoke-all. |
| Best use of Solana | Allowances delegation with a program-owned Card PDA as delegatee, per-authorization settlement records, onchain refunds and policy (merchant lock, per-tx cap, freeze, idle lock). |
| QuickNode Streams bounty | A real Stream on the program, a filter that decodes events, an HMAC-verified webhook, a live activity feed and measured delivery latency. |

## Repo map

| Path | What |
|---|---|
| [programs/solsend](programs/solsend) | Anchor program (register_card, settle, refund, freeze, unfreeze, close) and LiteSVM tests |
| [packages/shared](packages/shared) | IDL, PDAs, instruction builders, commitments, Zod API contracts |
| [apps/web](apps/web) | Next.js app: UI, API routes, ASA hot path, reconciler |
| [infra/quicknode](infra/quicknode) | Stream filter, build and self-test, stream control CLI |
| [supabase](supabase) | Migrations (0001 schema, 0002 lockdown), migrate and verify scripts |
| [scripts](scripts) | Devnet deploy and smoke scripts, ops CLIs, `merchant-sim` fallback |
| [docs](docs) | [ARCHITECTURE](docs/ARCHITECTURE.md), [TRUST](docs/TRUST.md), [EVIDENCE](docs/EVIDENCE.md), [DEMO-SCRIPT](docs/DEMO-SCRIPT.md), [DEPLOY](docs/DEPLOY.md), [CP1-CONTRACTS](docs/CP1-CONTRACTS.md) |
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

Variables are documented in [`.env.example`](.env.example) (Solana devnet RPC, keys, Lithic sandbox, Privy, Supabase, QuickNode). Deployment and the Stream lifecycle are in [docs/DEPLOY.md](docs/DEPLOY.md). A UI-only mock mode (`NEXT_PUBLIC_MOCK_API=1`) exists for front-end work; no claim in this README comes from it.

## Limitations and trust assumptions

- **Sandbox + devnet only.** No real merchants, no card-network settlement, no mainnet. Treasury-to-issuer settlement is out of scope.
- **The settlement authority is trusted to attest each authorization.** Lithic signs requests to us (HMAC-verified), but the program cannot verify that onchain. A compromised key can pull live cards only up to their remaining caps and only into the treasury PDA; the admin can pause and rotate.
- **The program is upgradeable on devnet.** The deployer is the upgrade authority. Freezing the program after the hackathon is the mitigation.
- **Legacy records can't be refunded.** 43 SettlementRecords from before Upgrade 1 use the old seeds and cannot be refunded through the program (0.82 devnet USDC outstanding, accepted for devnet).
- **No treasury withdrawal in the MVP.** Funds leave the treasury only through refunds to the original source account.
- **Refunds do not restore the card limit.** This is deliberate: we never silently re-grant spending permission.
- **Lithic sandbox voids are asynchronous.** The refund follows Lithic's event, not our local reply.
- **QuickNode trial limits** apply (one stream, per-block billing, no reorg handling); the stream stays paused when not demoing.
- **Card creation is not atomic across systems** (onchain first, then Lithic, with a retry). An onchain card with no Lithic card cannot be pulled.
- **Public onchain:** owner wallet, card PDAs, settle and refund amounts and timing, and a pseudonymous `merchant_hash`. Never onchain: Lithic tokens, card numbers, merchant names, emails.

## Roadmap

- Freeze the program or move to a multisig upgrade authority, and re-audit, before any mainnet use.
- Treasury-to-issuer settlement with a capped, refund-aware withdrawal.
- Incremental authorizations and partial captures; an opt-in "restore limit on refund" choice for the user.
- A live issuing partner and the compliance work that comes with it.
