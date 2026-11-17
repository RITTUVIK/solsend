# SolSend

Burner cards for every store, funded by your Solana wallet.

Shop on Amazon, Temu or any site that takes cards, using the USDC in your Solana wallet. No bank account. Make one card per store and load it with what you plan to spend. If a sketchy site leaks the card, all anyone can take is what's on it.

## How it works

1. Connect your wallet (Phantom, Solflare, Backpack).
2. Create a card, like "Temu card".
3. Add USDC to it. It's a real onchain transfer.
4. Pay at checkout like any normal card.
5. Pull leftover money back to your wallet, or lock or delete the card anytime.

The store just sees a normal card payment.

## Safety

- Each card only holds what you put on it.
- Spending cap per card.
- One-time cards close after one purchase and send the leftover back.
- Cards you haven't used in 30 days lock themselves.

## Solana

- Anchor program on devnet. Each card has its own USDC vault owned by a PDA.
- Caps, one-time cards and locks are enforced onchain.
- Only you can add money, remove money, unlock or close a card. The backend can only spend within the rules and lock a card.
- Card numbers are never stored onchain.

Program ID (devnet): TODO
USDC mint (devnet): TODO

Cards are issued in sandbox mode for the hackathon. Everything on Solana is real on devnet.
