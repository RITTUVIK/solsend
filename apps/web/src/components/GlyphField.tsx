"use client";
// Arrow-glyph field for the Home hero: a canvas of tiny arrows over the hero gradient, thinning out toward the middle.
// Adapted from "Onward Summit Template" by Kedhareswer Naidu (MIT, https://kedhar.pages.dev), cut down to the hero
// field. Deliberately STATIC: drawn once, and again only after its size settles (while it is resizing, e.g. the app pane
// opening or the divider being dragged, the old bitmap is just stretched by CSS, so no frame pays for a redraw). An animated version (cursor lean,
// opening ripple, shimmer) measured at ~56% idle main-thread CPU on desktop and 100% / 13 fps on a 4x-throttled phone.
import { useEffect, useRef } from "react";

const CELL = 13;
const LIGHT = "#c4b5fd"; // violet arrows over the purple
const DARK = "#14f195"; // mint arrows toward the bottom

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** How much light / dark glyph a cell gets at (u, v) in 0..1: violet on the purple, mint near the bottom, thinner in the middle. */
function weights(u: number, v: number, aspect: number): [number, number] {
  const rise = 0.3 + 0.7 * smoothstep(0.02, 0.48, v);
  const light = rise * (1 - smoothstep(0.5, 0.74, v));
  const dark = smoothstep(0.54, 0.72, v) * (1 - smoothstep(0.8, 0.985, v));
  const dx = (u - 0.5) * aspect;
  const dy = (v - 0.47) * 1.25;
  const part = 0.1 + 0.9 * smoothstep(0.1, 0.4, Math.sqrt(dx * dx + dy * dy));
  return [light * part * 0.8, dark * part * 0.55];
}
function arrowSprite(color: string, dpr: number) {
  const c = document.createElement("canvas");
  const px = Math.ceil(CELL * dpr * 2);
  c.width = c.height = px;
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(px / CELL, px / CELL);
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.05, CELL * 0.105);
  g.lineCap = "square";
  g.lineJoin = "miter";
  const h = CELL * 0.31, m = CELL / 2;
  g.beginPath();
  g.moveTo(m - h, m + h); g.lineTo(m + h, m - h);
  g.moveTo(m - h * 0.15, m - h); g.lineTo(m + h, m - h); g.lineTo(m + h, m + h * 0.15);
  g.stroke();
  return c;
}

export function GlyphField() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current, cv = canvasRef.current;
    if (!wrap || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let lastW = 0, lastH = 0;

    const draw = () => {
      const r = wrap.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
      if (W === lastW && H === lastH) return;
      lastW = W; lastH = H;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const spriteL = arrowSprite(LIGHT, dpr), spriteD = arrowSprite(DARK, dpr);
      const cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
      const ox = (W - (cols - 1) * CELL) / 2, oy = (H - (rows - 1) * CELL) / 2;
      const rand = mulberry32(cols * 977 + rows);
      const half = CELL / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = ox + i * CELL, y = oy + j * CELL;
          const [a0, b0] = weights(x / W, y / H, W / H);
          const g = 0.5 + 0.5 * rand();
          if (a0 + b0 < 0.012) continue;
          const la = clamp(a0 * g, 0, 1), da = clamp(b0 * g, 0, 1);
          if (la > 0.01) { ctx.globalAlpha = la; ctx.drawImage(spriteL, x - half, y - half, CELL, CELL); }
          if (da > 0.01) { ctx.globalAlpha = da; ctx.drawImage(spriteD, x - half, y - half, CELL, CELL); }
        }
      }
      ctx.globalAlpha = 1;
    };

    draw();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 150); });
    ro.observe(wrap);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  );
}
