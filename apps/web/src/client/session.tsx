"use client";
// Session abstraction: one interface, two implementations (real Privy / mock Privy). The api client reaches the
// active session through a module-level bridge so plain async functions can sign and fetch tokens.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

export function MockSessionProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setEmail(localStorage.getItem(MOCK_KEY)); } catch { /* ignore */ }
    setReady(true);
  }, []);
  const value = useMemo<Session>(() => ({
    ready, authenticated: !!email, walletPending: false, wallet: email ? mockWallet() : null, email, privyUserId: email ? "did:privy:mock-user" : null,
    login: () => setOpen(true),
    logout: async () => { try { localStorage.removeItem(MOCK_KEY); } catch { /* ignore */ } setEmail(null); },
    getAccessToken: async () => (email ? "mock-access-token" : null),
    signTx: async (wire) => { await wait(350); return wire; },
    signMsg: async () => { await wait(250); return crypto.getRandomValues(new Uint8Array(64)); },
  }), [ready, email]);
  return (
    <SessionPublisher value={value}>
      {children}
      {open && <MockLogin onDone={(e) => { try { localStorage.setItem(MOCK_KEY, e); } catch { /* ignore */ } setEmail(e); setOpen(false); }} onClose={() => setOpen(false)} />}
    </SessionPublisher>
  );
}

function MockLogin({ onDone, onClose }: { onDone: (email: string) => void; onClose: () => void }) {
  const [email, setEmail] = useState("judge@example.com");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="mock-login-title">
      <form
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
        onSubmit={(e) => { e.preventDefault(); setBusy(true); void wait(500).then(() => onDone(email.trim() || "judge@example.com")); }}
      >
        <p className="mb-2 inline-block rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-amber-950">MOCK LOGIN</p>
        <h2 id="mock-login-title" className="text-lg font-semibold">Log in with email</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Mock mode: no email is sent and no code is needed.</p>
        <label className="mt-4 block text-sm font-medium" htmlFor="mock-email">Email</label>
        <input ref={ref} id="mock-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950" />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary flex-1">{busy ? "Signing in…" : "Continue"}</button>
        </div>
      </form>
    </div>
  );
}

export { MOCK };
