# SolSend — GATE 0 spikes (throwaway)

> **Historical.** These spikes ran on 16 and 17 November to choose the architecture; results are frozen in [`../GATE0.md`](../GATE0.md). Steps G0.1 to G0.6 belong to the **abandoned Stripe + Bridge card track** (Bridge stablecoin cards were sales-gated and excluded Canadian cardholders) and are no longer meant to be run; their sandbox keys are not used by the app. The shipped product uses Lithic sandbox cards and lives in `apps/`, `programs/` and `packages/`.

These are validation scripts only. They run on Solana **devnet** against provider **sandboxes**, and nothing here ships. Results go to [`../GATE0.md`](../GATE0.md), and per-step evidence goes to `evidence/<step>.jsonl`.

## Setup

1. Devnet keypairs live **outside the repo** in `~/.config/solsend/devnet/` (`deployer`, `card-a-owner`, `fee-payer`), plus `cli.yml`.
2. Copy the env template and fill it in: `cp .env.example .env`. The `.env` file is gitignored, so never commit it or paste its contents anywhere.
3. Install dependencies: `pnpm install`. This respects `minimum-release-age` (14 days).

## Run order

| Step | Command | Needs |
|---|---|---|
| Preflight + G0.9 | `pnpm g00:preflight` | nothing |
| Spike program tests (LiteSVM) | `cd pda_vault_spike && anchor test` | nothing |
| Spike program deploy | `cd pda_vault_spike && anchor deploy --provider.cluster devnet` | ~2 SOL on `deployer` |
| G0.1 | `pnpm g01:enable-cards` | `STRIPE_SECRET_KEY`, `BRIDGE_API_KEY` |
| G0.2 | `pnpm g02:customer` (then `pnpm g02:refresh [--simulate]` if it lapses) | G0.1; human accepts ToS |
| G0.3 | `pnpm g03:card-a`, then `pnpm g03:card-a --revoke-test` | G0.2; ≥10 USDC + SOL on `card-a-owner` |
| G0.4 | `pnpm g04:card-b` | G0.2; spike program deployed |
| G0.5 | `pnpm g05:isolation` | G0.3 + G0.4 |
| G0.6 | `pnpm g06:refund --mode reverse`, then `--mode refund` | G0.3 |
| G0.7 offline | `QN_STREAM_SECURITY_TOKEN=$(openssl rand -hex 24) G07_PORT=8799 pnpm exec tsx src/g07-selftest.ts` | nothing |
| G0.7 live | `pnpm g07:webhook` + `ngrok http 8787` + `pnpm g07:stream --test-slot <slot>` + `pnpm g07:probe` | `QUICKNODE_API_KEY` |
| G0.8 | `pnpm g08:server` + `pnpm g08:web` → http://localhost:5173 | `VITE_PRIVY_APP_ID`; SOL on `fee-payer` |

## Guards built in

- **Devnet only.** Scripts refuse to run unless the RPC's genesis hash is devnet's.
- **Sandbox keys only.** Stripe keys must start with `sk_test_` or `rk_test_`. Bridge keys must start with `sk-test` and be used against the sandbox host.
- **Evidence scrubbing.** Evidence records are scrubbed of `number`, `cvc`, `pan` and KYC/ToS link tokens. Full payloads go to `.raw/`, which is gitignored.
- **Labelled sandbox merchant.** Simulated purchases use the merchant `"SolSend G0 Test Merchant (sandbox)"`.
- **Synthetic cardholder.** Every Bridge customer field is synthetic test data. The fixture country is Canada.
