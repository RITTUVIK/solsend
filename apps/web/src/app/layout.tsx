import type { Metadata, Viewport } from "next";
import { SANDBOX_BANNER } from "@solsend/shared";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolSend · burner cards from your Solana wallet (devnet sandbox)",
  description: "Burner cards for every store, spending straight from your Solana wallet. Sandbox cards · Solana devnet USDC.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// The persistent honesty banner is part of the root layout (hard rule 2) — W3 may restyle, never remove.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div role="status" className="sticky top-0 z-50 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
          {SANDBOX_BANNER}
        </div>
        {children}
      </body>
    </html>
  );
}
