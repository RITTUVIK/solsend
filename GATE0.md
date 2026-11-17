# GATE 0 — Validation Report (Checkpoint 0)

**Status: IN PROGRESS. The provider-dependent tests (G0.1–G0.8) are blocked on external accounts and devnet funding. The local tests are done.**
Branch `feat/gate0-validation` · last updated 2026-11-17 · all onchain activity is **Solana devnet**, and all provider activity is **sandbox**.

Raw evidence: `spikes/evidence/<step>.jsonl` (timestamped, scrubbed of PAN/CVC and link tokens). Run guide: [`spikes/README.md`](spikes/README.md).

## Results

| Item | Status | Evidence / blocker |
|---|---|---|
| G0.1 Stripe Sandbox (CA) ↔ Bridge sandbox, `POST /v0/cards/enable` | **UNTESTED** | Script ready (`g01:enable-cards`); it checks `account.country === "CA"` first. Blocked on Stripe Sandbox and Bridge sandbox access (see Finding F1). |
| G0.2 Bridge customer `["base","cards"]` → KYC link → `stripe_cardholder_id` | **UNTESTED** | Script ready (`g02:customer`, plus `g02:refresh` for the 24h lapse). Uses a synthetic **Canadian** fixture. A Canadian cardholder may fail `customer_region_supports_cards` (F2). |
| G0.3 Card A (keypair wallet): card → approve 10 USDC → $1.14 auth → onchain pull | **UNTESTED** | Script ready (`g03:card-a`). Blocked on G0.2, devnet SOL and devnet USDC. |
| G0.3b Revoke → auth declined? (added to inform freeze/expire design) | **UNTESTED** | Script ready (`g03:card-a --revoke-test`). |
| G0.4 Card B (PDA wallet) | **PARTIAL** | **Program side: PASS.** The PDA-owned ATA approves and revokes the derived issuer delegate through `invoke_signed`, with 5/5 LiteSVM tests passing (below). **Stripe/Bridge accepting a PDA address: UNTESTED.** The devnet deploy needs about 2 SOL. |
| G0.5 Cards A and B, same cardholder, each pulls only from its own wallet | **UNTESTED** | Script ready (`g05:isolation`). Depends on G0.3 and G0.4. |
| G0.6 Reverse/refund → time until USDC returns onchain | **UNTESTED** | Script ready (`g06:refund --mode reverse\|refund`). |
| G0.7 QuickNode Stream (devnet) → filter → webhook, latency | **PARTIAL** | **Offline: PASS.** The filter matched correctly on both datasets; the webhook accepted a valid HMAC and rejected a replay, a wrong key and a stale timestamp. **Live stream and latency: UNTESTED** (needs a QuickNode API key). |
| G0.8 Privy embedded wallet signs; server fee payer is `feePayer` | **UNTESTED** | Server and page are ready. The page bundles cleanly. Needs a Privy App ID and about 0.1 SOL on `fee-payer`. |
| G0.9 Toolchain + test framework | **PASS** | `anchor-cli 1.2.2`, `solana-cli 4.1.2 (Agave)`, `cargo-build-sbf 4.1.0` / platform-tools v1.54, rustc 1.95.0, node v22.19.0, pnpm 10.24.0. The recommended test framework is **LiteSVM**, the default `anchor init` template in 1.2.2 (Mollusk, mocha and jest are alternatives). Source: Anchor v1.2.2 `docs/content/docs/installation.mdx`. Evidence: `evidence/g09.jsonl` (2026-11-17T08:18:14Z). |

**G0.4 LiteSVM evidence** (`cd spikes/pda_vault_spike && anchor test`, 2026-11-17):
`pda_vault_can_approve_issuer_delegate_and_revoke` ✅ · `wrong_issuer_delegate_is_rejected` ✅ (error 6000) · `approve_above_balance_is_rejected` ✅ (error 6001) · `another_signer_cannot_approve_someone_elses_vault` ✅ · `withdraw_returns_funds_to_authority` ✅

