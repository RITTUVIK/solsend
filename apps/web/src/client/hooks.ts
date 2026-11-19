"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { humanError } from "./api";

export interface Polled<T> { data: T | null; error: string | null; loading: boolean; refresh: () => Promise<void> }

/** Last good result per cache key, kept across page navigations (every app page mounts its own AppShell, so without
 *  this each tab switch started from an empty skeleton until the API answered). In memory only; keys include the
 *  wallet so one account never sees another's data. Cleared on logout. */
const pollCache = new Map<string, unknown>();
export const clearPollCache = () => pollCache.clear();

/** Polls `fn` every `ms` while mounted + the tab is visible. Keeps last good data on error. `enabled=false` pauses.
 *  With `cacheKey`, a remount shows the last data for that key immediately and refreshes it in the background. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, enabled = true, cacheKey?: string): Polled<T> {
  const cached = () => (cacheKey !== undefined && pollCache.has(cacheKey) ? (pollCache.get(cacheKey) as T) : null);
  const [data, setData] = useState<T | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => cached() === null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(cacheKey);
  const inflight = useRef(false);

  // Key changed while mounted (e.g. another wallet): never keep showing the previous key's data.
  if (keyRef.current !== cacheKey) {
    keyRef.current = cacheKey;
    const next = cached();
    setData(next);
    setLoading(next === null);
  }

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    const key = keyRef.current;
    try {
      const value = await fnRef.current();
      if (key !== keyRef.current) return; // answer for a key we've since left
      if (key !== undefined) pollCache.set(key, value);
      setData(value);
      setError(null);
    } catch (e) {
      setError(humanError(e));
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    void refresh();
    const t = setInterval(() => { if (!stop && document.visibilityState === "visible") void refresh(); }, ms);
    return () => { stop = true; clearInterval(t); };
  }, [ms, enabled, refresh]);

  return { data, error, loading, refresh };
}
