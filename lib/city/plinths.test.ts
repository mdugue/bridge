import { expect, test } from "bun:test";
import type { PlinthFeature } from "./features";
import { PLINTH, PLINTH_SINK, plinthMesh } from "./plinths";

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
  const out: { n: number[]; z: number[] }[] = [];
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
    out.push({ n: n.map((c) => c / l), z: [az, bz, cz] });
  }
  return out;
};

test("a plinth stands proud on the street side, its top bevelled to it", () => {
  const tris = triangles(plinthMesh(plinth, { cx: 0, cy: 0 }));
  // front, top and two ends, two triangles each
  expect(tris).toHaveLength(8);
  const [front, , top, , end] = tris;
  expect(front.n[0]).toBeCloseTo(1, 6);
  // the top faces up, and a little to the street
  expect(top.n[2]).toBeGreaterThan(0.9);
  expect(top.n[0]).toBeGreaterThan(0);
  // the far end faces along the wall
  expect(end.n[1]).toBeCloseTo(1, 6);
  const xs = plinthMesh(plinth, { cx: 0, cy: 0 }).filter((_, i) => i % 3 === 0);
  expect(Math.max(...xs)).toBeCloseTo(100 + PLINTH.proud, 6);
  const zs = tris.flatMap((t) => t.z);
  expect(Math.min(...zs)).toBeCloseTo(10 - PLINTH_SINK, 6);
  expect(Math.max(...zs)).toBeCloseTo(10.7, 6);
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