**Tier decision: PENDING.** Tier 1 needs G0.1–G0.3 to pass. The vault model is PDA if G0.4 passes; otherwise it is the *secure fallback* below, **not** DERIVED_KEYPAIR.

## Environment set up for Gate 0

- **Toolchain.** I installed AVM and Anchor 1.2.2 from the `v1.2.2` tag. That tag is the same commit (`8d9d1488`) on both `solana-foundation/anchor` and `otter-sec/anchor`, and the binary was attestation-verified. I added Rust 1.95.0 as an extra toolchain (your default stays 1.87; `anchor-lang` 1.2.2 needs ≥1.89).
- **Global Solana CLI side effect.** The AVM `anchor` proxy switched the **global** Solana CLI from 2.3.9 to **4.1.2**, the version Anchor 1.2.x recommends, and AVM has no opt-out. Your global CLI config is unchanged (testnet RPC, personal key). To revert after the hackathon: `agave-install init 2.3.9`.
- **Project devnet environment, outside the repo.**
  - `~/.config/solsend/devnet/` (mode 700) holds `deployer` `peENpfyrTzWyHejccTYto9Jg46UjqKfEaK3ye5xaP8L`, `card-a-owner` `DEGx8bvPLZQDS65xbw79My2tV97cfqsKQfGos6Nq3nWe` and `fee-payer` `3dQxfxtUXJrNXXApsByeRy8pB7gHQpZfHxVruy2S3r7m`, plus `cli.yml` (devnet).
  - The personal wallet is not used anywhere.
  - Every script refuses to run unless the RPC's genesis hash is devnet's, the Stripe key is `sk_test_`/`rk_test_`, and the Bridge key is `sk-test` against the sandbox host.
- **Secrets hygiene.** `.gitignore` covers `.env*`, keypairs and build output. `.gitleaks.toml` extends the gitleaks defaults with rules for Solana keypair JSON, QuickNode tokenized URLs, Bridge/Privy key assignments and raw PANs; each was checked against synthetic samples. The `.githooks/pre-commit` hook blocks sensitive filenames and runs gitleaks on the staged diff. It's enabled locally through `core.hooksPath`; each teammate runs `git config core.hooksPath .githooks` once.
- **Supply chain.** Every npm dependency is pinned exactly and was at least 14 days old (`minimum-release-age` in `spikes/.npmrc`). pnpm's default blocking of dependency build scripts is left on.

## Findings that change the plan (from docs, to be confirmed by the tests)

- **F1: Tier 1 access may be gated.**
  - Stripe calls stablecoin-backed Issuing "public preview… contact Stripe sales". After the program addendum, Stripe sets up the sandbox and Bridge developer account.
  - Bridge's own guide says Stripe **Test Mode is not supported**; testing needs a **Stripe Sandbox**.
  - `crypto_wallet` and `crypto_transactions` appear only in private-preview SDKs. The scripts therefore use raw HTTP and try the account-default and `2026-10-28.preview` API versions, recording which one worked.
