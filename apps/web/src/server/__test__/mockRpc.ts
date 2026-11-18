// Test-only: an in-memory stand-in for the devnet RPC surface (`Rpc`) + SolSend account encoders.
import bs58 from "bs58";
import { Keypair, PublicKey, type AccountInfo, type SignatureResult } from "@solana/web3.js";
import { ALLOWANCES_PROGRAM_ID, IDL, SOLSEND_PROGRAM_ID, concat, i64le, u64le, settlementRecordPda } from "@solsend/shared";
import type { Rpc } from "../solana/rpc";

type Status = { err: SignatureResult["err"] };

export class MockRpc {
  accounts = new Map<string, AccountInfo<Buffer>>();
  sent: Uint8Array[] = [];
  statuses = new Map<string, Status>();
  private listeners = new Map<number, { sig: string; cb: (r: SignatureResult) => void }>();
  private nextSub = 1;
  /** Called on every sendRawTransaction (first send and rebroadcasts). Return a Status to confirm after `confirmAfterMs`. */
  onSend: (sig: string, raw: Uint8Array, nth: number) => Status | null | undefined = () => ({ err: null });
  confirmAfterMs = 10;
  sendThrows: Error | null = null;
  rpcThrows = false;
  sendCount = new Map<string, number>();

  setAccount(key: PublicKey, owner: PublicKey, data: Uint8Array, lamports = 1_000_000) {
    this.accounts.set(key.toBase58(), { owner, data: Buffer.from(data), lamports, executable: false, rentEpoch: 0 });
  }
  confirm(sig: string, s: Status) {
    this.statuses.set(sig, s);
    for (const [id, l] of this.listeners) if (l.sig === sig) { this.listeners.delete(id); l.cb({ err: s.err }); }
  }

  sendRawTransaction = async (raw: Uint8Array | Buffer | number[]) => {
    const bytes = Uint8Array.from(raw as Uint8Array);
    const sig = bs58.encode(bytes.subarray(1, 65));
    const n = (this.sendCount.get(sig) ?? 0) + 1;
    this.sendCount.set(sig, n);
    this.sent.push(bytes);
    if (this.sendThrows) throw this.sendThrows;
    const st = this.onSend(sig, bytes, n);
    if (st && !this.statuses.has(sig)) setTimeout(() => this.confirm(sig, st), this.confirmAfterMs);
    return sig;
  };
  getSignatureStatuses = async (sigs: string[]) => {
    if (this.rpcThrows) throw new Error("rpc down");
    return { context: { slot: 1 }, value: sigs.map((s) => { const st = this.statuses.get(s); return st ? { slot: 1, confirmations: 1, err: st.err, confirmationStatus: "confirmed" as const } : null; }) };
  };
  onSignature = (sig: string, cb: (r: SignatureResult) => void) => {
    const id = this.nextSub++;
    this.listeners.set(id, { sig, cb });
    return id;
  };
  removeSignatureListener = async (id: number) => { this.listeners.delete(id); };
  getLatestBlockhash = async () => ({ blockhash: bs58.encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 1000 });
  getAccountInfo = async (k: PublicKey) => {
    if (this.rpcThrows) throw new Error("rpc down");
    return this.accounts.get(k.toBase58()) ?? null;
  };
  getMultipleAccountsInfo = async (ks: PublicKey[]) => {
    if (ks.length > 5) throw new Error("-32615 too many accounts (free plan ≤5)");
    return ks.map((k) => this.accounts.get(k.toBase58()) ?? null);
  };
  asRpc(): Rpc { return this as unknown as Rpc; }
}

const disc = (name: string) => Uint8Array.from(IDL.accounts!.find((a) => a.name === name)!.discriminator);

export function encodeRecord(card: PublicKey, authHash: Uint8Array, amount: bigint, refunded = 0n) {
  return concat(disc("SettlementRecord"), card.toBytes(), authHash, u64le(amount), u64le(refunded), i64le(1n), Uint8Array.of(255));
}

export function putRecord(rpc: MockRpc, card: PublicKey, authHash: Uint8Array, amount: bigint, refunded = 0n) {
  rpc.setAccount(settlementRecordPda(card, authHash), SOLSEND_PROGRAM_ID, encodeRecord(card, authHash, amount, refunded));
}

export function encodeCard(p: { owner: PublicKey; cardId: bigint; kind?: number; status?: number; delegation: PublicKey; source: PublicKey; totalSettled?: bigint; merchantLock?: Uint8Array }) {
  return concat(disc("Card"), p.owner.toBytes(), u64le(p.cardId), Uint8Array.of(p.kind ?? 0, p.status ?? 0), p.delegation.toBytes(), u64le(p.cardId), p.source.toBytes(),
    new Uint8Array(32), p.merchantLock ?? new Uint8Array(32), i64le(1n), i64le(1n), u64le(p.totalSettled ?? 0n), u64le(0n), Uint8Array.of(0, 0, 0, 0), Uint8Array.of(254));
}

/** Allowances FixedDelegation (187 bytes): header(107) + sa32 + mint32 + remaining8 + expiry8. */
export function encodeFixedDelegation(p: { delegator: PublicKey; delegatee: PublicKey; payer: PublicKey; remaining: bigint }) {
  const out = new Uint8Array(187);
  out.set(p.delegator.toBytes(), 3); out.set(p.delegatee.toBytes(), 35); out.set(p.payer.toBytes(), 67);
  out.set(u64le(p.remaining), 171);
  return out;
}
export { ALLOWANCES_PROGRAM_ID };
export const randomKey = () => Keypair.generate().publicKey;
