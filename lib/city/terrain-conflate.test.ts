import { expect, test } from "bun:test";
import { conflateWalls, type WallLine } from "./terrain-conflate";

// A 100 m × 100 m tile at 2 m/cell whose DGM is a *smoothed bank*: flat-low
// (100 m) west of x=40, flat-high (106 m) east of x=60, a gentle ramp between —
// exactly the way the raster blurs a real vertical wall. Row 0 = north (maxY).
const N = 50;
const BOUNDS: [number, number, number, number] = [0, 0, 100, 100];
const DX = 100 / N;

function ramp(x: number): number {
  if (x <= 40) {
    return 100;
  }
  if (x >= 60) {
    return 106;
  }
  return 100 + ((x - 40) / 20) * 6;
}

function makeGrid(): Float32Array {
  const el = new Float32Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const x = (col + 0.5) * DX;
      el[row * N + col] = ramp(x);
    }
  }
  return el;
}

/** Nearest-cell elevation at a world (x, y). */
function at(el: ArrayLike<number>, x: number, y: number): number {
  const col = Math.round((x - 0.5 * DX) / DX);
  const row = Math.round((100 - y) / DX - 0.5);
  return el[row * N + col];
}

// A N–S retaining wall along x=50, spanning y=10..90.
const wall = (kind: string): WallLine => ({
  kind,
  coords: [
    [50, 10],
    [50, 90],
  ],
});

test("burns a sharp step at a retaining wall (sides snap to the shelves)", () => {
  const el = makeGrid();
  const out = conflateWalls({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    walls: [wall("retaining_wall")],
  });
  // East of the wall snaps up toward the high shelf (~106), west down to ~100.
  const east = at(out, 53, 50);
  const west = at(out, 47, 50);
  expect(east).toBeGreaterThan(105);
  expect(west).toBeLessThan(101);
  // The step is far sharper than the original smoothed bank across the same span.
  const origStep = at(el, 53, 50) - at(el, 47, 50);
  const newStep = east - west;
  expect(newStep).toBeGreaterThan(origStep + 3);
  expect(newStep).toBeLessThanOrEqual(6.0001);
});

test("leaves terrain beyond the band untouched", () => {
  const el = makeGrid();
  const out = conflateWalls({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    walls: [wall("retaining_wall")],
  });
  // Past the wall's north end (y=95 > span 90) → no stamp.
  expect(at(out, 53, 95)).toBeCloseTo(at(el, 53, 95), 5);
});

test("ignores non-retaining kinds (freestanding walls leave ground alone)", () => {
  const el = makeGrid();
  const out = conflateWalls({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    walls: [wall("wall")],
  });
  for (let i = 0; i < el.length; i++) {
    expect(out[i]).toBe(el[i]);
  }
});

test("skips walls with no real height difference between the two sides", () => {
  const flat = new Float32Array(N * N).fill(103);
  const out = conflateWalls({
    elevations: flat,
    n: N,
    bounds: BOUNDS,
    walls: [wall("retaining_wall")],
  });
  for (let i = 0; i < flat.length; i++) {
    expect(out[i]).toBe(103);
  }
});

test("never lifts NoData cells", () => {
  const el = makeGrid();
  // Punch a NoData hole right next to the wall, on the high side.
  const holeCol = Math.round((52 - 0.5 * DX) / DX);
  const holeRow = Math.round((100 - 50) / DX - 0.5);
  el[holeRow * N + holeCol] = Number.NaN;
  const out = conflateWalls({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    walls: [wall("retaining_wall")],
  });
  expect(out[holeRow * N + holeCol]).toBeNaN();
});
