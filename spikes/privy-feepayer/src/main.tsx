// G0.8 spike UI: Privy email login → embedded Solana wallet → sign a server-built
// memo tx whose fee payer is OUR server key → server cosigns and sends to devnet.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Legacy wire tx = shortvec(sigCount) || sigs[64*n] || message. Insert `sig` at signer index `idx`. */
function withSignature(wire: Uint8Array, idx: number, sig: Uint8Array): Uint8Array {
  const out = wire.slice();
  out.set(sig, 1 + idx * 64); // sigCount < 128 → shortvec is 1 byte
  return out;
}

function Spike() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const push = (s: string) => setLog((l) => [...l, `${new Date().toISOString().slice(11, 19)} ${s}`]);

  const wallet = wallets[0];

  async function run(path: "signTransaction" | "signMessage") {
    if (!wallet) return;
    setResult(null);
    push(`building tx for ${wallet.address} …`);
    const built = await (await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: wallet.address }) })).json();
    const wire = b64ToBytes(built.tx);
    let signedWire: Uint8Array;
    try {
      if (path === "signTransaction") {
        const { signedTransaction } = await signTransaction({ transaction: wire, wallet, chain: "solana:devnet" });
        signedWire = signedTransaction;
        push("Privy signTransaction returned (partial-sign with foreign fee payer works)");
      } else {
        const { signature } = await signMessage({ message: b64ToBytes(built.message), wallet });
        signedWire = withSignature(wire, 1, signature); // index 0 = fee payer, 1 = user
        push("Privy signMessage over tx message returned; signature inserted at index 1");
      }
    } catch (e) {
      push(`${path} FAILED: ${(e as Error).message}`);
      return;
    }
    const sub = await (await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: bytesToB64(signedWire), path }) })).json();
    setResult(sub);
    push(sub.signature ? `landed: ${sub.signature}` : `server rejected: ${sub.error}`);
  }

  if (!APP_ID) return <p>Set VITE_PRIVY_APP_ID in spikes/.env</p>;
  if (!ready) return <p>Loading Privy…</p>;
  if (!authenticated) return <button onClick={login}>Log in with email</button>;
  return (
    <div>
      <p>Logged in as {user?.email?.address ?? user?.id}</p>
      {wallet ? <p>Embedded Solana wallet: <code>{wallet.address}</code></p> : <button onClick={() => createWallet().then(() => push("wallet created"))}>Create Solana wallet</button>}
      <p>
        <button disabled={!wallet} onClick={() => run("signTransaction")}>1. Sign sponsored tx (signTransaction)</button>{" "}
        <button disabled={!wallet} onClick={() => run("signMessage")}>2. Fallback (signMessage)</button>{" "}
        <button onClick={logout}>Log out</button>
      </p>
      {result?.signature && (
        <p>
          ✅ Landed on devnet — fee paid by server key <code>{result.fee_payer}</code>; user SOL balance before: {result.user_sol_balance_lamports} lamports.{" "}
          <a href={result.explorer} target="_blank" rel="noreferrer">View on Solana Explorer (devnet)</a>
        </p>
      )}
      <pre style={{ background: "#f4f4f4", padding: ".5rem", whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyProvider
      appId={APP_ID ?? "missing"}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { solana: { createOnLogin: "all-users" }, ethereum: { createOnLogin: "off" } },
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc("https://api.devnet.solana.com"),
              rpcSubscriptions: createSolanaRpcSubscriptions("wss://api.devnet.solana.com"),
            },
          },
        },
      }}
    >
      <Spike />
    </PrivyProvider>
  </StrictMode>,
);
