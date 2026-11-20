# Live smoke test on production, 19 November 2026

The first real payment on the release that went live at 4:50 PM CST (commit `e702831`), and the first real QuickNode Stream delivery through the new cross-check. Lithic **sandbox** card, Solana **devnet** test USDC. No real merchant was charged.

## The payment

| | Value | Source |
|---|---|---|
| What | $5.00 at Temu (sandbox), card ending 4642 | The presenter's screen |
| Result | Approved | The presenter's screen |
| Transaction | [`5qyveH99…BERg`](https://explorer.solana.com/tx/5qyveH99KSZjZPhEaTQQqLNtbjV4zbnm8LSL6fXTGD2mxP3kXLHWjYRvgxncdHEy2tLexEwWx8jXYQS7nNeLBERg?cluster=devnet) | Read from devnet |
| Full signature | `5qyveH99KSZjZPhEaTQQqLNtbjV4zbnm8LSL6fXTGD2mxP3kXLHWjYRvgxncdHEy2tLexEwWx8jXYQS7nNeLBERg` | Read from devnet |
| Slot | 524,157,165 | Read from devnet; matches the slot shown under the badge |
| Block time | 2026-11-19 23:30:15 UTC (5:30:15 PM CST) | Read from devnet |
| Status | Success, finalized | Read from devnet |
| Wallet `FB5ovraf…` | 33.00 → 28.00 devnet USDC (−5.00) | Read from devnet; matches the screen |
| Treasury `8KLLrWdC…` | 16.02 → 21.02 devnet USDC (+5.00) | Read from devnet |
| Programs called | SolSend program, then Solana's Subscriptions & Allowances program, then SPL Token | Read from the transaction log |
| Program events emitted | 1 (the settlement event) | Read from the transaction log |
| Card allowance | $28 → $23 left | The presenter's screen |
| Time shown on the payment sheet | 4,775 ms | The presenter's screen. This chip measures the whole sandbox checkout on our server, including the calls to Lithic's simulator, and this was the first payment after a fresh deploy. The payment path's own decision time for this payment was not read |

## The QuickNode Stream delivery

| | Value | Source |
|---|---|---|
| Badge | "Settlement streamed by QuickNode" | The presenter's screen |
| Line under the badge | Slot 524157165 · "Amount and card match the card-network authorization" · delivered 356 ms after the settle was confirmed | The presenter's screen |
| Production's own record | `/api/status` at 23:33:21 UTC: "delivering: the newest onchain event was streamed; last delivery 3 min ago" | Read from the live site |
| Slot agreement | The slot in the Stream's line equals the slot of the transaction on devnet | Both |

The slot and the 356 ms figure come only from the Stream's delivery. This is the second recorded production delivery latency; the first was 584 ms on 18 November.

## The stream

| | Value |
|---|---|
| Stream | `solsend-mvp-devnet` (the existing one; the only stream on the account) |
| Network and dataset | `solana-devnet`, `programs_with_logs` |
| Destination | `https://solsend-ashen.vercel.app/api/quicknode` |
| Activated | 2026-11-19 23:21:49 UTC, with the start moved to block 524,155,031 (no backlog) |
| Paused | 2026-11-19 23:33:22 UTC; status read back as `paused` |
| Blocks processed while active | 2,946 in 11 min 33 s (about 15,300 an hour) |
| QuickNode dashboard before activation | 375 blocks processed, 2 webhook requests, 0 errors, 0 retries (read by the team) |
