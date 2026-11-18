// Piggyback reconcile sweep (lead note): the GitHub Actions cron only runs on the default branch, so the
// UI's own polling (GET /api/feed every ~1.5 s, GET /api/cards) triggers a small sweep in `waitUntil`,
// at most once per 60 s globally (store.rateLimit fails CLOSED → skip). Never blocks or fails the request.
// Independent triggers: ASA late-settle watcher, Lithic events webhook, this piggyback, POST /api/reconcile.
import "server-only";
import type { Store } from "../store";
import { safeErr } from "../lib/safe";
import { sweep, type ReconcileDeps } from "./reconciler";

export const PIGGYBACK_WINDOW_SECS = 60;
export const PIGGYBACK_BATCH = 5;

export async function maybePiggybackSweep(getDeps: () => ReconcileDeps, store: Pick<Store, "rateLimit">): Promise<number | null> {
  try {
    if (!(await store.rateLimit("reconcile:sweep", PIGGYBACK_WINDOW_SECS, 1))) return null;
    const results = await sweep(getDeps(), { olderThanSecs: 20, limit: PIGGYBACK_BATCH });
    if (results.length) console.log(`[reconcile:piggyback] swept ${results.length}: ${results.map((r) => `${r.outcome}/${r.tag}`).join(", ")}`);
    return results.length;
  } catch (e) {
    console.error(`[reconcile:piggyback] skipped: ${safeErr(e)}`);
    return null;
  }
}
