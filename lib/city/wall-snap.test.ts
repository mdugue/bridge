import { expect, test } from "bun:test";
import { type StepSnap, smoothSnaps, snapToStep } from "./wall-snap";

/** Ground rising from `lo` to `hi` along +x between x0 and x1 (a ramp). */
function ramp(x0: number, x1: number, lo = 100, hi = 108) {
  return (x: number): number => {
    if (x <= x0) {
      return lo;
    }
    if (x >= x1) {
      return hi;
    }
    return lo + ((x - x0) / (x1 - x0)) * (hi - lo);
  };
}

test("snaps to a ramp that sits off the OSM line", () => {
  // The line runs north–south through x = 0 (perp = +x); the measured ramp
  // is 0.7 m east of it and 1 m wide.
  const z = ramp(0.2, 1.2);
  const s = snapToStep((x) => z(x), 0, 0, 1, 0);
  expect(s).not.toBeNull();
  const snap = s as StepSnap;
  expect(snap.up).toBe(1);
  expect(snap.hi).toBeCloseTo(108, 5);
  expect(snap.lo).toBeCloseTo(100, 5);
  expect(Math.abs(snap.foot - 0.2)).toBeLessThanOrEqual(0.25);
  expect(Math.abs(snap.crest - 1.2)).toBeLessThanOrEqual(0.25);
});

test("the high side may lie on either side of the line", () => {
  const z = ramp(-3, -2, 108, 100); // high to the west (−perp)
  const snap = snapToStep((x) => z(x), 0, 0, 1, 0) as StepSnap;
  expect(snap.up).toBe(-1);
  expect(snap.hi).toBeCloseTo(108, 5);
  expect(snap.foot).toBeGreaterThan(snap.crest);
});

test("no step, a kerb, or ground off the terrain yields no snap", () => {
  expect(snapToStep(() => 100, 0, 0, 1, 0)).toBeNull();
  const kerb = ramp(0, 0.5, 100, 101);
  expect(snapToStep((x) => kerb(x), 0, 0, 1, 0)).toBeNull();
  const edge = ramp(0.2, 1.2);
  expect(snapToStep((x) => (x > 5 ? null : edge(x)), 0, 0, 1, 0)).toBeNull();
});

const snap = (foot: number, up = 1): StepSnap => ({
  up,
  foot,
  crest: foot + up * 1.5,
  hi: 108,
  lo: 100,
});

test("smoothing fills a gap and ignores a stray scan", () => {
  const raw = [
    snap(0.5),
    snap(0.5),
    snap(0.6),
    null,
    snap(4, -1),
    snap(0.4),
    snap(0.5),
  ];
  const out = smoothSnaps(raw);
  for (const s of out) {
    expect(s).not.toBeNull();
    expect((s as StepSnap).up).toBe(1);
    // the face goes in front of most of the ramp, never out to the stray
    expect((s as StepSnap).foot).toBeGreaterThanOrEqual(0.4);
    expect((s as StepSnap).foot).toBeLessThanOrEqual(0.6);
  }
});

test("an isolated snap among failures is dropped", () => {
  const out = smoothSnaps([null, null, null, snap(0.5), null, null, null]);
  expect(out.every((s) => s === null)).toBe(true);
});
