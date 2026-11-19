"use client";
// Arrow-glyph field for the Home hero: a canvas of tiny arrows over the hero gradient, thinning out around the
// title. Adapted from "Onward Summit Template" by Kedhareswer Naidu (MIT, https://kedhar.pages.dev), cut down to the
// hero field and deliberately calmer: arrows only lean a little near the pointer (no swelling, no click ripples, no
// intro pulse), the idle shimmer is slow, and it redraws at ~30 fps when nothing is moving. Static under
// prefers-reduced-motion, paused when off screen or in a background tab.
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
/** Signed angle in (-PI, PI] that turns 0 into a. */
function shortestAngle(a: number) {
  const T = Math.PI * 2;
  let r = ((((a + Math.PI) % T) + T) % T) - Math.PI;
  if (r === -Math.PI) r = Math.PI;
  return r;
}
/** How much light / dark glyph a cell gets at (u, v) in 0..1: light on the navy, dark on the pale, both part around the title. */
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
    const wrap = wrapRef.current, cv = canvasRef.current, host = wrap?.parentElement;
    if (!wrap || !cv || !host) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let W = 1, H = 1, dpr = 1, n = 0;
    let xs = new Float32Array(0), ys = new Float32Array(0), wl = new Float32Array(0), wd = new Float32Array(0);
    let grain = new Float32Array(0), ang = new Float32Array(0);
    let spriteL: HTMLCanvasElement | null = null, spriteD: HTMLCanvasElement | null = null;
    const ptr = { x: 0, y: 0, on: false };
    let raf = 0, last = 0, visible = true, settled = true;
    const half = CELL / 2;

    const layout = () => {
      const r = wrap.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      const cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
      n = cols * rows;
      xs = new Float32Array(n); ys = new Float32Array(n); wl = new Float32Array(n); wd = new Float32Array(n);
      grain = new Float32Array(n); ang = new Float32Array(n);
      const ox = (W - (cols - 1) * CELL) / 2, oy = (H - (rows - 1) * CELL) / 2;
      const rand = mulberry32(cols * 977 + rows);
      for (let j = 0, k = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++, k++) {
          const x = ox + i * CELL, y = oy + j * CELL;
          const w = weights(x / W, y / H, W / H);
          xs[k] = x; ys[k] = y; wl[k] = w[0]; wd[k] = w[1]; grain[k] = 0.5 + 0.5 * rand();
        }
      }
      spriteL = arrowSprite(LIGHT, dpr); spriteD = arrowSprite(DARK, dpr);
    };

    const R = 110, R2 = R * R;
    const draw = (t: number) => {
      if (!spriteL || !spriteD) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      let moving = false;
      for (let i = 0; i < n; i++) {
        const a0 = wl[i]!, b0 = wd[i]!;
        if (a0 + b0 < 0.012) continue;
        const x = xs[i]!, y = ys[i]!;
        if (!reduced) {
          let target = 0;
          if (ptr.on) {
            const dx = x - ptr.x, dy = y - ptr.y, d2 = dx * dx + dy * dy;
            if (d2 < R2) { let w = 1 - Math.sqrt(d2) / R; w = w * w * (3 - 2 * w); target = shortestAngle(Math.atan2(dy, dx) + Math.PI / 4) * w * 0.45; }
          }
          ang[i]! += (target - ang[i]!) * 0.1;
          if (Math.abs(ang[i]! - target) > 0.004) moving = true;
        }
        const shimmer = reduced ? 1 : 0.86 + 0.14 * Math.sin((x + y * 0.8) * 0.011 - t * 0.0007);
        const g = grain[i]! * shimmer;
        const a = ang[i]!;
        if (Math.abs(a) < 0.003) ctx.setTransform(dpr, 0, 0, dpr, dpr * x, dpr * y);
        else { const c = Math.cos(a) * dpr, s = Math.sin(a) * dpr; ctx.setTransform(c, s, -s, c, dpr * x, dpr * y); }
        const la = clamp(a0 * g, 0, 1), da = clamp(b0 * g, 0, 1);
        if (la > 0.01) { ctx.globalAlpha = la; ctx.drawImage(spriteL, -half, -half, CELL, CELL); }
        if (da > 0.01) { ctx.globalAlpha = da; ctx.drawImage(spriteD, -half, -half, CELL, CELL); }
      }
      ctx.globalAlpha = 1;
      settled = !moving && !ptr.on;
    };

    const loop = (t: number) => {
      raf = 0;
      // Full rate only while arrows are easing toward the pointer; ~30 fps for the slow shimmer otherwise.
      if (!settled || t - last >= 33) { last = t; draw(t); }
      if (visible && !reduced && document.visibilityState === "visible") raf = requestAnimationFrame(loop);
    };
    const start = () => { if (!raf && visible && !reduced) raf = requestAnimationFrame(loop); };

    layout();
    draw(performance.now());

    const ro = new ResizeObserver(() => { layout(); draw(performance.now()); });
    ro.observe(wrap);
    const io = new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting);
      if (visible) start(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    });
    io.observe(wrap);
    const onVis = () => { if (document.visibilityState === "visible") start(); };
    document.addEventListener("visibilitychange", onVis);
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = wrap.getBoundingClientRect();
      ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.on = true; settled = false;
    };
    const leave = () => { ptr.on = false; };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <canvas ref={canvasRef} className="absolute left-0 top-0 block max-w-none" />
    </div>
  );
}
