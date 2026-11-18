"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { MOCK, PRIVY_APP_ID } from "@/client/config";
import { MockSessionProvider } from "@/client/session";

// The real Privy bundle is only loaded when we're not in mock mode.
const PrivySessionProvider = dynamic(() => import("@/client/privy"), { loading: () => null });

export function Providers({ children }: { children: ReactNode }) {
  if (MOCK) return <MockSessionProvider>{children}</MockSessionProvider>;
  if (!PRIVY_APP_ID) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold">Login isn&apos;t configured yet</h1>
        <p className="mt-2 text-sm text-ink-2">
          This deployment is missing its Privy app id. Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code>, or run with <code>NEXT_PUBLIC_MOCK_API=1</code> to use the in-browser mock.
        </p>
      </main>
    );
  }
  return <PrivySessionProvider>{children}</PrivySessionProvider>;
}
