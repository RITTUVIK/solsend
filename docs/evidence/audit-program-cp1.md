# Independent program audit, CP1 (2026-11-18)

An independent **AI review agent** (a separate Claude agent with no shared context; not a professional audit firm), working read-only from fresh context, examined `programs/solsend` as deployed on devnet, using its
own LiteSVM tests against the real devnet Allowances binary (sha256 `2675ad1d…ddbf`).

**Result: no Critical findings and no fund-theft path.**
- Settle can only pay the treasury ATA, from the stored source, through the stored delegation, signed by the
  Card PDA. Allowances enforces the cap and the delegatee.
- Refunds can only go to `card.source_token_account`, capped per record.
- The CPI layouts and account-data offsets were verified against the Allowances IDL and ADRs.

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| H1 | High (correctness) | The 30-day idle lock bricks monthly Subscription cards whose later charge lands later in its period. Unfreezing does not recover an idle card. | **Fixed in upgrade 1:** idle exempt for Subscription; `unfreeze_card` re-activates (resets `last_used_ts`). |
| M1 | Medium | `initialize_config` is ungated, so on a fresh deploy anyone can initialize first. No impact on devnet (the deployer initialized first). | **Fixed:** the admin must equal the program's upgrade authority (ProgramData check). |
| L1 | Low | Idempotency was per card: the same `auth_hash` could settle once on each of several cards. | **Fixed:** record seeds are `["settle", auth_hash]`, one pull per authorization in total. |
| L2 | Low | `admin_withdraw` could drain funds that are still refundable, breaking late refunds. | **Fixed by removal:** no withdrawal instruction in the MVP; the treasury can only refund. |
| L3 | Low/Info | `CardSettled.remaining_allowance` was non-zero for a Used one-time card. | **Fixed:** 0 when the card is no longer Active. |
| D1 | Design | First-come merchant lock: a leaked, unused card could be drained at any merchant first. | **Improved:** optional merchant pre-lock at `register_card` (known stores are locked at creation). |
| D2 | Design | Freeze is advisory (the owner can undo a settlement-authority freeze). | Intended: the owner is in control. |
| T1 | Test gap | The default test config (idle 0, per-tx 0) differed from devnet. Cross-card reuse and idle recovery were untested. | **Fixed:** regression tests port the auditor's scenarios with devnet-equivalent config. |

Upgrade-1 signatures and the post-upgrade smoke are recorded in `w1-program-devnet.md`.
