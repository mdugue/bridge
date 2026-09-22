import { expect, test } from "bun:test";
import {
  fitShadowRadius,
  SHADOW_BASE_RADIUS,
  SHADOW_MAX_RADIUS,
  shadowDeadZone,
  shadowFocusAhead,
} from "./shadow-fit";

test("eye level keeps the base radius (walking is unchanged)", () => {
  expect(fitShadowRadius(1.7, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  expect(fitShadowRadius(0, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  // Below the ground (a clamp glitch, or standing in a cellar) must not
  // collapse or NaN the frustum.
  expect(fitShadowRadius(-5, SHADOW_BASE_RADIUS)).toBe(SHADOW_BASE_RADIUS);
  expect(fitShadowRadius(Number.NaN, SHADOW_BASE_RADIUS)).toBe(
    SHADOW_BASE_RADIUS
  );
});

test("the radius grows with altitude, in octaves of the base", () => {
  // The snapshot that reported missing shadows: ~110 m above the Elbe valley.
  expect(fitShadowRadius(110, SHADOW_BASE_RADIUS)).toBe(220);
  expect(fitShadowRadius(220, SHADOW_BASE_RADIUS)).toBe(440);
  expect(fitShadowRadius(500, SHADOW_BASE_RADIUS)).toBe(SHADOW_MAX_RADIUS);
  // Every step is an octave of the base — nothing in between.
  for (const h of [0, 40, 90, 150, 300, 600, 5000]) {
    const r = fitShadowRadius(h, SHADOW_BASE_RADIUS);
    expect(Math.log2(r / SHADOW_BASE_RADIUS) % 1).toBe(0);
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
  expect(shadowFocusAhead(220)).toBe((220 - SHADOW_BASE_RADIUS) / 2);
  // The offset always stays well inside the frustum it belongs to, so the
  // camera itself is never pushed out of the shadowed area.
  for (const r of [110, 220, 440, 880]) {
    expect(shadowFocusAhead(r)).toBeLessThan(r);
  }
});

test("the dead zone scales with the radius and matches the old 20 m", () => {
  expect(shadowDeadZone(SHADOW_BASE_RADIUS)).toBeCloseTo(19.8, 5);
  expect(shadowDeadZone(880)).toBeCloseTo(158.4, 5);
  // A re-centre must leave the camera comfortably inside the frustum even
  // after it has drifted the whole dead zone plus the forward offset.
  for (const r of [110, 220, 440, 880]) {
    expect(shadowDeadZone(r) + shadowFocusAhead(r)).toBeLessThan(r * 0.8);
  }
});
