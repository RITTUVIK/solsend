// Evidence capture. Curated, non-secret records go to spikes/evidence/<step>.jsonl
// (reviewed, then committed). Full provider payloads go to spikes/.raw/ (gitignored).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SPIKES_DIR } from "./env.js";

const EVIDENCE_DIR = join(SPIKES_DIR, "evidence");
const RAW_DIR = join(SPIKES_DIR, ".raw");
const STATE_FILE = join(RAW_DIR, "state.json");
mkdirSync(EVIDENCE_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });

// PCI hard rule 7 + link-token hygiene: never persist these keys in evidence.
const SCRUB_KEYS = new Set(["number", "cvc", "cvv", "pan", "kyc_link", "tos_link", "secret", "client_secret", "ephemeral_key"]);

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        SCRUB_KEYS.has(k.toLowerCase()) ? [k, "[scrubbed]"] : [k, scrub(v)],
      ),
    );
  }
  return value;
}

export function record(step: string, event: string, data: Record<string, unknown> = {}): void {
  // Metadata keys last so payload fields can never overwrite them.
  const line = { ...(scrub(data) as Record<string, unknown>), ts: new Date().toISOString(), step, event };
  appendFileSync(join(EVIDENCE_DIR, `${step}.jsonl`), JSON.stringify(line) + "\n");
  console.log(`[${step}] ${event}`, JSON.stringify(scrub(data), null, 2));
}

/** Full payload for debugging; gitignored. Still scrubbed for PAN/CVC. */
export function saveRaw(name: string, payload: unknown): void {
  const file = join(RAW_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.json`);
  writeFileSync(file, JSON.stringify(scrub(payload), null, 2));
}

type State = Record<string, unknown>;
export function loadState(): State {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : {};
}
export function saveState(patch: State): State {
  const next = { ...loadState(), ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}
export function stateStr(key: string): string | undefined {
  const v = loadState()[key];
  return typeof v === "string" ? v : undefined;
}

export async function poll<T>(
  label: string,
  fn: () => Promise<T | undefined>,
  { intervalMs = 3000, timeoutMs = 10 * 60_000 } = {},
): Promise<T | undefined> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() - started > timeoutMs) {
      console.warn(`[poll] ${label}: timed out after ${Math.round((Date.now() - started) / 1000)}s`);
      return undefined;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
