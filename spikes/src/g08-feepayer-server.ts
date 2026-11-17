// G0.8 — server fee-payer for a Privy embedded-wallet transaction.
// Flow: POST /api/build {user}  → server builds a memo tx (feePayer = our server key,
//         user = required signer), returns base64 tx with NO signatures.
//       client signs with Privy (signTransaction, or signMessage fallback)
//       POST /api/submit {tx}   → server checks the message is byte-identical to one it
//         built (so the user can't swap instructions), checks the user signature, adds
//         the fee-payer signature, sends, confirms. The fee payer never signs anything it
//         did not build itself.
import { createServer } from "node:http";
import { LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { record } from "./lib/evidence.js";
import { devnet, explorerTx, loadKeypair } from "./lib/solana.js";

const PORT = Number(process.env.G08_PORT ?? 8788);
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const conn = await devnet();
const feePayer = loadKeypair("fee-payer");
const pending = new Map<string, { user: string; createdAt: number }>(); // key: base64(message)

async function readJson(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

createServer(async (req, res) => {
  const reply = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  try {
    if (req.method === "GET" && req.url === "/api/config") {
      return reply(200, { feePayer: feePayer.publicKey.toBase58(), cluster: "devnet", feePayerSol: (await conn.getBalance(feePayer.publicKey)) / LAMPORTS_PER_SOL });
    }
    if (req.method === "POST" && req.url === "/api/build") {
      const { user } = await readJson(req);
      const userKey = new PublicKey(user);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight }).add(
        new TransactionInstruction({
          programId: MEMO_PROGRAM,
          keys: [{ pubkey: userKey, isSigner: true, isWritable: false }],
          data: Buffer.from(`SolSend G0.8 sponsored tx (devnet) ${new Date().toISOString()}`),
        }),
      );
      const message = tx.serializeMessage();
      pending.set(message.toString("base64"), { user: userKey.toBase58(), createdAt: Date.now() });
      const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      return reply(200, { tx: wire.toString("base64"), message: message.toString("base64") });
    }
    if (req.method === "POST" && req.url === "/api/submit") {
      const { tx: b64, path } = await readJson(req);
      const tx = Transaction.from(Buffer.from(b64, "base64"));
      const msgKey = tx.serializeMessage().toString("base64");
      const p = pending.get(msgKey);
      if (!p) return reply(400, { error: "message was not built by this server (or was modified)" });
      if (!tx.feePayer?.equals(feePayer.publicKey)) return reply(400, { error: "fee payer mismatch" });
      const userSig = tx.signatures.find((s) => s.publicKey.toBase58() === p.user)?.signature;
      if (!userSig) return reply(400, { error: "missing user signature" });
      tx.partialSign(feePayer);
      if (!tx.verifySignatures(true)) return reply(400, { error: "signature verification failed" });
      pending.delete(msgKey);
      const userSolBefore = await conn.getBalance(new PublicKey(p.user));
      const signature = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
      const conf = await conn.confirmTransaction(signature, "confirmed");
      const status = await conn.getSignatureStatus(signature);
      const ev = {
        signature, explorer: explorerTx(signature), slot: status.value?.slot ?? null, err: conf.value.err,
        user: p.user, fee_payer: feePayer.publicKey.toBase58(), user_sol_balance_lamports: userSolBefore,
        privy_sign_path: path ?? "unknown",
      };
      record("g08", conf.value.err ? "FAIL" : "PASS", ev);
      return reply(200, ev);
    }
    reply(404, { error: "not found" });
  } catch (e) {
    record("g08", "server_error", { error: (e as Error).message });
    reply(500, { error: (e as Error).message });
  }
}).listen(PORT, () => console.log(`G0.8 fee-payer server on http://localhost:${PORT} (fee payer ${feePayer.publicKey.toBase58()})`));
