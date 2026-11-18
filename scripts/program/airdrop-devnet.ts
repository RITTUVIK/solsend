// Request a devnet SOL airdrop for a project key through the configured RPC (QuickNode from
// spikes/.env, else public devnet). The RPC URL is never printed. Devnet only (genesis asserted).
//
//   npx tsx scripts/program/airdrop-devnet.ts <key-name> <sol>     e.g.  deployer 1
import { connect, loadKeypair, sleep } from "./lib.js";

async function main() {
  const [name = "deployer", solArg = "1"] = process.argv.slice(2);
  const lamports = Math.round(Number(solArg) * 1e9);
  if (!Number.isFinite(lamports) || lamports <= 0 || lamports > 2e9) throw new Error("amount must be 0 < SOL <= 2");
  const { connection, rpcLabel } = await connect();
  const to = loadKeypair(name).publicKey;
  const before = await connection.getBalance(to, "confirmed");
  console.log(`rpc: ${rpcLabel}; ${name} ${to.toBase58()} balance ${before / 1e9} SOL; requesting ${lamports / 1e9} SOL`);
  try {
    const sig = await connection.requestAirdrop(to, lamports);
    for (let i = 0; i < 30; i++) {
      const st = (await connection.getSignatureStatuses([sig])).value[0];
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") break;
      await sleep(1000);
    }
    console.log(`airdrop signature: ${sig}; balance now ${(await connection.getBalance(to, "confirmed")) / 1e9} SOL`);
  } catch (e) {
    // error text can embed the endpoint; report only the class of failure
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`airdrop failed: ${/429|rate|limit/i.test(msg) ? "rate limited" : /not supported|method/i.test(msg) ? "method not supported by this RPC" : "rejected"}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`airdrop-devnet FAILED: ${e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "<rpc>") : String(e)}`);
  process.exit(1);
});
