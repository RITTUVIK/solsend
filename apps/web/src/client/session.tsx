"use client";
// Session abstraction: one interface, two implementations (real Privy / mock Privy). The api client reaches the
// active session through a module-level bridge so plain async functions can sign and fetch tokens.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui";
import { MOCK } from "./config";
import { mockWallet } from "./mock";

export interface Session {
  ready: boolean;
  authenticated: boolean;
  /** Authenticated but the embedded wallet isn't there yet. */
  walletPending: boolean;
  wallet: string | null;
  email: string | null;
  privyUserId: string | null;
  login: () => void;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  /** Partial-sign a server-built wire transaction as the owner (Privy `useSignTransaction`, chain solana:devnet). */
  signTx: (wire: Uint8Array) => Promise<Uint8Array>;
  /** Sign arbitrary bytes (wallet-bind message). */
  signMsg: (msg: Uint8Array) => Promise<Uint8Array>;
}

const Ctx = createContext<Session | null>(null);
export const useSession = (): Session => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside <SessionProvider>");
  return s;
};

let bridge: Session | null = null;
export const getBridge = (): Session => {
  if (!bridge) throw new Error("Session not ready");
  return bridge;
};

/** Publishes the session to the bridge and context. */
export function SessionPublisher({ value, children }: { value: Session; children: ReactNode }) {
  bridge = value;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ── Mock Privy ───────────────────────────────────────────────────────────────────────────
const MOCK_KEY = "solsend.mock.session";
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mock wallet signing mode (localStorage `solsend.mock.sign`): "auto" (default) approves after a beat; "manual" waits for
 *  a click on Approve/Reject, so tests can exercise cancellation and prove the approval window is reachable. */
export const MOCK_SIGN_KEY = "solsend.mock.sign";
const MOCK_BLOCKED_MS = 4000;
type PendingSign = { id: number; settle: (ok: boolean, why?: string) => void };

export function MockSessionProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [sign, setSign] = useState<PendingSign | null>(null);
  useEffect(() => {
    try { setEmail(localStorage.getItem(MOCK_KEY)); } catch { /* ignore */ }
    setReady(true);
  }, []);
  const value = useMemo<Session>(() => ({
    ready, authenticated: !!email, walletPending: false, wallet: email ? mockWallet() : null, email, privyUserId: email ? "did:privy:mock-user" : null,
    login: () => setOpen(true),
    logout: async () => { try { localStorage.removeItem(MOCK_KEY); } catch { /* ignore */ } setEmail(null); },
    getAccessToken: async () => (email ? "mock-access-token" : null),
    // Like Privy, the mock wallet opens an approval window (a normal fixed element, NOT a top-layer dialog), so a modal
    // <dialog> left open by the app covers it exactly as it would cover Privy's (bug found in the 2026-11-18 rehearsal).
    signTx: (wire) => new Promise<Uint8Array>((resolve, reject) => {
      const id = Date.now();
      // Reject mirrors Privy 3.51's real shape: a generic wrapper whose `cause` carries the actual reason.
      const privyCancel = () => Object.assign(new Error("Failed to connect to wallet", { cause: new Error("User exited the modal before submitting the transaction") }), { privyErrorCode: "transaction_failure" });
      setSign({ id, settle: (ok, why) => { setSign(null); if (ok) resolve(wire); else reject(why ? new Error(why) : privyCancel()); } });
    }),
    signMsg: async () => { await wait(250); return crypto.getRandomValues(new Uint8Array(64)); },
  }), [ready, email]);
  return (
    <SessionPublisher value={value}>
      {children}
      {open && <MockLogin onDone={(e) => { try { localStorage.setItem(MOCK_KEY, e); } catch { /* ignore */ } setEmail(e); setOpen(false); }} onClose={() => setOpen(false)} />}
      {sign && <MockWalletPrompt key={sign.id} pending={sign} />}
    </SessionPublisher>
  );
}

/** Mock wallet approval window. Auto mode approves only if the window is actually reachable (no app modal dialog is open
 *  over it); otherwise it fails loudly, like a user stuck behind an overlay would. */
function MockWalletPrompt({ pending }: { pending: PendingSign }) {
  const approveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    approveRef.current?.focus();
    let mode = "auto";
    try { mode = localStorage.getItem(MOCK_SIGN_KEY) ?? "auto"; } catch { /* ignore */ }
    if (mode === "manual") return;
    const covered = () => !!document.querySelector("dialog:modal");
    const t = setTimeout(() => { if (!covered()) pending.settle(true); }, 350);
    const blocked = setTimeout(() => pending.settle(false, "Mock wallet: the approval window was covered by a modal dialog and could not be reached."), MOCK_BLOCKED_MS);
    return () => { clearTimeout(t); clearTimeout(blocked); };
  }, [pending]);
  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] mx-auto mb-4 w-[min(360px,calc(100%-32px))] rounded-[20px] bg-surface p-4 shadow-2xl ring-1 ring-line" role="dialog" aria-modal="false" aria-labelledby="mock-wallet-title" data-testid="mock-wallet">
      <span className="chip px-2 text-mock ring-1 ring-mock-line">MOCK WALLET</span>
      <p id="mock-wallet-title" className="mt-2 text-[17px] font-semibold">Approve transaction?</p>
      <p className="mt-0.5 text-[13px] text-ink-3">Solana devnet · signed in your browser</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={() => pending.settle(false)} data-testid="mock-wallet-reject">Reject</button>
        <button ref={approveRef} type="button" className="btn-primary flex-1" onClick={() => pending.settle(true)} data-testid="mock-wallet-approve">Approve</button>
      </div>
    </div>
  );
}

function MockLogin({ onDone, onClose }: { onDone: (email: string) => void; onClose: () => void }) {
  const [email, setEmail] = useState("judge@example.com");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.select(), 50); return () => clearTimeout(t); }, []);
  return (
    <Sheet open onClose={onClose} labelledBy="mock-login-title" testId="mock-login" dismissible={!busy}>
      <form className="space-y-4 pt-1" onSubmit={(e) => { e.preventDefault(); setBusy(true); void wait(500).then(() => onDone(email.trim() || "judge@example.com")); }}>
        <div>
          <span className="chip px-2 text-mock ring-1 ring-mock-line">MOCK LOGIN</span>
          <h2 id="mock-login-title" className="mt-2 text-[22px] font-semibold tracking-[-0.02em]">Log in with email</h2>
          <p className="mt-1 text-[15px] text-ink-2">Mock mode: no email is sent and no code is needed.</p>
        </div>
        <div>
          <label className="label" htmlFor="mock-email">Email</label>
          <input ref={ref} id="mock-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </div>
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? "Signing in…" : "Continue"}</button>
          <button type="button" onClick={onClose} className="btn-ghost w-full">Cancel</button>
        </div>
      </form>
    </Sheet>
  );
}

export { MOCK };
