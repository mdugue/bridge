import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  normalQuantile,
  OUTLINE_BAND,
  OUTLINE_PULSE,
  OUTLINE_WIDTH_CSS_PX,
  outlinePulse,
  SELECTION_ACCENT,
  outlineKernel,
  outlineSigmaCssPx,
  outlineSpread,
} from "./outline";

test("the blur's kernel keeps the mask's level and has the sigma the width assumes", () => {
  const w = outlineKernel();
  expect(w).toHaveLength(3 + 2 * OUTLINE_BAND.sigma);
  // both sides: a flat mask stays at its value
  expect(w.reduce((sum, x, i) => sum + (i === 0 ? x : 2 * x), 0)).toBeCloseTo(
    1,
    12
  );
  // its spread in taps is what outlineSpread divides by — a little under,
  // where the kernel cuts the Gaussian's tails off
  const sd = Math.sqrt(w.reduce((sum, x, i) => sum + 2 * x * i * i, 0));
  const assumed = (3 + 2 * OUTLINE_BAND.sigma) / 3;
  expect(sd).toBeLessThan(assumed);
  expect(sd).toBeGreaterThan(assumed * 0.95);
});

test("the quantile inverts the normal distribution", () => {
  expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
  expect(normalQuantile(0.975)).toBeCloseTo(1.959_96, 4);
  expect(normalQuantile(0.01)).toBeCloseTo(-2.326_35, 4);
});

test("the band is the outline's width in CSS px, whatever the screen", () => {
  const sigma = outlineSigmaCssPx();
  const width =
    sigma *
    (normalQuantile(OUTLINE_BAND.to) - normalQuantile(OUTLINE_BAND.from));
  expect(width).toBeCloseTo(OUTLINE_WIDTH_CSS_PX, 9);
  // twice the pixel ratio, twice the reach in drawing pixels
  expect(outlineSpread(2)).toBeCloseTo(outlineSpread(1) * 2, 9);
  // the taps stay under a texel apart on a phone's 3× screen: no gaps
  expect(outlineSpread(3)).toBeLessThan(1.2);
});

test("the flash starts full and is gone once it has settled", () => {
  expect(outlinePulse(0)).toBe(1);
  expect(outlinePulse(OUTLINE_PULSE.ms)).toBe(0);
  expect(outlinePulse(-1)).toBe(0);
  expect(outlinePulse(Number.NaN)).toBe(0);
  const a = outlinePulse(OUTLINE_PULSE.ms * 0.25);
  const b = outlinePulse(OUTLINE_PULSE.ms * 0.5);
  expect(a).toBeGreaterThan(b);
  expect(b).toBeGreaterThan(0);
});

/** OKLCH to linear sRGB (Björn Ottosson's matrices), clamped at 0. */
function oklchLinear(l: number, c: number, h: number): number[] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const M = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const S = (l - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    4.076_741_662_1 * L - 3.307_711_591_3 * M + 0.230_969_929_2 * S,
    -1.268_438_004_6 * L + 2.609_757_401_1 * M - 0.341_319_396_5 * S,
    -0.004_196_086_3 * L - 0.703_418_614_7 * M + 1.707_614_701 * S,
  ].map((v) => Math.max(v, 0));
}

test("the selection's colours are the HUD's accent", () => {
  const css = readFileSync(`${import.meta.dir}/../../app/globals.css`, "utf8");
  const token = (name: string) => {
    const m = new RegExp(
      `\\n\\s*--${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`
    ).exec(css);
    if (!m) {
      throw new Error(`--${name} not found`);
    }
    return oklchLinear(Number(m[1]), Number(m[2]), Number(m[3]));
  };
  const pairs = [
    [SELECTION_ACCENT.line, token("sidebar-primary")],
    [SELECTION_ACCENT.ink, token("primary")],
    [SELECTION_ACCENT.halo, token("primary-foreground")],
  ] as const;
  for (const [ours, theirs] of pairs) {
    ours.forEach((v, i) => expect(v).toBeCloseTo(theirs[i], 2));
  }
});
