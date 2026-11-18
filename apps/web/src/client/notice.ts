"use client";
import { useSyncExternalStore } from "react";

// Tiny global notice channel (used for "Signing took a little long" during the automatic tx_expired retry).
let current: string | null = null;
const subs = new Set<() => void>();
export function setSignNotice(msg: string | null): void {
  current = msg;
  subs.forEach((f) => f());
}
export function useSignNotice(): string | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => null);
}
