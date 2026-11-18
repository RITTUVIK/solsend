# W4 evidence: QuickNode Streams pipeline, demo merchant, status (Wed 2026-11-18, about 01:00-01:15 CST)

Devnet + Lithic sandbox only. No secrets recorded here (API key, stream token and webhook URL are never printed).

## QuickNode filter (offline: PASS)
- `infra/quicknode/build-filter.ts` generates `filter.dist.js` from `packages/shared/idl/solsend.json` (all 7 events: CardRegistered, CardSettled, CardRefunded, CardFrozen, CardUnfrozen, CardClosed, ConfigUpdated). CI fails if the committed file drifts.
- `infra/quicknode/selftest.ts` (run in a sandboxed `vm` context with no require/process/fetch): 2 matches, 8 decoded events. A decoy `Program data:` line emitted inside a CPI to another program is ignored. Per the lead's amendment there is no memo: the filter emits events only (link to Lithic via `authHash` = sha256("solsend:auth:v1:"+token), resolved server-side). Output parses with `api.QnPayload`, and is cross-checked against the shared TS decoder.
- QuickNode's own sandbox: `POST /streams/test_filter` on real devnet block 523518925 returned HTTP 201 with `result: null` and no filter errors (syntax/runtime OK there; no SolSend transaction in that block).

## Stream (created PAUSED)
- Old stream `d2788080-aa83-4b2e-beda-9f5d104427e6` (paused, token lost) deleted: HTTP 200, as the trial allows one Solana stream.
- New stream `7bad9332-3c4c-44d5-b951-f4fafda7428b`, name `solsend-mvp-devnet`, `solana-devnet` / `programs_with_logs`, batch 1, created with `status: paused`. A fresh 32-byte token was written to `spikes/.env` (mode 600) and never printed.
- QuickNode rejects a webhook host that does not resolve, so it was created with the placeholder `https://example.com/api/quicknode` (it is paused; `stream.ts set-url` replaces it once the real URL exists).
- Finding: a paused stream resumes from its stored `start_range` (set at creation). `PATCH {start_range}` works while paused, so `stream.ts activate` first moves `start_range` to the current slot, otherwise activation would replay and bill the backlog.

## Live delivery test: PENDING
`getAccountInfo(GfMyGffq...)` on devnet returned no account (program not deployed yet by W1) at 01:00 CST. Once deployed: `activate` -> one real SolSend tx (register or settle) -> confirm the `quicknode` feed row and signature-to-webhook latency -> `pause` -> `get` shows paused.

## Credit usage
Console REST usage endpoints (`/v0/usage/rpc`, `/by-chain`, `/by-endpoint`) return HTTP 403 for the Streams-scoped key (same as CP0b). The stream object exposes no credit counter. Credits can only be read from the QuickNode dashboard. Cost control = keep the stream paused outside test windows.

## Demo merchant / CLI
- `server/demo/*` tests (10) prove: PAN is read in memory and sent only to `POST /v1/simulate/authorize`; error text and responses contain no 16-digit run, even when Lithic echoes the PAN in an error body or a network error mentions it; non-sandbox hosts are refused; ownership, issued-state, amount cap, disabled flag, and 10/min per wallet rate limit are enforced.
- `scripts/merchant-sim.ts list` was run once against the real sandbox (1 request): returned 2 `solsend_*` cards (token, last four, tags only).
