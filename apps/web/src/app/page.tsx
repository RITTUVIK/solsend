"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/client/session";
import { Logo } from "@/components/AppShell";
import { Icon, MockBadge } from "@/components/ui";

const STEPS = [
  { icon: "drop", title: "Log in, get test USDC", body: "Sign in with just an email. We create a Solana wallet for you and drop in free devnet test USDC." },
  { icon: "card", title: "Make a card per store", body: "“Temu, $40 total.” “Netflix, $15.49 a month.” Each card is an onchain allowance with a hard cap." },
  { icon: "bolt", title: "Swipe: settled onchain first", body: "Your USDC stays in your wallet until a swipe. Each purchase is settled on Solana before the card network is told yes." },
] as const;

export default function Landing() {
  const s = useSession();
  const router = useRouter();
  useEffect(() => { if (s.ready && s.authenticated) router.replace("/home"); }, [s.ready, s.authenticated, router]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-4">
        <Logo className="text-lg" />
        <div className="flex items-center gap-3 text-sm">
          <MockBadge />
          <Link href="/status" className="link">Status</Link>
        </div>
      </header>

      <section className="grid items-center gap-8 pt-6 sm:grid-cols-2 sm:pt-12">
        <div>
          <p className="sandbox-chip mb-3">Sandbox · Solana devnet</p>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">Burner cards for every store.</h1>
          <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">Spend straight from your Solana wallet. Each card is locked to one merchant and capped onchain, so a leaked card is worthless.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={s.login} disabled={!s.ready || s.authenticated} className="btn-primary !min-h-12 !px-6 !text-base">
              {s.ready ? "Log in with email" : "Loading…"}
            </button>
            <Link href="/status" className="btn-secondary !min-h-12 sm:hidden">See system status</Link>
          </div>
          <p className="mt-3 text-xs text-zinc-500">Free to try. No real money, no real merchants.</p>
        </div>

        <div className="relative mx-auto w-full max-w-xs" aria-hidden="true">
          <div className="absolute inset-0 translate-x-3 translate-y-3 rotate-6 rounded-2xl bg-gradient-to-br from-zinc-700 to-black opacity-40 blur-[1px]" />
          <div className="relative rotate-[-3deg] rounded-2xl bg-gradient-to-br from-orange-600 via-orange-700 to-rose-700 p-4 text-white shadow-xl">
            <div className="flex items-start justify-between"><div><p className="text-lg font-bold">Temu card</p><p className="text-xs text-white/80">Temu (sandbox)</p></div><span className="chip bg-emerald-400/90 text-emerald-950">Active</span></div>
            <p className="mt-6 font-mono tracking-[.18em]">•••• 4242</p>
            <div className="mt-3 flex justify-between text-xs"><span><strong className="text-sm">$28.50</strong> left</span><span>of $40.00 lifetime cap</span></div>
            <div className="mt-1.5 h-2 rounded-full bg-white/25"><div className="h-full w-[71%] rounded-full bg-white" /></div>
            <span className="chip mt-3 bg-amber-300 text-amber-950">SANDBOX</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="how" className="mt-14">
        <h2 id="how" className="text-xl font-bold">How it works</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {STEPS.map((st, i) => (
            <li key={st.title} className="surface">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-100 dark:bg-emerald-500/15"><Icon name={st.icon} /></span>
                <span className="text-xs font-bold">STEP {i + 1}</span>
              </div>
              <h3 className="mt-2 font-semibold">{st.title}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{st.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="safe" className="mt-10 grid gap-3 sm:grid-cols-2">
        <div className="surface">
          <h2 id="safe" className="flex items-center gap-2 font-semibold"><Icon name="shield" className="h-5 w-5 text-emerald-600" />You stay in control</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Freeze or close any card, or revoke all of them in one transaction. If the card issuer goes down, your money never left your wallet.</p>
        </div>
        <div className="surface border-amber-300 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-400/10">
          <h2 className="flex items-center gap-2 font-semibold"><Icon name="warn" className="h-5 w-5 text-amber-600" />Honest about the sandbox</h2>
          <p className="mt-1 text-sm text-amber-950/80 dark:text-amber-100/80">Cards come from a sandbox issuer and money is devnet test USDC. No real merchant is ever charged and no real card network settles anything. The &ldquo;Demo store&rdquo; is a sandbox simulator, not a real shop.</p>
        </div>
      </section>
    </div>
  );
}
