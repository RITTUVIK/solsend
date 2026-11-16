# solsend

An AI agent that pays your team's bills from USDC using one-time cards. The budget rules live on Solana, so it can't overspend.

## Why

Crypto teams hold USDC, but most tools only take cards. Right now someone cashes out and pays every bill by hand.

## How it works

1. Team puts USDC in a treasury on Solana and sets rules (budget, allowed vendors, limits).
2. Forward a bill. The agent reads it and checks the rules onchain.
3. Allowed: it makes a one-time card for that exact amount and pays.
4. Too big: waits for a human to approve.
5. Unknown vendor: blocked.

## Safety

- Agent can only request charges. It can't change rules or withdraw.
- Limits are enforced onchain.
- Cards are single use, one vendor, exact amount.
- If it can't read a bill clearly, it doesn't pay.

Program ID: coming soon
