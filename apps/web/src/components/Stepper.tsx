"use client";
import type { CardView } from "@/client/format";
import { ErrorNote, Icon, SigLink, Spinner } from "./ui";

export type Stage = "preparing" | "signing" | "submitting" | "sent";
type S = "todo" | "active" | "done" | "error";

/** Card creation is recoverable, not atomic: onchain first, Lithic issuance second. "Ready" only at issueState === "issued". */
export function Stepper({ card, stage, onRetry, retrying, failure }: { card: CardView | null; stage: Stage; onRetry?: () => void; retrying?: boolean; failure?: string | null }) {
  const st = card?.issueState;
  const onchainDone = !!card && st !== "onchain_pending" && st !== "failed";
  const issued = st === "issued";
  const failed = st === "failed";
  const s1: S = failed ? "error" : onchainDone ? "done" : "active";
  const s2: S = issued ? "done" : st === "lithic_failed" ? "error" : onchainDone ? "active" : "todo";
  const s3: S = issued ? "done" : "todo";
  const sub1 = onchainDone ? null : stage === "preparing" ? "Preparing the transaction…" : stage === "signing" ? "Approve in your wallet…" : stage === "submitting" ? "Sending to Solana devnet and waiting for confirmation…" : "Waiting for confirmation…";

  return (
    <ol className="space-y-1" aria-label="Card setup progress">
      <Step n={1} state={s1} title="Creating onchain allowance" sub={sub1}>
        {card?.registerSignature && <SigLink sig={card.registerSignature} />}
      </Step>
      <Step n={2} state={s2} title="Issuing sandbox card" sub={s2 === "active" ? "Asking the sandbox issuer for a card number…" : null}>
        {st === "lithic_failed" && (
          <div className="mt-2">
            <ErrorNote onRetry={onRetry} retryLabel={retrying ? "Retrying…" : "Retry"}>
              <p className="font-medium">The sandbox issuer didn&apos;t respond.</p>
              <p>Your allowance is already onchain and safe. Nothing can be charged without a card, so just retry.</p>
            </ErrorNote>
          </div>
        )}
      </Step>
      <Step n={3} state={s3} title="Ready" sub={issued ? "Your sandbox card is live." : null} last />
      {(failed || failure) && <li className="pt-2"><ErrorNote>{failure ?? "This card couldn't be created. Nothing was charged. Please start a new card."}</ErrorNote></li>}
    </ol>
  );
}

function Step({ n, state, title, sub, children, last }: { n: number; state: S; title: string; sub?: string | null; children?: React.ReactNode; last?: boolean }) {
  const ring = state === "done" ? "bg-emerald-600 text-white" : state === "active" ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-300" : state === "error" ? "bg-rose-600 text-white" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800";
  return (
    <li className="flex gap-3" aria-current={state === "active" ? "step" : undefined} data-testid={`step-${n}`} data-state={state}>
      <div className="flex flex-col items-center">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors ${ring}`}>
          {state === "done" ? <Icon name="check" className="anim-pop h-4 w-4" /> : state === "active" ? <Spinner /> : state === "error" ? <Icon name="x" className="h-4 w-4" /> : n}
        </span>
        {!last && <span className={`my-1 w-0.5 flex-1 ${state === "done" ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-800"}`} />}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <p className={`font-semibold leading-8 ${state === "todo" ? "text-zinc-400" : ""}`}>{title}</p>
        {sub && <p className="text-sm text-zinc-600 dark:text-zinc-400">{sub}</p>}
        {children}
      </div>
    </li>
  );
}
