// QuickNode Streams filter (Solana devnet) — GATE 0 / G0.7 spike.
// Runs inside QuickNode's sandbox: no require/import/network. Must be named `main`.
// Supports both Solana datasets:
//   programs_with_logs : stream.data = [[{signature, slot, blockTime, success, logs, programInvocations[]}]]
//   block              : stream.data = [{blockTime, transactions:[{meta, transaction:{signatures, message}}]}]
//
// Match rule: keep a transaction iff it touches a watched account (card vault ATAs,
// card wallet owners) OR invokes the SolSend program. We do NOT match on the SPL Token
// program or Bridge's issuer program alone — that would deliver every token transfer /
// every Bridge card pull on devnet. Bridge pulls from OUR vaults still match because
// the vault ATA is an account in the transaction.
//
// The three double-underscore placeholders below are substituted by g07-create-stream.ts.

const WATCH_ACCOUNTS = __WATCH_ACCOUNTS__;
const OUR_PROGRAMS = __OUR_PROGRAMS__;
const KV_LIST = __KV_LIST__; // null → use WATCH_ACCOUNTS only
const ISSUER_PROGRAM = "cardWArqhdV5jeRXXjUti7cHAa4mj41Nj3Apc6RPZH2";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_IX = { 3: "Transfer", 4: "Approve", 5: "Revoke", 9: "CloseAccount", 12: "TransferChecked", 13: "ApproveChecked" };

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58FirstByte(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  const bytes = [0];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  if (zeros > 0) return 0;
  return bytes[bytes.length - 1];
}

function keyOf(k) { return typeof k === "string" ? k : (k && k.pubkey) || null; }

async function watched(keys) {
  const set = new Set(WATCH_ACCOUNTS);
  const hits = keys.filter((k) => set.has(k));
  if (KV_LIST && hits.length === 0 && keys.length) {
    const flags = await qnLib.qnContainsListItems(KV_LIST, keys);
    keys.forEach((k, i) => { if (flags[i]) hits.push(k); });
  }
  return hits;
}

function anchorEvents(logs) {
  return (logs || []).filter((l) => l.startsWith("Program data: ")).map((l) => l.slice(14));
}

async function fromProgramsWithLogs(tx) {
  const invocations = tx.programInvocations || [];
  const keys = [];
  const programs = new Set();
  const splOps = [];
  for (const inv of invocations) {
    programs.add(inv.programId);
    const accts = ((inv.instruction && inv.instruction.accounts) || []).map(keyOf).filter(Boolean);
    keys.push(...accts);
    if (inv.programId === TOKEN_PROGRAM) {
      const op = SPL_IX[b58FirstByte(inv.instruction && inv.instruction.data)];
      if (op) splOps.push({ op, accounts: accts.slice(0, 3) });
    }
  }
  const uniq = [...new Set(keys)];
  const hits = await watched(uniq);
  const ours = [...programs].filter((p) => OUR_PROGRAMS.includes(p));
  if (!hits.length && !ours.length) return null;
  return {
    signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime, success: tx.success,
    watchedAccounts: hits, ourPrograms: ours, issuerProgram: programs.has(ISSUER_PROGRAM),
    splOps, anchorEvents: anchorEvents(tx.logs),
  };
}

async function fromBlockTx(tx, blockTime, slot) {
  const msg = (tx.transaction && tx.transaction.message) || {};
  const keys = (msg.accountKeys || []).map(keyOf).filter(Boolean);
  const progs = new Set((msg.instructions || []).map((ix) => ix.programId).filter(Boolean));
  const logs = (tx.meta && tx.meta.logMessages) || [];
  for (const l of logs) { const m = /^Program (\w+) invoke/.exec(l); if (m) progs.add(m[1]); }
  const hits = await watched(keys);
  const ours = [...progs].filter((p) => OUR_PROGRAMS.includes(p));
  if (!hits.length && !ours.length) return null;
  return {
    signature: (tx.transaction.signatures || [])[0], slot, blockTime, success: !(tx.meta && tx.meta.err),
    watchedAccounts: hits, ourPrograms: ours, issuerProgram: progs.has(ISSUER_PROGRAM),
    anchorEvents: anchorEvents(logs),
  };
}

async function main(stream) {
  const out = [];
  const data = stream.data || [];
  const slot0 = stream.metadata && stream.metadata.batch_start_range;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (Array.isArray(item)) {
      for (const tx of item) { const m = await fromProgramsWithLogs(tx); if (m) out.push(m); }
    } else if (item && Array.isArray(item.transactions)) {
      const slot = typeof slot0 === "number" ? slot0 + i : null;
      for (const tx of item.transactions) { const m = await fromBlockTx(tx, item.blockTime, slot); if (m) out.push(m); }
    }
  }
  if (!out.length) return null;
  return { solsend: "g0.7", dataset: stream.metadata && stream.metadata.dataset, matches: out };
}
