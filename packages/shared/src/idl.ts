// CP1 CONTRACT — IDL-driven codec for the SolSend program. Instruction data, account data and
// event data are encoded/decoded straight from idl/solsend.json, so TS can never drift from Rust.
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import idlJson from "../idl/solsend.json" with { type: "json" };
import { concat } from "./bytes.js";

type IdlType = string | { array: [IdlType, number] } | { defined: { name: string } } | { option: IdlType } | { vec: IdlType };
type IdlField = { name: string; type: IdlType };
type IdlTypeDef = { name: string; type: { kind: string; fields?: IdlField[] } };
type IdlIxAccount = { name: string; writable?: boolean; signer?: boolean };
type IdlIx = { name: string; discriminator: number[]; accounts: IdlIxAccount[]; args: IdlField[] };
type Idl = { address: string; instructions: IdlIx[]; accounts?: { name: string; discriminator: number[] }[]; events?: { name: string; discriminator: number[] }[]; types?: IdlTypeDef[] };

export const IDL = idlJson as unknown as Idl;
const TYPES = new Map((IDL.types ?? []).map((t) => [t.name, t]));
export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function enc(type: IdlType, v: unknown): Uint8Array {
  if (typeof type === "string") {
    const dv = (n: number) => { const b = new Uint8Array(n); return { b, d: new DataView(b.buffer) }; };
    switch (type) {
      case "u8": { const { b, d } = dv(1); d.setUint8(0, Number(v)); return b; }
      case "bool": return Uint8Array.of(v ? 1 : 0);
      case "u16": { const { b, d } = dv(2); d.setUint16(0, Number(v), true); return b; }
      case "u32": { const { b, d } = dv(4); d.setUint32(0, Number(v), true); return b; }
      case "u64": { const { b, d } = dv(8); d.setBigUint64(0, BigInt(v as bigint), true); return b; }
      case "i64": { const { b, d } = dv(8); d.setBigInt64(0, BigInt(v as bigint), true); return b; }
      case "pubkey": return (v as PublicKey).toBytes();
      default: throw new Error(`unsupported IDL type ${type}`);
    }
  }
  if ("array" in type) {
    const [inner, len] = type.array;
    if (inner === "u8") { const b = v as Uint8Array; if (b.length !== len) throw new Error(`expected ${len} bytes`); return b; }
    return concat(...(v as unknown[]).map((x) => enc(inner, x)));
  }
  if ("option" in type) return v === null || v === undefined ? Uint8Array.of(0) : concat(Uint8Array.of(1), enc(type.option, v));
  if ("defined" in type) {
    const def = TYPES.get(type.defined.name);
    if (!def?.type.fields) throw new Error(`unknown defined type ${type.defined.name}`);
    const obj = v as Record<string, unknown>;
    return concat(...def.type.fields.map((f) => enc(f.type, obj[camel(f.name)] ?? obj[f.name])));
  }
  throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
}

function dec(type: IdlType, b: Uint8Array, o: number): [unknown, number] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (typeof type === "string") {
    switch (type) {
      case "u8": return [d.getUint8(o), o + 1];
      case "bool": return [d.getUint8(o) !== 0, o + 1];
      case "u16": return [d.getUint16(o, true), o + 2];
      case "u32": return [d.getUint32(o, true), o + 4];
      case "u64": return [d.getBigUint64(o, true), o + 8];
      case "i64": return [d.getBigInt64(o, true), o + 8];
      case "pubkey": return [new PublicKey(b.subarray(o, o + 32)), o + 32];
      default: throw new Error(`unsupported IDL type ${type}`);
    }
  }
  if ("array" in type) {
    const [inner, len] = type.array;
    if (inner === "u8") return [b.slice(o, o + len), o + len];
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) { const [x, n] = dec(inner, b, o); out.push(x); o = n; }
    return [out, o];
  }
  if ("option" in type) return d.getUint8(o) === 0 ? [null, o + 1] : dec(type.option, b, o + 1);
  if ("defined" in type) return decStruct(type.defined.name, b, o);
  throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
}

function decStruct(name: string, b: Uint8Array, o: number): [Record<string, unknown>, number] {
  const def = TYPES.get(name);
  if (!def?.type.fields) throw new Error(`unknown struct ${name}`);
  const out: Record<string, unknown> = {};
  for (const f of def.type.fields) { const [v, n] = dec(f.type, b, o); out[camel(f.name)] = v; o = n; }
  return [out, o];
}

/** Build a SolSend instruction from the IDL. `accounts` keys may be camelCase or snake_case. */
export function buildSolsendIx(name: string, args: Record<string, unknown>, accounts: Record<string, PublicKey>, remaining: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = []): TransactionInstruction {
  const ix = IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`unknown instruction ${name}`);
  const keys = ix.accounts.map((a) => {
    const pubkey = accounts[camel(a.name)] ?? accounts[a.name];
    if (!pubkey) throw new Error(`${name}: missing account ${a.name}`);
    return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
  });
  const data = concat(Uint8Array.from(ix.discriminator), ...ix.args.map((a) => enc(a.type, args[camel(a.name)] ?? args[a.name])));
  return new TransactionInstruction({ programId: new PublicKey(IDL.address), keys: [...keys, ...remaining], data: data as Buffer });
}

/** Decode a SolSend account (`Card` | `Config` | `SettlementRecord`); returns null if the discriminator differs. */
export function decodeSolsendAccount<T = Record<string, unknown>>(name: "Card" | "Config" | "SettlementRecord", data: Uint8Array): T | null {
  const disc = IDL.accounts?.find((a) => a.name === name)?.discriminator;
  if (!disc || data.length < 8 || !disc.every((x, i) => data[i] === x)) return null;
  return decStruct(name, data, 8)[0] as T;
}

/** Decode one SolSend event payload (bytes after base64-decoding a `Program data:` line). */
export function decodeSolsendEventBytes(bytes: Uint8Array): { name: string; data: Record<string, unknown> } | null {
  const ev = (IDL.events ?? []).find((e) => e.discriminator.every((x, i) => bytes[i] === x));
  if (!ev) return null;
  return { name: ev.name, data: decStruct(ev.name, bytes, 8)[0] };
}
