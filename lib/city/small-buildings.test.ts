import { expect, test } from "bun:test";
import type { SmallBuildingFeature } from "./features";
import {
  SMALL_BUILDING_SINK,
  structureCorners,
  structureMesh,
  treesOffStructures,
} from "./small-buildings";

/** A 4 × 3 m shed at (100, 200), the ring as written (clockwise here). */
function shed(props: SmallBuildingFeature["properties"]): SmallBuildingFeature {
  return {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [100, 200],
          [100, 203],
          [104, 203],
          [104, 200],
          [100, 200],
        ],
      ],
    },
    properties: props,
  };
}

type V3 = [number, number, number];

function triangles(positions: number[]): V3[][] {
  const out: V3[][] = [];
  for (let i = 0; i < positions.length; i += 9) {
    out.push(
      [0, 3, 6].map((k): V3 => [
        positions[i + k],
        positions[i + k + 1],
        positions[i + k + 2],
      ])
    );
  }
  return out;
}

function normal([a, b, c]: V3[]): V3 {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

test("the corners come out counter-clockwise seen from above", () => {
  const c = structureCorners(shed({ h: 2.5, z: 110 }));
  expect(c?.map((p) => [p.x, p.y])).toEqual([
    [104, 200],
    [104, 203],
    [100, 203],
    [100, 200],
  ]);
});

test("a box of 12 triangles, every face turned away from its centre", () => {
  const box = structureMesh(shed({ h: 2.5, z: 110 }), { cx: 100, cy: 200 });
  const tris = triangles(box.positions);
  expect(tris.length).toBe(12);
  const centre: V3 = [2, 1.5, 111];
  for (const t of tris) {
    const n = normal(t);
    const mid = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
    const out = [0, 1, 2].map((k) => mid[k] - centre[k]);
    expect(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]).toBeGreaterThan(0);
  }
  // Two roof triangles at the top, the base sunk below the lowest ground.
  expect(box.isRoof.filter((r) => r === 1).length).toBe(6);
  const zs = tris.flat().map((v) => v[2]);
  expect(Math.max(...zs)).toBeCloseTo(112.5, 5);
  expect(Math.min(...zs)).toBeCloseTo(110 - SMALL_BUILDING_SINK, 5);
});

test("a pent roof takes its height at each written corner", () => {
  const c = structureCorners(shed({ h: 2.6, hc: [2.2, 2.2, 3.0, 3.0], z: 0 }));
  // reversed with the ring: the written first corner is now the last
  expect(c?.map((p) => p.h)).toEqual([3.0, 3.0, 2.2, 2.2]);
});

test("a feature without properties or ring draws nothing", () => {
  expect(structureMesh(shed(null), { cx: 0, cy: 0 }).positions).toEqual([]);
});

test("a canopy point in or beside a shed is the shed, not a tree", () => {
  const tree = (x: number, y: number) => ({
    geometry: {
      coordinates: [x, y] as [number, number],
      type: "Point" as const,
    },
    properties: { h: 3.4 },
  });
  const trees = [
    tree(102, 201.5), // inside the 4 × 3 m shed
    tree(104.4, 201), // 0.4 m east of its wall
    tree(104.7, 201), // 0.7 m east: a tree
    tree(99.7, 199.7), // 0.42 m off its corner
    tree(120, 220),
  ];
  const kept = treesOffStructures(trees, [shed({ h: 2.5, z: 100 })]);
  expect(kept.map((t) => t.geometry.coordinates)).toEqual([
    [104.7, 201],
    [120, 220],
  ]);
  expect(treesOffStructures(trees, [])).toHaveLength(5);
});
