import { expect, test } from "bun:test";
import type { PlinthFeature } from "./features";
import {
  CORNICE,
  corniceMesh,
  PLINTH,
  PLINTH_SINK,
  plinthMesh,
  plinthPieces,
  straightRuns,
} from "./plinths";

// a wall along +y at x = 100, the street to its right (+x)
const plinth: PlinthFeature = {
  geometry: {
    type: "MultiLineString",
    coordinates: [
      [
        [100, 0],
        [100, 10],
      ],
    ],
  },
  properties: { of: "a", g: [10], top: [10.7] },
};

const triangles = (tris: number[]) => {
  const out: { n: number[]; y: number[]; z: number[] }[] = [];
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(i, i + 9);
    const u = [bx - ax, by - ay, bz - az];
    const v = [cx - ax, cy - ay, cz - az];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const l = Math.hypot(...n);
    out.push({ n: n.map((c) => c / l), y: [ay, by, cy], z: [az, bz, cz] });
  }
  return out;
};

test("a plinth stands proud on the street side, rolling over into its top", () => {
  const mesh = plinthMesh(plinth, { cx: 0, cy: 0 });
  const tris = triangles(mesh.positions);
  // front, three shoulder facets, top, two ends of five triangles each
  expect(tris).toHaveLength(2 * 5 + 2 * 5);
  const [front] = tris;
  expect(front.n[0]).toBeCloseTo(1, 6);
  expectEndsOutward(tris);
  const xs = mesh.positions.filter((_, i) => i % 3 === 0);
  expect(Math.max(...xs)).toBeCloseTo(100 + PLINTH.proud, 6);
  const zs = tris.flatMap((t) => t.z);
  expect(Math.min(...zs)).toBeCloseTo(10 - PLINTH_SINK, 6);
  expect(Math.max(...zs)).toBeCloseTo(10.7, 6);
  // the shoulder shades smooth: its normals turn from out to up, no NaN
  const shoulder = mesh.normals.slice(2 * 9, 5 * 9);
  expect(shoulder.every(Number.isFinite)).toBe(true);
  // the ends are flat
  expect(mesh.normals.slice(-9).every(Number.isNaN)).toBe(true);
});

/** The ends (faces along the wall, a→b = +y from 0 to 10) face out. */
function expectEndsOutward(tris: { n: number[]; y: number[] }[]): void {
  const ends = tris.filter((t) => Math.abs(t.n[1]) > 0.99);
  expect(ends.length).toBeGreaterThan(0);
  for (const t of ends) {
    expect(Math.sign(t.n[1])).toBe(t.y[0] > 5 ? 1 : -1);
  }
}

// an outer corner: the wall along +y turns left onto -x at (100, 10)
const corner: PlinthFeature = {
  geometry: {
    type: "MultiLineString",
    coordinates: [
      [
        [100, 0],
        [100, 10],
      ],
      [
        [100, 10],
        [90, 10],
      ],
    ],
  },
  properties: { of: "a", g: [10, 10.2], top: [10.7, 11] },
};

test("two pieces round a corner are mitred and share one top", () => {
  const pieces = plinthPieces(corner);
  expect(pieces.map((q) => q.top)).toEqual([11, 11]);
  expect(pieces.map((q) => q.foot)).toEqual([
    10 - PLINTH_SINK,
    10 - PLINTH_SINK,
  ]);
  const mesh = plinthMesh(corner, { cx: 0, cy: 0 });
  const tris = triangles(mesh.positions);
  // no cap at the corner: one at each far end only
  expect(tris).toHaveLength(2 * (2 * 5) + 2 * 5);
  // the front's corner stands on the bisector, proud of both walls
  const near = (x: number, y: number) =>
    tris.some((t, i) =>
      [0, 1, 2].some(
        (k) =>
          Math.abs(mesh.positions[i * 9 + k * 3] - x) < 1e-6 &&
          Math.abs(mesh.positions[i * 9 + k * 3 + 1] - y) < 1e-6
      )
    );
  expect(near(100 + PLINTH.proud, 10 + PLINTH.proud)).toBe(true);
});

test("pieces in line are no corner: each keeps its height and its caps", () => {
  const step: PlinthFeature = {
    ...corner,
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [100, 0],
          [100, 5],
        ],
        [
          [100, 5],
          [100, 10],
        ],
      ],
    },
  };
  expect(plinthPieces(step).map((q) => q.top)).toEqual([10.7, 11]);
  expect(triangles(plinthMesh(step, { cx: 0, cy: 0 }).positions)).toHaveLength(
    2 * (2 * 5 + 2 * 5)
  );
});

test("the Gurtgesims is level, flat underneath and round at the nose", () => {
  const mesh = corniceMesh(plinth, { cx: 0, cy: 0 }, 14);
  const tris = triangles(mesh.positions);
  // underside, four nose facets, wash and two ends of five triangles each
  expect(tris).toHaveLength(2 * 6 + 2 * 5);
  const [under] = tris;
  expect(under.n[2]).toBeCloseTo(-1, 6);
  expectEndsOutward(tris);
  const zs = tris.flatMap((t) => t.z);
  expect(Math.min(...zs)).toBe(14);
  expect(Math.max(...zs)).toBeCloseTo(14 + CORNICE.height + CORNICE.wash, 6);
  const xs = mesh.positions.filter((_, i) => i % 3 === 0);
  expect(Math.max(...xs)).toBeCloseTo(100 + CORNICE.proud, 6);
});

test("the Gurtgesims round a corner is mitred too", () => {
  const tris = triangles(corniceMesh(corner, { cx: 0, cy: 0 }, 14).positions);
  expect(tris).toHaveLength(2 * (2 * 6) + 2 * 5);
});

test("a wall standing off the footprint line carries the band out with it", () => {
  const xs = (m: { positions: number[] }) =>
    Math.max(...m.positions.filter((_, i) => i % 3 === 0));
  const shifted = plinthMesh(plinth, { cx: 0, cy: 0 }, () => 0.12);
  expect(xs(shifted)).toBeCloseTo(100 + PLINTH.proud + 0.12, 6);
  const cornice = corniceMesh(plinth, { cx: 0, cy: 0 }, 14, () => -0.05);
  expect(xs(cornice)).toBeCloseTo(100 + CORNICE.proud - 0.05, 6);
});

test("the pieces round a corner take the outermost wall", () => {
  const shift = (a: readonly number[]) =>
    a[0] === 100 && a[1] === 0 ? 0.1 : 0;
  expect(plinthPieces(corner, shift).map((q) => q.s)).toEqual([0.1, 0.1]);
});

test("pieces in line join into one run; a turn starts the next", () => {
  const runs = straightRuns([
    [
      [0, 0],
      [0, 4],
    ],
    [
      [0, 4],
      [0, 10],
    ],
    [
      [0, 10],
      [5, 10],
    ],
  ]);
  expect(runs).toEqual([
    [
      [0, 0],
      [0, 10],
    ],
    [
      [0, 10],
      [5, 10],
    ],
  ]);
});

test("a piece with no height or no length draws nothing", () => {
  const flat = { ...plinth, properties: { of: "a", g: [10], top: [9] } };
  expect(plinthMesh(flat, { cx: 0, cy: 0 }).positions).toHaveLength(0);
  const dot: PlinthFeature = {
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [1, 1],
          [1, 1],
        ],
      ],
    },
    properties: { of: "a", g: [0], top: [1] },
  };
  expect(plinthMesh(dot, { cx: 0, cy: 0 }).positions).toHaveLength(0);
});
