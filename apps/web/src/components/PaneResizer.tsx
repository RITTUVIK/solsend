"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Drag handle on the left edge of the app pane (desktop split layout, components/SplitFrame.tsx). It sets the
// `--app-w` CSS variable that both the pane and the landing's right edge follow, so nothing else needs to know.
// Keyboard: ←/→ resize, Home = widest, End = narrowest, Enter or double-click = back to the default width.
// The chosen width is remembered in localStorage and kept valid when the window is resized.

const STORAGE_KEY = "solsend.appPaneWidth";
const MIN_PANE = 420; // narrowest the app stays usable
const MIN_LANDING = 440; // always leave this much of the landing visible (and clear of the sandbox pill, bottom-left, ~417 px wide)
const STEP = 40;

const maxPane = () => Math.max(MIN_PANE, window.innerWidth - MIN_LANDING);
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, MIN_PANE), maxPane()));
const paneWidth = () => document.querySelector<HTMLElement>('[data-testid="app-pane"]')?.getBoundingClientRect().width ?? MIN_PANE;
function save(w: number | null) {
  try { if (w === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, String(w)); } catch { /* private mode */ }
}

export function PaneResizer() {
  const [width, setWidth] = useState<number | null>(null); // null = the default from CSS (clamp of the viewport)
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragging = useRef(false);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) setWidth(clampWidth(saved));
    } catch { /* private mode */ }
    const refit = () => setWidth((w) => (w === null ? null : clampWidth(w)));
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);

  useEffect(() => {
    const s = document.documentElement.style;
    if (width === null) s.removeProperty("--app-w"); else s.setProperty("--app-w", `${width}px`);
  }, [width]);

  const stop = () => {
    if (!dragging.current) return;
    dragging.current = false;
    document.documentElement.classList.remove("pane-resizing");
    save(widthRef.current);
  };
  useEffect(() => stop, []); // unmounted mid-drag (navigated away): never leave the page stuck in resize mode

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    document.documentElement.classList.add("pane-resizing"); // no transitions, no text selection while dragging
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setWidth(clampWidth(window.innerWidth - e.clientX));
  };
  const reset = () => { setWidth(null); save(null); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const now = widthRef.current ?? paneWidth();
    const next = e.key === "ArrowLeft" ? now + STEP : e.key === "ArrowRight" ? now - STEP
      : e.key === "Home" ? maxPane() : e.key === "End" ? MIN_PANE : null;
    if (e.key === "Enter") { e.preventDefault(); reset(); return; }
    if (next === null) return;
    e.preventDefault();
    const w = clampWidth(next);
    setWidth(w);
    save(w);
  };

  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize the app panel" tabIndex={0}
      aria-valuemin={MIN_PANE} aria-valuenow={Math.round(width ?? 0) || undefined} aria-valuetext={width === null ? "Default width" : `${width} pixels wide`}
      title="Drag to resize · double-click to reset"
      className="pane-resizer" data-testid="pane-resizer"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stop} onPointerCancel={stop}
      onDoubleClick={reset} onKeyDown={onKeyDown} />
  );
}
