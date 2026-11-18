import type { CSSProperties } from "react";

/** Per-store card art. CSS only, no trademarks: monogram letters + brand-adjacent palettes, always shown with "(sandbox)". */
export interface CardArt { key: string; monogram: string; background: string; accentBar?: string; swatch: string }

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

export function cardArt(merchantName: string): CardArt {
  const k = merchantName.trim().toLowerCase();
  if (k === "temu" || k === "temu (sandbox)") {
    return {
      key: "temu", monogram: "T", swatch: "#F2410F",
      background: "repeating-linear-gradient(135deg, rgb(255 255 255 / .06) 0 1px, transparent 1px 7px), radial-gradient(120% 90% at 100% 0%, rgb(255 190 120 / .35), transparent 55%), linear-gradient(140deg, #FF7A1A 0%, #F2410F 55%, #C8102E 100%)",
    };
  }
  if (k === "amazon" || k === "amazon (sandbox)") {
    return {
      key: "amazon", monogram: "a", swatch: "#232F3E", accentBar: "#FF9900",
      background: "radial-gradient(120% 80% at 100% 100%, rgb(255 153 0 / .20), transparent 60%), linear-gradient(160deg, #2B3A4C 0%, #19222E 55%, #0F1722 100%)",
    };
  }
  if (k === "netflix" || k === "netflix (sandbox)") {
    return {
      key: "netflix", monogram: "N", swatch: "#B20710",
      background: "radial-gradient(42% 120% at 86% -10%, rgb(229 9 20 / .75), transparent 70%), radial-gradient(60% 80% at 0% 100%, rgb(120 0 8 / .35), transparent 70%), linear-gradient(160deg, #1A1A1A 0%, #0A0A0A 100%)",
    };
  }
  const h = hash(k || "store") % 360;
  return {
    key: "custom", monogram: (merchantName.trim()[0] ?? "S").toUpperCase(), swatch: `hsl(${h} 65% 45%)`,
    background: `radial-gradient(120% 120% at 0% 0%, hsl(${h} 80% 62% / .95), transparent 60%), radial-gradient(120% 120% at 100% 100%, hsl(${(h + 40) % 360} 75% 38%), transparent 62%), hsl(${(h + 15) % 360} 60% 32%)`,
  };
}

export const artStyle = (a: CardArt): CSSProperties => ({ background: a.background });

/** Map a demo-store enum (TEMU, AMAZON, …) to the art key's merchant name. */
export const STORE_ART_NAME: Record<string, string> = { TEMU: "Temu", AMAZON: "Amazon", NETFLIX: "Netflix", OTHER_STORE: "Corner Cafe" };
