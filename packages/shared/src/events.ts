// CP1 CONTRACT — decode SolSend Anchor events from transaction logs, scoped to `Program data:` lines
// emitted while the SolSend program is the executing program (CPI-callee data lines are ignored).
// Same algorithm as infra/quicknode/filter.js (verified live in CP0b G0.7).
import { SOLSEND_PROGRAM_ID } from "./constants.js";
import { base64ToBytes } from "./bytes.js";
import { decodeSolsendEventBytes } from "./idl.js";

export type SolsendEvent = { name: string; data: Record<string, unknown> };

export function decodeSolsendEventsFromLogs(logs: string[], programId = SOLSEND_PROGRAM_ID.toBase58()): SolsendEvent[] {
  const stack: string[] = [];
  const out: SolsendEvent[] = [];
  for (const line of logs) {
    const inv = /^Program (\w+) invoke \[\d+\]/.exec(line);
    if (inv) { stack.push(inv[1]!); continue; }
    if (/^Program \w+ (success|failed)/.test(line)) { stack.pop(); continue; }
    if (stack[stack.length - 1] !== programId || !line.startsWith("Program data: ")) continue;
    const ev = decodeSolsendEventBytes(base64ToBytes(line.slice(14)));
    if (ev) out.push(ev);
  }
  return out;
}