- **F2: Canadian cardholders are not documented.** Consumer stablecoin-card cardholders are documented for "the US, Latin America, the Caribbean, Africa, and Asia", and Canada is not named. The synthetic fixture stays Canadian (hard rule 6). If Bridge reports `customer_region_supports_cards` missing, **I will stop and ask you**; I won't change the fixture country on my own.
- **F3: PDA wallets are unproven on Bridge's side.** Bridge's sample derives the ATA without `allowOwnerOffCurve`. Stripe's preview SDK also lists `crypto_wallet[type]=squads`, which suggests smart-account (PDA) wallets go down a separate path. G0.4 tests the `standard` type with a PDA. If that fails, `squads` is a lead, not a plan.
- **F4: The hold is larger than the purchase.** `hold_amount = network + reserve + estimated_fee`, so the delegate approval must cover more than the purchase. Simulations use the explicit MCC `computer_software_stores`, because the API example's taxi MCC carries a 20% reserve.
- **F5: The transaction hash can arrive late.** Stripe may send `issuing_authorization.created` before the onchain pull confirms, and `crypto_transactions[]` is a typed list. Scripts filter on `type === "crypto_transaction_confirmed"` and never read `[0]`.
- **F6: Refunds are asynchronous and may be batched.** "Bridge returns the funds to the wallet asynchronously and might combine multiple refunds into one onchain transaction." G0.6 watches the ATA for any inbound transfer and doesn't assume a 1:1 mapping.
- **F7: QuickNode limits and datasets.**
  - The Free plan is a 1-month trial with 1 active stream and no compression.
  - Solana datasets are only `block` and `programs_with_logs`.
  - Webhook HMAC: `hex(HMAC-SHA256(token, nonce + timestamp + body))`.
  - The filter matches on *our vault ATAs or our program*, never the Token program or `cardWArq…` alone, because those would deliver every devnet token transfer or Bridge pull.
- **F8: Privy sponsorship only works with sign-and-send.** Privy's native sponsorship (`sponsor: true`) exists only on sign-and-send. Our design has the server pay fees on a sign-only transaction, so G0.8 tests whether `signTransaction` partially signs when another account is the fee payer. A fallback (`signMessage` over the message) is built in.
- **F9: Anchor 1.x changed.** The TypeScript client is `@anchor-lang/core`, `CpiContext::new` takes a program ID, and `anchor-spl` 1.2.2 `idl-build` fails without default features (an upstream gating bug). The default test template is LiteSVM.

## Security audit: the DERIVED_KEYPAIR fallback (rejected)

The proposal is a card vault key seed `= sha256(wallet.signMessage("SolSend card v1:" + card_id))`. **Recommendation: do not build it.**

1. **It treats a signature as a secret.** Message signatures are designed to be public and verifiable. Wallets, sign-in flows, backends, analytics and extensions routinely send and store them. Anyone who ever sees the signature has the vault's private key forever.
2. **It is easy to phish.** The message is fixed and predictable (sequential `card_id`, no domain, no nonce). Any malicious site can ask the user to "verify your SolSend card" by signing the same string and then derive the keys to **every** card offline. Wallet UIs give no warning that this signature is a private key.
3. **It relies on deterministic signing.** Ed25519 is deterministic by spec, but wallets aren't obliged to be. MPC/threshold signers can use random nonces; Ledger wraps off-chain messages in a header; wallet updates or switching wallets can change the bytes. Any of these produces a different derived key, and funds in the old vault are **permanently unreachable**.
4. **The key lives in page JavaScript.** The derived private key sits in app memory, so XSS, a malicious dependency or a browser extension can exfiltrate it. Wallet keys, by contrast, stay in the wallet or enclave.
5. **It can't be rotated or revoked.** A leaked signature compromises that vault for good.
6. **It discards onchain enforcement.** A keypair-owned ATA can transfer, approve unlimited amounts or close directly through SPL, bypassing our program. Invariants I1–I6 would become advisory, and the README's claim that caps and locks are enforced onchain would be false.

**Secure alternatives, in order:**

- **A. PDA vault (preferred, if G0.4 passes).** Only the program can sign for the vault, so I1–I7 are enforceable.
- **B. One Privy HD embedded wallet per card** (`createWallet({ createAdditional: true })`, path `m/44'/501'/i/0'`).
  - Keys are generated with real entropy and held in Privy's TEE (AWS Nitro plus 2-of-2 Shamir shares). Our JavaScript never sees a private key, and Bridge sees an ordinary on-curve wallet.
  - Costs:
    - There's a per-user wallet cap, about 10, unverified for Solana.
    - It only works for embedded-wallet users.
    - Spending power is enforced by the SPL delegate amount plus Stripe `spending_controls` (`all_time` and `per_authorization`), not by our program.
    - Operator freeze becomes Stripe `status=inactive`, because the operator can't sign a revoke for a user-owned ATA.
  - Must be validated before committing to it: the cap and the signing prompts.
