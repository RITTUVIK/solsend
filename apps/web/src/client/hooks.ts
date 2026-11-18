"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { humanError } from "./api";

export interface Polled<T> { data: T | null; error: string | null; loading: boolean; refresh: () => Promise<void> }

/** Polls `fn` every `ms` while mounted + the tab is visible. Keeps last good data on error. `enabled=false` pauses. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, enabled = true): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      setData(await fnRef.current());
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
