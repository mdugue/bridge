import { describe, expect, test } from "bun:test";
import {
  clampPitch,
  DEG2RAD,
  directionOf,
  headingDelta,
  headingPitchOf,
  MAX_FOV,
  MIN_FOV,
  nextFov,
  PITCH_LIMIT,
  RAD2DEG,
} from "./pose";

test("heading 0 looks north (-Z), 90° looks east (+X), pitch tilts up (+Y)", () => {
  const north = directionOf(0, 0);
  expect(north.x).toBeCloseTo(0, 10);
  expect(north.z).toBeCloseTo(-1, 10);
  const east = directionOf(90 * DEG2RAD, 0);
  expect(east.x).toBeCloseTo(1, 10);
  expect(east.z).toBeCloseTo(0, 10);
  const up = directionOf(0, 30 * DEG2RAD);
  expect(up.y).toBeCloseTo(0.5, 10);
  expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1, 10);
});

test("headingPitchOf inverts directionOf", () => {
  for (const [headingDeg, pitchDeg] of [
    [0, 0],
    [45, -20],
    [200, 10],
    [-90, 60],
  ]) {
    const back = headingPitchOf(
      directionOf(headingDeg * DEG2RAD, pitchDeg * DEG2RAD)
    );
    const wrapped = ((headingDeg + 540) % 360) - 180;
    expect(back.heading * RAD2DEG).toBeCloseTo(wrapped, 8);
    expect(back.pitch * RAD2DEG).toBeCloseTo(pitchDeg, 8);
  }
});

test("headingPitchOf normalises the direction before reading the pitch", () => {
  // Twice the unit vector: asin(2 * 0.5) would be asin(1) without the length.
  const scaled = headingPitchOf({ x: 0, y: 1, z: -Math.sqrt(3) });
  expect(scaled.pitch * RAD2DEG).toBeCloseTo(30, 8);
  // A zero vector yields finite angles, not NaN.
  const zero = headingPitchOf({ x: 0, y: 0, z: 0 });
  expect(Number.isFinite(zero.heading)).toBe(true);
  expect(zero.pitch).toBe(0);
});

test("clampPitch limits to ±PITCH_LIMIT", () => {
  expect(clampPitch(0.5)).toBe(0.5);
  expect(clampPitch(3)).toBe(PITCH_LIMIT);
  expect(clampPitch(-3)).toBe(-PITCH_LIMIT);
});

test("nextFov: spreading fingers zooms in, pinching zooms out, clamped", () => {
  expect(nextFov(70, 2)).toBe(35);
  expect(nextFov(70, 0.5)).toBe(MAX_FOV);
  expect(nextFov(70, 10)).toBe(MIN_FOV);
  expect(nextFov(70, 1)).toBe(70);
});

test("nextFov ignores degenerate ratios", () => {
  expect(nextFov(70, 0)).toBe(70);
  expect(nextFov(70, Number.NaN)).toBe(70);
});

describe("headingDelta", () => {
  test("is the unsigned angle between two headings", () => {
    expect(headingDelta(0, 0)).toBe(0);
    expect(headingDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(headingDelta(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2);
  });

  test("takes the short way round the circle", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    // 359° -> 1° is a 2° turn, not 358°.
    expect(headingDelta(deg(359), deg(1))).toBeCloseTo(deg(2));
    expect(headingDelta(deg(1), deg(359))).toBeCloseTo(deg(2));
    // Half a turn is the maximum it can ever report.
    expect(headingDelta(0, deg(180))).toBeCloseTo(Math.PI);
    expect(headingDelta(0, deg(181))).toBeCloseTo(deg(179));
  });

  test("ignores whole extra turns", () => {
    expect(headingDelta(0, Math.PI * 4)).toBeCloseTo(0);
    expect(headingDelta(-Math.PI / 2, Math.PI * 2)).toBeCloseTo(Math.PI / 2);
  });
});
