# solsend

An AI agent that pays your team's bills with USDC. It uses one-time cards, and the budget rules live on Solana so it can't overspend.

Built for the UBC 2026 Hackathon (Agentic Payments + Best use of Solana).

## The problem

Crypto teams keep their money in USDC. But AWS, Figma, Notion and the rest only take cards. So every month someone cashes out to a bank and pays each bill by hand. It sucks.

## The fix

1. Put your USDC in a team treasury on Solana.
2. Set the rules: monthly budget, which vendors are allowed, max per charge, and when a human has to approve.
3. Forward a bill. The agent reads it and checks the rules onchain.
4. If it's allowed, the agent gets a one-time card for that vendor and that exact amount, and pays.
5. If it's too big, it waits for a human to approve.
6. If the vendor isn't on the list, the program blocks it.

It also catches subscriptions nobody has used in 60 days and shuts them off.

## Why Solana

The budget, the vendor list, approvals and receipts are all onchain. Even if the agent messes up or our server gets hacked, it can't spend more than the rules allow.

## How the agent decides

1. Read the bill.
2. Pull out the vendor and amount. If it's not sure, it asks a human and doesn't pay.
3. Check the rules on Solana.
4. Ask the program to approve the charge.
5. Paid: make a one-time card, pay, save the receipt.
6. Pending: ping a human and stop.
7. Rejected: say why and stop.

## Safety limits

- The agent can only request charges. It can't change rules, add vendors or pull money out.
- All limits are checked onchain, not just on our server.
- Cards are single use, locked to one vendor and one exact amount.
- Big charges need a human.
- If it can't read the bill clearly, it won't pay.

## What's in here

- Solana program (Anchor, devnet): treasury, rules, receipts
- Backend + agent (TypeScript, Claude)
- Card service (Lithic sandbox, or a mock clearly marked "simulated")
- Fake vendor checkout pages
- Dashboard (Next.js)

Program ID: coming soon

## Next up

Real bank rails, KYC, multiple teams, mainnet.

## Team

Ritty
