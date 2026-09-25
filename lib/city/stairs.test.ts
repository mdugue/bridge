import { expect, test } from "bun:test";
import {
  axisMiddle,
  burnStairs,
  projectOntoAxis,
  raiseTerraces,
  STAIR_BURN_M,
  STAIR_RISER,
  STAIR_TREAD,
  type StairLine,
  stairGeometry,
  stairLineOf,
} from "./stairs";
import { sampleHeightfield } from "./terrain-geometry";

// A 100 m tile at 2 m/cell whose DGM is the smoothed bank a flight of steps
// becomes: 100 m south of y = 40, 104 m north of y = 60, a ramp between —
// bulging 0.3 m above the straight line, as the raster rounds the steps.
const N = 50;
const BOUNDS: [number, number, number, number] = [0, 0, 100, 100];
const DX = 100 / N;

function bank(y: number): number {
  if (y <= 40) {
    return 100;
  }
  if (y >= 60) {
    return 104;
  }
  const t = (y - 40) / 20;
  return 100 + 4 * t + 0.3 * Math.sin(Math.PI * t);
}

function grid(): Float32Array {
  const el = new Float32Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      el[row * N + col] = bank(100 - (row + 0.5) * DX);
    }
  }
  return el;
}

const at = (el: Float32Array, x: number, y: number) =>
  el[Math.floor((100 - y) / DX) * N + Math.floor(x / DX)];

const FLIGHT: StairLine = {
  coords: [
    [50, 40],
    [50, 60],
  ],
  n: 25,
  w: 4,
  z: [100, 104],
};

test("the burn puts the ground under a flight below its ramp", () => {
  const el = grid();
  const out = burnStairs({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    stairs: [FLIGHT],
  });
  for (let y = 41; y < 60; y += 2) {
    const ramp = 100 + ((y - 40) / 20) * 4;
    expect(at(out, 51, y)).toBeLessThanOrEqual(ramp - STAIR_BURN_M + 1e-3);
  }
  expect(el[0]).toBe(grid()[0]); // the input is not mutated
});

test("over a bank the burn only lowers, and leaves the ground alone away from the flight", () => {
  const el = grid();
  const out = burnStairs({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    stairs: [FLIGHT],
  });
  for (let i = 0; i < el.length; i++) {
    expect(out[i]).toBeLessThanOrEqual(el[i]);
  }
  expect(at(out, 20, 50)).toBe(at(el, 20, 50)); // 30 m to the side
  expect(at(out, 51, 70)).toBe(at(el, 51, 70)); // beyond the top
  expect(at(out, 51, 30)).toBe(at(el, 51, 30)); // below the bottom
});

test("no terrain triangle under a flight keeps a vertex above its tread", () => {
  // A terrace 3 m above the ramp right beside the flight, no wall between.
  const el = grid();
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      if ((col + 0.5) * DX > 53) {
        el[row * N + col] += 3;
      }
    }
  }
  const out = burnStairs({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    stairs: [FLIGHT],
  });
  // The ground, as the mesh interpolates it, stays under every tread of
  // the 4 m flight (x 48–52), right to its edges.
  for (let y = 40.5; y < 60; y += 0.25) {
    const tread = 100 + (Math.floor(((y - 40) / 20) * 25) + 1) * 0.16;
    for (const x of [48, 49, 51, 52]) {
      const ground = sampleHeightfield(
        { elevations: out, n: N, bounds: BOUNDS },
        x,
        y
      );
      expect(ground ?? Number.NaN).toBeLessThan(tread);
    }
  }
});

test("a flight the DGM runs flat under lifts the walkable ground with it", () => {
  // The Freitreppe case: flat ground, a flight climbing 6 m onto a terrace.
  const flat = new Float32Array(N * N).fill(100);
  const lifted: StairLine = { ...FLIGHT, n: 40, z: [100, 106] };
  const out = burnStairs({
    elevations: flat,
    n: N,
    bounds: BOUNDS,
    stairs: [lifted],
  });
  for (let y = 41; y < 60; y += 2) {
    const ramp = 100 + ((y - 40) / 20) * 6;
    const ground = sampleHeightfield(
      { elevations: out, n: N, bounds: BOUNDS },
      50,
      y
    );
    expect(ground ?? Number.NaN).toBeGreaterThan(ramp - 1);
    expect(ground ?? Number.NaN).toBeLessThanOrEqual(ramp);
  }
  expect(at(out, 60, 50)).toBe(100); // beside the flight: untouched
});

