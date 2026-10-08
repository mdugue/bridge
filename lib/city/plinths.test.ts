import { expect, test } from "bun:test";
import type { PlinthFeature } from "./features";
import {
  CORNICE,
  corniceMesh,
  PLINTH,
  PLINTH_SINK,
  plinthMesh,
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

test("a plinth stands proud on the street side, its top bevelled to it", () => {
  const tris = triangles(plinthMesh(plinth, { cx: 0, cy: 0 }));
  // front, top and two ends, two triangles each
  expect(tris).toHaveLength(8);
  const [front, , top] = tris;
  expect(front.n[0]).toBeCloseTo(1, 6);
  // the top faces up, and a little to the street
  expect(top.n[2]).toBeGreaterThan(0.9);
  expect(top.n[0]).toBeGreaterThan(0);
  expectEndsOutward(tris);
  const xs = plinthMesh(plinth, { cx: 0, cy: 0 }).filter((_, i) => i % 3 === 0);
  expect(Math.max(...xs)).toBeCloseTo(100 + PLINTH.proud, 6);
  const zs = tris.flatMap((t) => t.z);
  expect(Math.min(...zs)).toBeCloseTo(10 - PLINTH_SINK, 6);
  expect(Math.max(...zs)).toBeCloseTo(10.7, 6);
});

/** The ends (faces along the wall, a→b = +y from 0 to 10) face out. */
function expectEndsOutward(tris: { n: number[]; y: number[] }[]): void {
  const ends = tris.filter((t) => Math.abs(t.n[1]) > 0.99);
  expect(ends).toHaveLength(4);
  for (const t of ends) {
    expect(Math.sign(t.n[1])).toBe(t.y[0] > 5 ? 1 : -1);
  }
}

test("the Gurtgesims is level, flat underneath and weathered on top", () => {
  const tris = triangles(corniceMesh(plinth, { cx: 0, cy: 0 }, 14));
  // underside, front, top and two ends
  expect(tris).toHaveLength(10);
  const [under, , front, , top] = tris;
  expect(under.n[2]).toBeCloseTo(-1, 6);
  expect(front.n[0]).toBeCloseTo(1, 6);
  expect(top.n[2]).toBeGreaterThan(0.8);
  expect(top.n[0]).toBeGreaterThan(0);
  expectEndsOutward(tris);
  const zs = tris.flatMap((t) => t.z);
  expect(Math.min(...zs)).toBe(14);
  expect(Math.max(...zs)).toBeCloseTo(14 + CORNICE.height + CORNICE.bevel, 6);
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
  expect(plinthMesh(flat, { cx: 0, cy: 0 })).toHaveLength(0);
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
  expect(plinthMesh(dot, { cx: 0, cy: 0 })).toHaveLength(0);
});
