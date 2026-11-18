// QuickNode Streams filter — Solana DEVNET, dataset "programs_with_logs" (CP0b / G0.7).
// Runs in QuickNode's sandbox: no require/import/network. Must be named `main`.
//
// Verified payload shape (test_filter on a real settle, slot 523505277):
//   stream.data = [[ { signature, slot, blockTime, success, logs[], programInvocations[] } ]]
//   programInvocations lists TOP-LEVEL instructions only (no inner CPIs); instruction.data is base58;
//   instruction.tokenBalances are post-balances { accountIndex, mint, owner, uiTokenAmount }.
//   logs are complete, including nested CPIs.
// So: we match transactions that invoke OUR policy program and decode OUR Anchor events from the
// `Program data:` lines emitted while our program is executing (tracked with an invoke stack).
//
// __OUR_PROGRAM__ is substituted by g07-create-stream.ts / g07-selftest.ts.

const OUR_PROGRAM = __OUR_PROGRAM__;
const ALLOWANCES = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const EVENTS = { "34,206,169,204,178,170,227,94": "CardSettled", "212,19,183,194,172,112,247,175": "CardRefunded" };

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64decode(s) {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return out;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let s = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) s += "1";
  for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
  return s;
}

function u64(b, o) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]);
  return v.toString();
}
const hex = (b) => b.map((x) => x.toString(16).padStart(2, "0")).join("");

function decodeEvent(bytes) {
  const name = EVENTS[bytes.slice(0, 8).join(",")];
  if (!name) return null;
  let o = 8;
  const pk = () => { const v = b58encode(bytes.slice(o, o + 32)); o += 32; return v; };
  const n = () => { const v = u64(bytes, o); o += 8; return v; };
  const h = () => { const v = hex(bytes.slice(o, o + 32)); o += 32; return v; };
  if (name === "CardSettled") return { name, card: pk(), owner: pk(), amount: n(), remainingAllowance: n(), authHash: h(), totalSettled: n() };
  return { name, card: pk(), owner: pk(), amount: n(), authHash: h(), recordRefunded: n(), destination: pk() };
}

function decodeTx(tx) {
  const logs = tx.logs || [];
  const stack = [];
  const events = [];
  let instruction = null;
  for (const line of logs) {
    const inv = /^Program (\w+) invoke \[\d+\]/.exec(line);
    if (inv) { stack.push(inv[1]); continue; }
    if (/^Program \w+ (success|failed)/.test(line)) { stack.pop(); continue; }
    const top = stack[stack.length - 1];
    if (top !== OUR_PROGRAM) continue;
    if (!instruction && line.startsWith("Program log: Instruction: ")) instruction = line.slice(26);
    if (line.startsWith("Program data: ")) { const ev = decodeEvent(b64decode(line.slice(14))); if (ev) events.push(ev); }
  }
  const ours = (tx.programInvocations || []).find((i) => i.programId === OUR_PROGRAM);
  const balances = ((ours && ours.instruction && ours.instruction.tokenBalances) || [])
    .filter((t) => t.mint === USDC_MINT)
    .map((t) => ({ owner: t.owner, amount: t.uiTokenAmount && t.uiTokenAmount.amount }));
  return {
    signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime, success: tx.success,
    instruction, events, postUsdcBalances: balances,
    allowancesInvoked: logs.some((l) => l.startsWith("Program " + ALLOWANCES + " invoke")),
  };
}

function main(stream) {
  const matches = [];
  for (const item of stream.data || []) {
    for (const tx of Array.isArray(item) ? item : []) {
      if ((tx.programInvocations || []).some((i) => i.programId === OUR_PROGRAM)) matches.push(decodeTx(tx));
    }
  }
  if (!matches.length) return null;
  return { solsend: "cp0b-g07", batch: [stream.metadata && stream.metadata.batch_start_range, stream.metadata && stream.metadata.batch_end_range], matches };
}
