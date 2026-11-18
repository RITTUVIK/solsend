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
    <ol className="space-y-0.5" aria-label="Card setup progress">
      <Step n={1} state={s1} title="Allowance on Solana" sub={sub1}>
        {card?.registerSignature && <div className="mt-2"><SigLink sig={card.registerSignature} title="Allowance on Solana" /></div>}
      </Step>
      <Step n={2} state={s2} title="Issuing sandbox card" sub={s2 === "active" ? "Asking the sandbox issuer for a card number…" : null} warn={st === "lithic_failed"}>
        {st === "lithic_failed" && (
          <div className="mt-2">
            <ErrorNote tone="warn" onRetry={onRetry} retryLabel={retrying ? "Retrying…" : "Retry"}>
              <p className="font-semibold">The sandbox issuer didn&apos;t answer.</p>
              <p>Your allowance is safe onchain, and nothing can be charged without a card. Just retry.</p>
            </ErrorNote>
          </div>
        )}
      </Step>
      <Step n={3} state={s3} title="Ready" sub={issued ? "Your sandbox card is live." : null} last />
      {(failed || failure) && <li className="pt-2"><ErrorNote>{failure ?? "This card couldn't be created. Nothing was charged. Please start a new card."}</ErrorNote></li>}
    </ol>
  );
}

function Step({ n, state, title, sub, children, last, warn }: { n: number; state: S; title: string; sub?: string | null; children?: React.ReactNode; last?: boolean; warn?: boolean }) {
  const ring = state === "done" ? "bg-ink text-paper" : state === "active" ? "bg-mint/20 text-ink ring-2 ring-mint" : state === "error" ? (warn ? "bg-warn-bg text-warn ring-2 ring-warn/50" : "bg-no-bg text-no") : "bg-sunken text-ink-3";
  return (
    <li className="flex gap-3" aria-current={state === "active" ? "step" : undefined} data-testid={`step-${n}`} data-state={state}>
      <div className="flex flex-col items-center">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold transition-colors ${ring}`}>
          {state === "done" ? <Icon name="check" className="anim-pop h-4 w-4" strokeWidth={2.6} /> : state === "active" ? <Spinner /> : state === "error" ? (warn ? <span aria-hidden="true">!</span> : <Icon name="x" className="h-4 w-4" />) : n}
        </span>
        {!last && <span className={`my-1 w-0.5 flex-1 rounded-full ${state === "done" ? "bg-ink" : "bg-line"}`} />}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <p className={`text-[15px] font-semibold leading-8 ${state === "todo" ? "text-ink-3" : ""}`}>{title}{state === "error" && warn && <span className="sr-only"> (needs retry)</span>}</p>
        {sub && <p className="text-[14px] text-ink-2">{sub}</p>}
        {children}
      </div>
    </li>
  );
}