test("the burn never reaches across a wall", () => {
  const el = grid();
  const wall: [number, number][] = [
    [52.5, 30],
    [52.5, 70],
  ];
  const out = burnStairs({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    stairs: [FLIGHT],
    walls: [wall],
  });
  expect(at(out, 53.5, 50)).toBe(at(el, 53.5, 50)); // beyond the wall
  expect(at(out, 46.5, 50)).toBeLessThan(at(el, 46.5, 50)); // no wall there
});

test("a terrace lifts the ground inside it and nowhere else", () => {
  const el = grid();
  const square: [number, number][] = [
    [10, 10],
    [30, 10],
    [30, 30],
    [10, 30],
    [10, 10],
  ];
  const out = raiseTerraces({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    terraces: [{ polygons: [[square]], z: 108 }],
  });
  expect(at(out, 20, 20)).toBe(108);
  expect(at(out, 40, 20)).toBe(at(el, 40, 20));
  const low = raiseTerraces({
    elevations: el,
    n: N,
    bounds: BOUNDS,
    terraces: [{ polygons: [[square]], z: 90 }],
  });
  expect(at(low, 20, 20)).toBe(at(el, 20, 20)); // never lowers
});

test("a point projects onto the axis only between its ends", () => {
  expect(projectOntoAxis(FLIGHT.coords, 52, 45)).toEqual({ d: 2, s: 5 });
  expect(projectOntoAxis(FLIGHT.coords, 50, 39)).toBeNull();
  expect(projectOntoAxis(FLIGHT.coords, 50, 61)).toBeNull();
  expect(axisMiddle(FLIGHT.coords)).toEqual([50, 50]);
});

test("the flight's treads climb one riser per step to the top landing", () => {
  const geo = stairGeometry(FLIGHT, { cx: 0, cy: 0 });
  expect(geo).not.toBeNull();
  const g = geo as NonNullable<typeof geo>;
  const treadY = new Set<number>();
  for (let v = 0; v < g.kinds.length; v++) {
    if (g.kinds[v] === STAIR_TREAD) {
      treadY.add(Math.round(g.positions[v * 3 + 1] * 1000) / 1000);
      expect(g.normals[v * 3 + 1]).toBe(1); // up
    }
  }
  expect(treadY.size).toBe(25);
  expect(Math.min(...treadY)).toBeCloseTo(100.16, 5);
  expect(Math.max(...treadY)).toBeCloseTo(104, 5);
  // Risers face down the flight: the climb runs north (data +y), which is
  // world −z, so they face world +z.
  const riser = g.kinds.indexOf(STAIR_RISER);
  expect(g.normals[riser * 3 + 2]).toBeCloseTo(1, 5);
  expect(g.positions.length % 9).toBe(0);
});

test("every triangle is wound to face its normal", () => {
  const bent: StairLine = {
    ...FLIGHT,
    coords: [
      [50, 40],
      [50, 50],
      [60, 58],
    ],
  };
  const g = stairGeometry(bent, { cx: 10, cy: 20 });
  const p = g?.positions ?? [];
  const nrm = g?.normals ?? [];
  expect(p.length).toBeGreaterThan(0);
  for (let t = 0; t < p.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.slice(t, t + 9);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const face = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const dot = face[0] * nrm[t] + face[1] * nrm[t + 1] + face[2] * nrm[t + 2];
    expect(dot).toBeGreaterThan(0);
  }
});

test("a malformed feature is not a flight", () => {
  const line = { type: "LineString" as const, coordinates: FLIGHT.coords };
  expect(stairLineOf({ geometry: line, properties: null })).toBeNull();
  expect(
    stairLineOf({ geometry: line, properties: { n: 3, w: 0, z: [1, 2] } })
  ).toBeNull();
  expect(
    stairLineOf({ geometry: line, properties: { n: 25, w: 4, z: [100, 104] } })
  ).toEqual(FLIGHT);
});