- **C. Squads smart-account vault** (`crypto_wallet[type]=squads`). This is a PDA with onchain spending limits. It's promising but undocumented, so investigate only if A fails and B's cap is a problem.
- **D. A random per-card key wrapped by a passkey (WebAuthn PRF).** This removes the phishing problem but keeps the JavaScript-memory and recovery problems. Not recommended for this timeline.
- **E. Tier 2/3 settle model.** Funds stay in PDA vaults and our program's `settle()` moves them, so onchain enforcement is kept. It costs the "issuer pulls directly" story.

## Revocation and expiry design (your override)

- **A delegate pull never calls our program.** The issuer program moves funds by CPI to SPL Token as the delegate, so a *lazy* `expire_card` check in our program **cannot** stop a previously approved delegate. Only an onchain `revoke` (or a smaller approval, or moving the funds out) removes spending power.
- **Design:**
  1. `expire_card` performs the `revoke` CPI and is permissionless.
  2. The operator runs a crank that calls it at the idle threshold.
  3. In the same step, the provider card goes `inactive`, as a network-side second layer.
  4. The armed amount is kept small and never exceeds the remaining cap, which limits exposure between crank runs.
- **G0.3b measures the actual behaviour.** It checks whether Stripe *declines* after a revoke, or approves and then fails the pull, which would be a different risk owner. The AT6 and AT9 designs will be adjusted to whatever we observe.

## One-time card closing (your override)

- **Don't close the vault right after use.** Refunds and reversals arrive asynchronously, may be batched (F6), and go to the card wallet's ATA. Closing that ATA could make a refund fail or strand it.
- **Proposed lifecycle:**
  1. After the first observed pull: `mark_used`, which revokes the delegate and cancels the provider card.
  2. The vault stays open until every authorization on the card is closed or captured **and** a refund grace window has passed. The window is sized from G0.6's measured latency.
  3. Only then is `close_card` allowed.
- **Effect on the program:** it needs a `refund_grace_secs` field in `Config`, and a `close_card` guard for `Used` cards. The guard is a change for the CP1 IDL review.

## Repository note (hard rule 1)

All five existing commits are your teammate's, dated Nov 16–17 (after Nov 13). However, `RITTUVIK/solsend` is currently **private**, and it must be **public** by submission. That's an outward-facing change for the team to make; I haven't touched it.

## What I need from you to finish Gate 0

1. **Devnet SOL.** The faucet API is rate-limiting me. At https://faucet.solana.com, send **5 SOL to `deployer`** (`peENpfyrTzWyHejccTYto9Jg46UjqKfEaK3ye5xaP8L`). I'll forward some to `card-a-owner` and `fee-payer`.
2. **Devnet USDC.** At https://faucet.circle.com (Solana Devnet), send **≥20 USDC to `card-a-owner`** (`DEGx8bvPLZQDS65xbw79My2tV97cfqsKQfGos6Nq3nWe`).
3. **Stripe Sandbox (Canada) and Bridge sandbox** (G0.1). Create a Stripe **Sandbox** (not Test Mode), install the Bridge Cards Stripe App, and create a Bridge sandbox key (`sk-test…`). If either is gated behind sales or KYB, tell me and we'll decide on Tier 2 (Lithic).
4. **QuickNode.** A Streams-enabled API key (free trial is fine).
5. **Privy.** A dev app with email login and test accounts enabled. Add `http://localhost:5173` to allowed origins if they're enforced.
6. **Secrets.** Put the keys into `spikes/.env` yourself (`cp spikes/.env.example spikes/.env`). Please **don't paste secrets into chat.**
