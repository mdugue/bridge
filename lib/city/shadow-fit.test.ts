import { expect, test } from "bun:test";
import {
  fitShadowRadius,
  SHADOW_BASE_RADIUS,
  SHADOW_MAX_RADIUS,
  shadowDeadZone,
  shadowFocusAhead,
  shadowStreamResolution,
} from "./shadow-fit";
import { COARSE_TERRAIN_ERROR, TILE_ERROR } from "./tileset";

/** 3DTilesRendererJS's error target (px), which the viewer keeps as its
 *  base (the memory governor scales it up, never down). */
const STREAM_ERROR_TARGET = 16;

/**
 * The screen-space error (px) the tile renderer gives a node of
 * `geometricError` (m) under the shadow camera at half-size `radius` (m),
 * streamed at `px`: its pixel is the frustum's width over the resolution —
 * the library's measure for an orthographic camera, whatever the distance.
 */
function shadowStreamError(
  geometricError: number,
  radius: number,
  px: number
): number {
  return geometricError / ((2 * radius) / px);
}

test("eye level keeps the walker's radius", () => {
  expect(fitShadowRadius(1.7, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  expect(fitShadowRadius(0, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  // Below the ground (a clamp glitch, or standing in a cellar) must not
  // collapse or NaN the frustum.
  expect(fitShadowRadius(-5, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  expect(fitShadowRadius(Number.NaN, SHADOW_BASE_RADIUS)).toBe(
    SHADOW_BASE_RADIUS
  );
});

test("the radius grows with altitude, in octaves of 110 m", () => {
  // The snapshot that reported missing shadows: ~110 m above the Elbe valley.
  expect(fitShadowRadius(110, SHADOW_BASE_RADIUS)).toBe(220);
  expect(fitShadowRadius(220, SHADOW_BASE_RADIUS)).toBe(440);
  expect(fitShadowRadius(500, SHADOW_BASE_RADIUS)).toBe(SHADOW_MAX_RADIUS);
  // Above eye level every step is an octave of 110 m, as before the
  // walker's frustum was widened — nothing in between; below, the walker's.
  for (const h of [90, 150, 300, 600, 5000]) {
    const r = fitShadowRadius(h, SHADOW_BASE_RADIUS);
    expect(Math.log2(r / 110) % 1).toBe(0);
  }
  for (const h of [0, 40]) {
    expect(fitShadowRadius(h, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  }
});

test("the radius is capped however high the camera climbs", () => {
  expect(fitShadowRadius(100_000, SHADOW_BASE_RADIUS)).toBe(SHADOW_MAX_RADIUS);
  expect(
    fitShadowRadius(Number.POSITIVE_INFINITY, SHADOW_MAX_RADIUS)
  ).toBeLessThanOrEqual(SHADOW_MAX_RADIUS);
});

test("hysteresis holds the radius steady at an octave boundary", () => {
  // 124 m up wants 311 m — exactly between the 220 and 440 steps. Whichever
  // one is in use must survive a hover there, or the depth pass re-renders on
  // every frame of a drifting hover.
  const boundary = 311 / 2.5;
  expect(fitShadowRadius(boundary, 220)).toBe(220);
  expect(fitShadowRadius(boundary, 440)).toBe(440);
  // Climbing far enough past it still commits.
  expect(fitShadowRadius(200, 220)).toBe(440);
  expect(fitShadowRadius(60, 440)).toBe(SHADOW_BASE_RADIUS);
  // The bottom step, the walker's to 220 m, holds a hover between the two
  // (66 m up wants 165 m) and commits past it either way.
  expect(fitShadowRadius(66, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  expect(fitShadowRadius(66, 220)).toBe(220);
  expect(fitShadowRadius(75, SHADOW_BASE_RADIUS)).toBe(220);
  expect(fitShadowRadius(57, 220)).toBe(SHADOW_BASE_RADIUS);
});

test("descending all the way back returns to the base radius", () => {
  let r = SHADOW_BASE_RADIUS;
  for (const h of [50, 200, 400, 200, 50, 1.7]) {
    r = fitShadowRadius(h, r);
  }
  expect(r).toBe(SHADOW_BASE_RADIUS);
});

test("the frustum is only pushed ahead once it is bigger than the base", () => {
  // Walking: no offset at all, so turning on the spot never moves the frustum.
  expect(shadowFocusAhead(SHADOW_BASE_RADIUS)).toBe(0);
  // In the air, half the radius above 110 m, as before the walker's
  // frustum was widened.
  expect(shadowFocusAhead(220)).toBe(55);
  // The offset always stays well inside the frustum it belongs to, so the
  // camera itself is never pushed out of the shadowed area.
  for (const r of [SHADOW_BASE_RADIUS, 220, 440, 880]) {
    expect(shadowFocusAhead(r)).toBeLessThan(r);
  }
});

test("the dead zone is 30 m on foot, 18 % of the half-size above it", () => {
  expect(shadowDeadZone(SHADOW_BASE_RADIUS)).toBe(30);
  // in the air, and at Modell's smallest step, as it was
  expect(shadowDeadZone(110)).toBeCloseTo(19.8, 5);
  expect(shadowDeadZone(880)).toBeCloseTo(158.4, 5);
  // On foot the camera stays as far from every edge as it did with the
  // 110 m half-size and its 19.8 m dead zone, or farther.
  expect(
    SHADOW_BASE_RADIUS - shadowDeadZone(SHADOW_BASE_RADIUS)
  ).toBeGreaterThanOrEqual(110 - 19.8);
  // A re-centre must leave the camera comfortably inside the frustum even
  // after it has drifted the whole dead zone plus the forward offset.
  for (const r of [SHADOW_BASE_RADIUS, 220, 440, 880]) {
    expect(shadowDeadZone(r) + shadowFocusAhead(r)).toBeLessThan(r * 0.8);
  }
});

test("a phone's shadow camera never refines terrain, at any radius it takes", () => {
  // dormant while a phone's shadow camera streams nothing
  // (gpu-safety.ts `shadowTilesStream`): the bound for the day it does
  const { width, height } = shadowStreamResolution("mobile");
  expect(width).toBe(height);
  // every radius the fit can hand out, and everything in between
  for (let r = SHADOW_BASE_RADIUS; r <= SHADOW_MAX_RADIUS; r += 5) {
    // under the base error target, so it holds at every target the memory
    // governor raises it to
    expect(shadowStreamError(COARSE_TERRAIN_ERROR, r, width)).toBeLessThan(
      STREAM_ERROR_TARGET
    );
  }
  // the map's own resolution did refine it, across the whole eye-level frustum
  expect(
    shadowStreamError(COARSE_TERRAIN_ERROR, SHADOW_BASE_RADIUS, 2048)
  ).toBeGreaterThan(STREAM_ERROR_TARGET);
});

test("a desktop's shadow camera refines terrain at eye level, never from the air", () => {
  const { width } = shadowStreamResolution("desktop");
  // the eye-level frustum: the fine level under it, as before
  expect(
    shadowStreamError(COARSE_TERRAIN_ERROR, SHADOW_BASE_RADIUS, width)
  ).toBeGreaterThan(STREAM_ERROR_TARGET);
  // every wider frustum (from the air, 220 m on): coarse, whatever it covers
  for (let r = 220; r <= SHADOW_MAX_RADIUS; r += 5) {
    expect(shadowStreamError(COARSE_TERRAIN_ERROR, r, width)).toBeLessThan(
      STREAM_ERROR_TARGET
    );
  }
});

test("the shadow camera still loads the buildings that cast into the view", () => {
  for (const tier of ["desktop", "mobile"] as const) {
    const { width } = shadowStreamResolution(tier);
    // a tile's node refines to its buildings (and the coarse ground under
    // them) even at the widest frustum and a target many times the base
    expect(
      shadowStreamError(TILE_ERROR, SHADOW_MAX_RADIUS, width)
    ).toBeGreaterThan(STREAM_ERROR_TARGET * 64);
  }
});
