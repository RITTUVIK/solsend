"use client";
// Real Privy session. Config mirrors the PROVEN spike (spikes/privy-feepayer): email login, Solana embedded wallet for
// all users, Privy RPC on the PUBLIC devnet endpoints (never our QuickNode URL).
import { useMemo, type ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { PRIVY_APP_ID, PUBLIC_DEVNET_HTTP, PUBLIC_DEVNET_WS } from "./config";
import { SessionPublisher, type Session } from "./session";

function Inner({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const wallet = wallets[0];

  const value = useMemo<Session>(() => ({
    ready: ready && (!authenticated || walletsReady),
    authenticated,
    walletPending: authenticated && !wallet,
    wallet: wallet?.address ?? null,
    email: user?.email?.address ?? null,
    privyUserId: user?.id ?? null,
    login: () => login(),
    logout: () => logout(),
    getAccessToken: () => getAccessToken(),
    signTx: async (wire) => {
      if (!wallet) throw new Error("Your wallet isn't ready yet.");
      const { signedTransaction } = await signTransaction({ transaction: wire, wallet, chain: "solana:devnet" });
      return signedTransaction;
    },
    signMsg: async (message) => {
      if (!wallet) throw new Error("Your wallet isn't ready yet.");
      const { signature } = await signMessage({ message, wallet });
      return signature;
    },
  }), [ready, authenticated, walletsReady, wallet, user, login, logout, getAccessToken, signTransaction, signMessage]);

  return <SessionPublisher value={value}>{children}</SessionPublisher>;
}

export default function PrivySessionProvider({ children }: { children: ReactNode }) {
  const rpcs = useMemo(() => ({
    "solana:devnet": { rpc: createSolanaRpc(PUBLIC_DEVNET_HTTP), rpcSubscriptions: createSolanaRpcSubscriptions(PUBLIC_DEVNET_WS) },
  }), []);
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { solana: { createOnLogin: "all-users" }, ethereum: { createOnLogin: "off" } },
        solana: { rpcs },
        appearance: { theme: "light", accentColor: "#10b981" },
      }}
    >
      <Inner>{children}</Inner>
    </PrivyProvider>
  );
}
