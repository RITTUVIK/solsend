// Only two NEXT_PUBLIC_ values exist in this app (hard rule): the Privy app id and the mock flag.
export const MOCK = process.env.NEXT_PUBLIC_MOCK_API === "1";
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
// Public devnet RPC for Privy only. NEVER a private/QuickNode URL in browser code.
export const PUBLIC_DEVNET_HTTP = "https://api.devnet.solana.com";
export const PUBLIC_DEVNET_WS = "wss://api.devnet.solana.com";
export const FEED_POLL_MS = 1500;
export const DATA_POLL_MS = 3000;
