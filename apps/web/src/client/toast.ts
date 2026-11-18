"use client";
import { useSyncExternalStore } from "react";

// Tiny global toast channel: one toast at a time, replaces inline success boxes that used to pile up.
export interface Toast { id: number; title: string; sig?: string | null; linkLabel?: string; testId?: string }
let current: Toast | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(t: Omit<Toast, "id">, ms = 5000): void {
  current = { ...t, id: ++seq };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { current = null; emit(); }, ms);
  emit();
}
export function dismissToast(): void {
  current = null;
  if (timer) clearTimeout(timer);
  emit();
}
export function useToast(): Toast | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => null);
}
