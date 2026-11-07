import { expect, test } from "bun:test";
import {
  blurPxAt,
  focalLengthMm,
  horizonBlurPx,
  LENS_FADE_MS,
  lensFadeIn,
  MAX_BLUR_PX,
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

test("a far focus leaves the city all but sharp, a near one blurs it", () => {
  // a 1440 px tall frame at the default view angle
  expect(horizonBlurPx(20, 55, 1440)).toBeCloseTo(0.89, 1);
  expect(horizonBlurPx(3, 55, 1440)).toBeCloseTo(5.95, 1);
  expect(horizonBlurPx(1, 55, 1440)).toBeGreaterThan(MAX_BLUR_PX);
  // twice the pixels, twice the pixels of blur: the same angle on screen
  expect(horizonBlurPx(5, 55, 2880)).toBeCloseTo(
    2 * horizonBlurPx(5, 55, 1440),
    6
  );
});

test("a focus inside the focal length stays finite", () => {
  expect(Number.isFinite(horizonBlurPx(0, 55, 1440))).toBe(true);
});

test("only what lies beyond the focus blurs, up to the widest circle", () => {
  expect(blurPxAt(5, 10, 3)).toBe(0);
  expect(blurPxAt(10, 10, 3)).toBe(0);
  expect(blurPxAt(20, 10, 3)).toBeCloseTo(1.5, 6);
  expect(blurPxAt(1e9, 10, 3)).toBeCloseTo(3, 6);
  expect(blurPxAt(1e9, 1, 50)).toBe(MAX_BLUR_PX);
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
