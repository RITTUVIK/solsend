import Link from "next/link";
import { PublicHeader, SiteFooter } from "@/components/PublicChrome";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-10">
      <PublicHeader />
      <main className="mx-auto max-w-md py-20 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">404</p>
        <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.03em]">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-[15px] text-ink-2">The link may be old, or the address has a typo.</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/home" className="btn-primary">Go to your wallet</Link>
          <Link href="/" className="btn-secondary">Back to the home page</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
