import { expect, test } from "bun:test";
import {
  normalQuantile,
  OUTLINE_BAND,
  OUTLINE_WIDTH_CSS_PX,
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
