// Shared glue for the Demo Merchant routes: auth + config + live Lithic sandbox client.
import "server-only";
import { requireUser } from "../auth";
import { settlerLamportsCached } from "./sol-gate";
import { getStore } from "../store";
import type { DemoDeps } from "./checkout";
import { LithicSim } from "./lithic-sim";
import { PublicKey } from "@solana/web3.js";
import { CARD_STATUS, cardDelegation, decodeCard, readDelegation, type CardRow } from "@solsend/shared";
import { connection } from "../keys";

/** Card's remaining spending power, read onchain: fixed → remaining cap; recurring → remaining in the current period. */
async function remainingOnchain(row: CardRow): Promise<string | null> {
  const owner = new PublicKey(row.owner_wallet), cardPda = new PublicKey(row.card_pda);
  const [c, dl] = await connection().getMultipleAccountsInfo([cardPda, cardDelegation(owner, BigInt(row.card_id))], "confirmed");
  const card = c ? decodeCard(c.data) : null;
  if (!card) return null;
  if (card.status !== CARD_STATUS.ACTIVE || !dl) return "0";
  const d = readDelegation(dl.data);
  if (!d) return null;
  return (d.type === "fixed" ? d.remaining : d.remainingInPeriod).toString();
}

export async function demoDeps(req: Request): Promise<DemoDeps> {
  const user = await requireUser(req);
  const key = process.env.LITHIC_API_KEY;
  const enabled = process.env.DEMO_MERCHANT_ENABLED === "1" && !!key;
  const max = Number(process.env.DEMO_MERCHANT_MAX_CENTS ?? 5000);
  return { store: getStore(), sim: new LithicSim(key ?? "unset"), wallet: user.wallet, enabled, maxCents: Number.isFinite(max) ? Math.min(max, 5000) : 5000, settlerLamports: settlerLamportsCached, remainingOnchain };
}
