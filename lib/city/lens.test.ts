import { expect, test } from "bun:test";
import {
  blurPxAt,
  FOCUS_PULL_MS,
  focalLengthMm,
  horizonBlurPx,
  LENS_FADE_MS,
  lensFadeIn,
  maxBlurPx,
  pullFocus,
  SKY_FOCUS_M,
} from "./lens";
import {
  createRegressionState,
  lensFade,
  RECOVER_MS,
  stepRegression,
} from "./regression";

test("the default 55° view is a 23 mm lens on full frame", () => {
  expect(focalLengthMm(55)).toBeCloseTo(23.05, 1);
  expect(focalLengthMm(90)).toBeCloseTo(12, 5);
});

test("focused near, the horizon blurs; focused far, it stays sharp", () => {
  // a 1440 px tall frame at the default view angle
  expect(horizonBlurPx(5, 55, 1440)).toBeCloseTo(7.8, 1);
  expect(horizonBlurPx(20, 55, 1440)).toBeCloseTo(1.9, 1);
  expect(horizonBlurPx(400, 55, 1440)).toBeLessThan(0.1);
  // twice the pixels, twice the pixels of blur: the same angle on screen
  expect(horizonBlurPx(5, 55, 2880)).toBeCloseTo(
    2 * horizonBlurPx(5, 55, 1440),
    6
  );
  // a narrower view (a longer lens, the same opening) blurs more
  expect(horizonBlurPx(5, 30, 1440)).toBeGreaterThan(
    horizonBlurPx(5, 55, 1440)
  );
});

test("focused down the street, what stands near blurs", () => {
  const horizon = horizonBlurPx(SKY_FOCUS_M, 55, 1440);
  const cap = maxBlurPx(1440);
  expect(blurPxAt(5, SKY_FOCUS_M, horizon, cap)).toBeCloseTo(-7.7, 1);
  expect(blurPxAt(2, SKY_FOCUS_M, horizon, cap)).toBeCloseTo(-19.3, 1);
  // a hand's breadth away: the widest circle
  expect(blurPxAt(0.3, SKY_FOCUS_M, horizon, cap)).toBe(-cap);
});

test("behind the focus a point blurs towards the horizon's circle", () => {
  expect(blurPxAt(10, 10, 3, 36)).toBe(0);
  expect(blurPxAt(20, 10, 3, 36)).toBeCloseTo(1.5, 6);
  expect(blurPxAt(1e9, 10, 3, 36)).toBeCloseTo(3, 6);
  expect(blurPxAt(1e9, 1, 50, 36)).toBe(36);
});

test("a focus inside the focal length stays finite", () => {
  expect(Number.isFinite(horizonBlurPx(0, 55, 1440))).toBe(true);
});

test("the focus is pulled in dioptres, not snapped", () => {
  // one time constant covers 63 % of the way, in 1/m
  const d = pullFocus(5, 50, FOCUS_PULL_MS);
  const dioptres = 1 / 5 + (1 / 50 - 1 / 5) * (1 - Math.exp(-1));
  expect(1 / d).toBeCloseTo(dioptres, 6);
  expect(pullFocus(5, 50, 0)).toBeCloseTo(5, 6);
  expect(pullFocus(5, 50, FOCUS_PULL_MS * 20)).toBeCloseTo(50, 3);
  // as long out as back in
  expect(1 / pullFocus(50, 5, FOCUS_PULL_MS) - 1 / 50).toBeCloseTo(
    1 / 5 - 1 / d,
    6
  );
});

test("the blur grows in after recovery instead of snapping on", () => {
  const state = createRegressionState();
  stepRegression(state, true, 16);
  expect(lensFade(state)).toBe(0);
  stepRegression(state, false, RECOVER_MS);
  expect(state.regressed).toBe(false);
  expect(lensFade(state)).toBe(0);
  stepRegression(state, false, LENS_FADE_MS / 2);
  expect(lensFade(state)).toBeCloseTo(0.5, 6);
  stepRegression(state, false, LENS_FADE_MS / 2);
  expect(lensFade(state)).toBe(1);
  // moving drops it at once
  stepRegression(state, true, 16);
  expect(lensFade(state)).toBe(0);
});

test("the fade is monotone and eased", () => {
  expect(lensFadeIn(-5)).toBe(0);
  expect(lensFadeIn(LENS_FADE_MS * 0.1)).toBeLessThan(0.1);
  expect(lensFadeIn(LENS_FADE_MS * 2)).toBe(1);
});
