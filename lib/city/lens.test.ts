import { expect, test } from "bun:test";
import {
  FOCUS_SNAP_MS,
  createLensState,
  FOCUS_PULL_MS,
  focalLengthMm,
  horizonBlurPx,
  LENS_FADE_MS,
  lensFadeIn,
  lensSettled,
  maxBlurPx,
  pullFocus,
  stepLens,
} from "./lens";

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

test("the widest blur is a fortieth of the frame's height", () => {
  expect(maxBlurPx(1440)).toBeCloseTo(36, 6);
  expect(maxBlurPx(-1)).toBe(0);
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

test("the fade is monotone and eased", () => {
  expect(lensFadeIn(-5)).toBe(0);
  expect(lensFadeIn(LENS_FADE_MS * 0.1)).toBeLessThan(0.1);
  expect(lensFadeIn(LENS_FADE_MS / 2)).toBeCloseTo(0.5, 6);
  expect(lensFadeIn(LENS_FADE_MS * 2)).toBe(1);
});

test("the lens grows in while drawn, starts over when not, and focuses at once while unseen", () => {
  const lens = createLensState();
  // not drawn (moving, or a style without it): nothing shows, the focus
  // is where it is aimed
  expect(stepLens(lens, false, 8, 16)).toBe(0);
  expect(lens.focusM).toBe(8);
  expect(lensSettled(lens, true, 8)).toBe(false);
  expect(lensSettled(lens, false, 8)).toBe(true);
  // drawn: half the fade later half of it shows, the focus pulled
  expect(stepLens(lens, true, 8, LENS_FADE_MS / 2)).toBeCloseTo(0.5, 6);
  stepLens(lens, true, 80, FOCUS_PULL_MS);
  expect(lens.focusM).toBeGreaterThan(8);
  expect(lens.focusM).toBeLessThan(80);
  expect(lensSettled(lens, true, 80)).toBe(false);
  stepLens(lens, true, 80, FOCUS_PULL_MS * 20);
  expect(lensSettled(lens, true, 80)).toBe(true);
  // a move drops it; it comes back from none
  expect(stepLens(lens, false, 80, 16)).toBe(0);
  expect(stepLens(lens, true, 80, 16)).toBeLessThan(0.01);
  // just back, the first aim the ray finds is taken at once; later pulled
  stepLens(lens, true, 5, 16);
  expect(lens.focusM).toBe(5);
  stepLens(lens, true, 5, FOCUS_SNAP_MS);
  stepLens(lens, true, 50, 16);
  expect(lens.focusM).toBeLessThan(50);
});
