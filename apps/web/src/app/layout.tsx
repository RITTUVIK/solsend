import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SANDBOX_BANNER } from "@solsend/shared";
import { Providers } from "@/components/Providers";
import { SplitFrame } from "@/components/SplitFrame";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap", weight: ["400", "500", "600", "700"] });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "SolSend · burner cards from your Solana wallet (devnet sandbox)",
  description: "A burner card for every store. Each card holds $0 and pulls only what you allow, straight from your Solana wallet. Sandbox cards · Solana devnet USDC.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#2a2108" }, { media: "(prefers-color-scheme: light)", color: "#fff3d1" }] };

// The persistent honesty banner is part of the root layout (hard rule 2): restyle it, never remove it. Text is verbatim.
// Phones: a slim neutral line at the top (the bottom belongs to the tab bar and toasts). sm+: a quiet pill pinned to the
// bottom-left corner of every page.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div role="status" data-testid="sandbox-banner"
          className="sticky top-0 z-50 flex min-h-7 items-center justify-center gap-1.5 border-b border-line bg-sunken px-4 py-1 text-center text-[11.5px] font-medium leading-4 text-ink-2 [text-wrap:balance] sm:fixed sm:inset-x-auto sm:top-auto sm:bottom-4 sm:left-4 sm:min-h-0 sm:rounded-full sm:border sm:bg-surface/85 sm:px-3 sm:py-1.5 sm:text-[11px] sm:shadow-lg sm:backdrop-blur-md">
          <svg viewBox="0 0 24 24" className="hidden h-3.5 w-3.5 shrink-0 text-sandbox-ink min-[400px]:block" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 3h6M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3M7.5 15h9" />
          </svg>
          {/* Same text, verbatim; segments only control where it may wrap (never orphaning a "·"). */}
          <span>{SANDBOX_BANNER.split(" · ").map((seg, i, all) => (
            <span key={seg}>{i > 0 ? " " : ""}<span className="whitespace-nowrap">{seg}{i < all.length - 1 ? " ·" : ""}</span></span>
          ))}</span>
        </div>
        <Providers><SplitFrame>{children}</SplitFrame></Providers>
      </body>
    </html>
  );
}
