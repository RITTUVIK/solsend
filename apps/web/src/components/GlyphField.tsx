"use client";
// Arrow field behind the Home hero: a lattice of tiny north-east arrows, violet over the purple and mint toward the
// bottom, with a clearing behind the headline. Original SolSend code (see THIRD_PARTY_NOTICES.md for how it was written).
//
// How it draws: every cell gets a colour step and an opacity step from a smooth field; cells that land on the same
// (colour, opacity) pair are added to ONE path and stroked once, so a full-screen field is ~50 strokes, not ~9000 blits.
// It is static: drawn once, and again 150 ms after its size settles (while the app pane opens or the divider is dragged
// the old bitmap is simply stretched by CSS, so no animation frame pays for a redraw).
import { useEffect, useRef } from "react";

const PITCH = 13; // px between arrow centres
const SHAFT = PITCH * 0.44; // half the shaft length
const WING = PITCH * 0.36; // arrow-head barb length
const WIDTH = 1.35; // stroke width
const VIOLET: RGB = [196, 181, 253];
const MINT: RGB = [20, 241, 149];
const COLOUR_STEPS = 6;
const ALPHA_STEPS = 9;
const ALPHA_MAX = 0.8;
const ALPHA_MIN = 0.012;

type RGB = readonly [number, number, number];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/** Stable per-cell value in [0, 1) from the cell's lattice coordinates (integer hash), so resizing never reshuffles the field. */
function cellNoise(i: number, j: number): number {
  let h = Math.imul(i + 0x9e37, 0x27d4eb2d) ^ Math.imul(j + 0x79b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Row-wise part of the field (depends on v only, in 0..1 growing downward): two soft bands stacked top to bottom, violet rising out of the dark top and mint along the bottom edge. */
function bands(v: number) {
  const violet = (0.3 + 0.7 * logistic((v - 0.2) / 0.07)) * (1 - logistic((v - 0.62) / 0.045)) * 0.8;
  const mint = logistic((v - 0.63) / 0.04) * (1 - logistic((v - 0.91) / 0.03)) * 0.62;
  return { violet, mint };
}

/** Clearing around the headline: a Gaussian dip centred slightly above the middle, in screen proportions (1 = untouched, 0.1 = deepest). */
function clearing(u: number, v: number, aspect: number) {
  const dx = (u - 0.5) * aspect;
  const dy = (v - 0.47) * 1.25;
  return 1 - 0.9 * Math.exp(-(dx * dx + dy * dy) / 0.05);
}

/** Add one arrow, centred on (x, y) and pointing along `angle` (radians, screen coordinates), to a path. */
function addArrow(path: Path2D, x: number, y: number, angle: number) {
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const tipX = x + SHAFT * dirX, tipY = y + SHAFT * dirY;
  path.moveTo(x - SHAFT * dirX, y - SHAFT * dirY);
  path.lineTo(tipX, tipY);
  // Barbs: swing the reversed direction 45 degrees either way from the tip.
  for (const swing of [-Math.PI / 4, Math.PI / 4]) {
    const a = angle + Math.PI + swing;
    path.moveTo(tipX + WING * Math.cos(a), tipY + WING * Math.sin(a));
    path.lineTo(tipX, tipY);
  }
}

function paintField(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const cols = Math.ceil(W / PITCH) + 1, rows = Math.ceil(H / PITCH) + 1;
  const x0 = (W - (cols - 1) * PITCH) / 2, y0 = (H - (rows - 1) * PITCH) / 2;
  const NE = -Math.PI / 4;

  // One path per (colour step, opacity step).
  const buckets = new Map<number, Path2D>();
  for (let j = 0; j < rows; j++) {
    const y = y0 + j * PITCH;
    const { violet, mint: mintInk } = bands(y / H);
    const bandInk = violet + mintInk;
    if (bandInk < ALPHA_MIN) continue;
    const mint = mintInk / bandInk;
    for (let i = 0; i < cols; i++) {
      const x = x0 + i * PITCH;
      const alpha = bandInk * clearing(x / W, y / H, W / H) * (0.5 + 0.5 * cellNoise(i, j));
      if (alpha < ALPHA_MIN) continue;
      const c = Math.round(mint * (COLOUR_STEPS - 1));
      const a = Math.min(ALPHA_STEPS - 1, Math.round((alpha / ALPHA_MAX) * (ALPHA_STEPS - 1)));
      const key = c * ALPHA_STEPS + a;
      let path = buckets.get(key);
      if (!path) buckets.set(key, (path = new Path2D()));
      addArrow(path, x, y, NE);
    }
  }

  ctx.lineWidth = WIDTH;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  for (const [key, path] of buckets) {
    const c = Math.floor(key / ALPHA_STEPS), a = key % ALPHA_STEPS;
    const t = c / (COLOUR_STEPS - 1);
    ctx.strokeStyle = `rgb(${Math.round(lerp(VIOLET[0], MINT[0], t))} ${Math.round(lerp(VIOLET[1], MINT[1], t))} ${Math.round(lerp(VIOLET[2], MINT[2], t))})`;
    ctx.globalAlpha = Math.max(0.02, (a / (ALPHA_STEPS - 1)) * ALPHA_MAX);
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
}

export function GlyphField() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    let drawnW = 0, drawnH = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const redraw = () => {
      const box = wrap.getBoundingClientRect();
      const W = Math.max(1, Math.round(box.width)), H = Math.max(1, Math.round(box.height));
      if (W === drawnW && H === drawnH) return;
      drawnW = W; drawnH = H;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      paintField(ctx, W, H, dpr);
    };

    redraw();
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(redraw, 150); });
    observer.observe(wrap);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  );
}
