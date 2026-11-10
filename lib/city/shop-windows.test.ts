import { expect, test } from "bun:test";
import type { V3 } from "./doors";
import { cutWall, openingBox, SHOP_WINDOW_DEPTH_M } from "./shop-windows";
import type { WallAxes, WallTriangle } from "./shop-windows";

/** A wall 10 m along +x at y 0, 6 m tall from z 100, facing −y. */
const axes: WallAxes = {
  at: (s, out, z) => [s, -out, z],
  n: [0, -1, 0],
  t: [1, 0, 0],
};
const wall: WallTriangle[] = [
  {
    id: 0,
    p: [
      [0, 0, 100],
      [10, 0, 100],
      [10, 0, 106],
    ],
  },
  {
    id: 3,
    p: [
      [0, 0, 100],
      [10, 0, 106],
      [0, 0, 106],
    ],
  },
];

const tris = (p: readonly number[]) => {
  const out: V3[][] = [];
  for (let i = 0; i < p.length; i += 9) {
    out.push([0, 3, 6].map((k): V3 => [p[i + k], p[i + k + 1], p[i + k + 2]]));
  }
  return out;
};
const normal = ([a, b, c]: V3[]): V3 => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
};
const area = (t: V3[]) => Math.hypot(...normal(t)) / 2;

test("the wall loses the opening, nothing more, facing as it did", () => {
  const cut = cutWall(axes, [{ s0: 2, s1: 5, z0: 100.5, z1: 103 }], wall);
  expect(cut.openings).toHaveLength(1);
  const left = cut.replaced.flatMap((r) => tris(r.positions));
  const total = left.reduce((sum, t) => sum + area(t), 0);
  expect(total).toBeCloseTo(60 - 3 * 2.5, 6);
  for (const t of left) {
    // still on the wall, facing out of it (−y)
    expect(t.every((p) => Math.abs(p[1]) < 1e-9)).toBe(true);
    expect(normal(t)[1]).toBeLessThan(0);
    // and nothing inside the opening
    const s = (t[0][0] + t[1][0] + t[2][0]) / 3;
    const z = (t[0][2] + t[1][2] + t[2][2]) / 3;
    expect(s > 2 && s < 5 && z > 100.5 && z < 103).toBe(false);
  }
  // the loop round the opening: its corners in order, and where the
  // quad's diagonal (s0z0 → s1z1 of the wall) crosses its edge, the
  // remainder's vertex there, the same point
  const loop = cut.corners[0];
  const sz = loop.map(([x, , z]) => [x, z]);
  for (const corner of [
    [2, 100.5],
    [5, 100.5],
    [5, 103],
    [2, 103],
  ]) {
    expect(
      sz.some(
        ([x, z]) =>
          Math.abs(x - corner[0]) < 1e-9 && Math.abs(z - corner[1]) < 1e-9
      )
    ).toBe(true);
  }
  expect(sz[0][0]).toBeCloseTo(2, 9);
  expect(sz[0][1]).toBeCloseTo(100.5, 9);
  // the diagonal z = 100 + 0.6 s meets the s0 side at z 101.2
  expect(
    sz.some(([x, z]) => Math.abs(x - 2) < 1e-9 && Math.abs(z - 101.2) < 1e-9)
  ).toBe(true);
  const remainder = new Set(
    left.flat().map((p) => p.map((c) => c.toFixed(9)).join(","))
  );
  for (const q of loop) {
    expect(remainder.has(q.map((c) => c.toFixed(9)).join(","))).toBe(true);
  }
});

test("an opening the wall does not cover stays uncut", () => {
  const cut = cutWall(axes, [{ s0: 8, s1: 12, z0: 100.5, z1: 103 }], wall);
  expect(cut.openings).toEqual([]);
  expect(cut.replaced).toEqual([]);
  // a wall facing the other way, or off its plane, is not this wall
  const behind = wall.map((w) => ({
    ...w,
    p: w.p.map((q): V3 => [q[0], q[1] + 0.5, q[2]]) as [V3, V3, V3],
  }));
  expect(
    cutWall(axes, [{ s0: 2, s1: 5, z0: 100.5, z1: 103 }], behind).openings
  ).toEqual([]);
});

test("the box: reveals facing into the opening, the glass out of the wall at its back", () => {
  const corners: V3[] = [
    [2, 0, 100.5],
    [5, 0, 100.5],
    [5, 0, 103],
    [2, 0, 103],
  ];
  const { glass, reveals } = openingBox(axes, corners);
  const faces = tris(reveals);
  expect(faces).toHaveLength(8);
  for (const t of faces) {
    const n = normal(t);
    const c = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
    // from the wall's face back into the building
    expect(c[1]).toBeGreaterThan(0);
    expect(c[1]).toBeLessThan(SHOP_WINDOW_DEPTH_M);
    // each faces the opening's middle
    const towards = [3.5 - c[0], 0, 101.75 - c[2]];
    expect(n[0] * towards[0] + n[2] * towards[2]).toBeGreaterThan(0);
  }
  for (const t of tris(glass)) {
    expect(t.every((p) => Math.abs(p[1] - SHOP_WINDOW_DEPTH_M) < 1e-9)).toBe(
      true
    );
    expect(normal(t)[1]).toBeLessThan(0);
  }
});
