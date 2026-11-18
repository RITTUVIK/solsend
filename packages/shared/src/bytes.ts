// Environment-neutral byte helpers (browser + Node; no Buffer dependency).
export const u64le = (n: bigint): Uint8Array => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
export const i64le = (n: bigint): Uint8Array => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, n, true); return b; };
export const readU64 = (b: Uint8Array, o: number): bigint => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(o, true);
export const readI64 = (b: Uint8Array, o: number): bigint => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigInt64(o, true);
export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string): Uint8Array => Uint8Array.from(h.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
/** Fixed 32-byte label (UTF-8, zero-padded, truncated at a char boundary). */
export const label32 = (s: string): Uint8Array => {
  const out = new Uint8Array(32);
  let bytes = utf8(s);
  while (bytes.length > 32) { s = s.slice(0, -1); bytes = utf8(s); }
  out.set(bytes);
  return out;
};
export const label32ToString = (b: Uint8Array): string => new TextDecoder().decode(b).replace(/\0+$/, "");
export function base64ToBytes(s: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return Uint8Array.from(globalThis.Buffer.from(s, "base64"));
}
export function bytesToBase64(b: Uint8Array): string {
  if (typeof btoa === "function") return btoa(String.fromCharCode(...b));
  return globalThis.Buffer.from(b).toString("base64");
}
