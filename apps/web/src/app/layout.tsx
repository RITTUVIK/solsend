import type { Metadata, Viewport } from "next";
import { SANDBOX_BANNER } from "@solsend/shared";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolSend · burner cards from your Solana wallet (devnet sandbox)",
  description: "Burner cards for every store, spending straight from your Solana wallet. Sandbox cards · Solana devnet USDC.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#09090b" }, { media: "(prefers-color-scheme: light)", color: "#fafafa" }] };

// The persistent honesty banner is part of the root layout (hard rule 2): restyle it, never remove it.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div role="status" data-testid="sandbox-banner" className="sticky top-0 z-50 flex min-h-7 items-center justify-center py-1 bg-amber-400 px-3 text-center text-[11px] font-semibold leading-tight text-amber-950 sm:text-xs">
          {SANDBOX_BANNER}
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
