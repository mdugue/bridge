import { expect, test } from "bun:test";
import {
  clipAbove,
  insideBy,
  isOpenRoof,
  minimumRectangle,
  NARROW_M,
  POST_M,
  postsMesh,
  ROOF_DEPTH,
  roofDepth,
  roofPosts,
} from "./open-roofs";
import type { Point2 } from "./polyline";

/** A rectangle `l` × `w` centred at (cx, cy), its long side at `deg`. */
function rect(
  l: number,
  w: number,
  deg = 0,
  [cx, cy]: Point2 = [0, 0]
): Point2[] {
  const a = (deg * Math.PI) / 180;
  const u: Point2 = [Math.cos(a), Math.sin(a)];
  const v: Point2 = [-u[1], u[0]];
  return (
    [
      [-l / 2, -w / 2],
      [l / 2, -w / 2],
      [l / 2, w / 2],
      [-l / 2, w / 2],
    ] as Point2[]
  ).map(([s, t]): Point2 => [
    cx + s * u[0] + t * v[0],
    cy + s * u[1] + t * v[1],
  ]);
}

test("the ALKIS roofs on posts are told from a building", () => {
  expect(isOpenRoof("51009_1610")).toBe(true);
  expect(isOpenRoof("51009_1611")).toBe(true);
  expect(isOpenRoof("51009_1700")).toBe(false);
  expect(isOpenRoof("31001_2463")).toBe(false);
  expect(isOpenRoof(undefined)).toBe(false);
});

test("a slab is a carport's 0.2 m up to a platform roof's 0.7 m", () => {
  expect(roofDepth(15)).toBe(ROOF_DEPTH.min);
  expect(roofDepth(800)).toBe(ROOF_DEPTH.max);
  expect(roofDepth(100)).toBeCloseTo(0.4, 5);
});

test("the smallest rectangle finds a turned roof's axes", () => {
  const r = minimumRectangle(rect(100, 7, 30, [50, 20]));
  expect(r?.length).toBeCloseTo(100, 5);
  expect(r?.width).toBeCloseTo(7, 5);
  expect(Math.abs(r?.u[0] ?? 0)).toBeCloseTo(Math.cos(Math.PI / 6), 5);
  expect(r?.centre[0]).toBeCloseTo(50, 5);
  expect(r?.centre[1]).toBeCloseTo(20, 5);
});

test("a platform roof stands on one row of posts down its middle", () => {
  const ring = rect(100, 7, 30, [50, 20]);
  const posts = roofPosts([ring]);
  // a post every 8 m at most, cantilevered at the ends
  expect(posts.length).toBe(13);
  for (const [x, y] of posts) {
    // on the axis
    const s =
      (x - 50) * Math.cos(Math.PI / 6) + (y - 20) * Math.sin(Math.PI / 6);
    const t =
      -(x - 50) * Math.sin(Math.PI / 6) + (y - 20) * Math.cos(Math.PI / 6);
    expect(Math.abs(t)).toBeLessThan(1e-6);
    expect(Math.abs(s)).toBeLessThan(50 - 2);
  }
});

test("a carport stands on posts at its corners", () => {
  const posts = roofPosts([rect(5.5, 3)]);
  expect(posts.length).toBe(6);
  // along both long edges, inside the outline
  for (const [x, y] of posts) {
    expect(Math.abs(y)).toBeCloseTo(1.1, 5);
    expect(Math.abs(x)).toBeLessThanOrEqual(2.35 + 1e-9);
  }
  expect(3).toBeLessThan(NARROW_M);
});

test("a fuel station's canopy stands on two rows", () => {
  const posts = roofPosts([rect(24, 16)]);
  const rows = new Set(posts.map(([, y]) => y.toFixed(3)));
  expect(rows.size).toBe(2);
  expect(posts.length).toBe(6);
});

test("an angled roof keeps only the posts under it", () => {
  // an L: 40 × 8 and 8 × 40
  const l: Point2[] = [
    [0, 0],
    [40, 0],
    [40, 8],
    [8, 8],
    [8, 40],
    [0, 40],
  ];
  const posts = roofPosts([l]);
  expect(posts.length).toBeGreaterThan(0);
  for (const p of posts) {
    expect(insideBy([l], p, 0.4)).toBe(true);
  }
});

test("a point inside by an inset", () => {
  const ring = rect(10, 10);
  expect(insideBy([ring], [0, 0], 1)).toBe(true);
  expect(insideBy([ring], [4.5, 0], 1)).toBe(false);
  expect(insideBy([ring], [6, 0], 0)).toBe(false);
  // a hole
  expect(insideBy([ring, rect(2, 2)], [0, 0], 0)).toBe(false);
});

test("a post is four walls of its side from foot to slab", () => {
  const m = postsMesh([[3, 4]], 100, 105);
  expect(m.positions.length).toBe(4 * 2 * 9);
  expect(m.isRoof.every((r) => r === 0)).toBe(true);
  const xs = m.positions.filter((_, i) => i % 3 === 0);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(POST_M, 5);
  const zs = m.positions.filter((_, i) => i % 3 === 2);
  expect(Math.min(...zs)).toBe(100);
  expect(Math.max(...zs)).toBe(105);
  // outward: the wall at x + r faces +x
  for (let i = 0; i < m.positions.length; i += 9) {
    const p = m.positions.slice(i, i + 9);
    const nx = (p[4] - p[1]) * (p[8] - p[2]) - (p[5] - p[2]) * (p[7] - p[1]);
    const ny = (p[5] - p[2]) * (p[6] - p[0]) - (p[3] - p[0]) * (p[8] - p[2]);
    const cx = (p[0] + p[3] + p[6]) / 3 - 3;
    const cy = (p[1] + p[4] + p[7]) / 3 - 4;
    expect(nx * cx + ny * cy).toBeGreaterThan(0);
  }
  expect(postsMesh([[0, 0]], 5, 5).positions.length).toBe(0);
});

test("a wall is cut to the part above a height, its winding kept", () => {
  // a wall triangle from z 0 to 10
  const tri = [0, 0, 0, 10, 0, 0, 10, 0, 10];
  const cut = clipAbove(tri, 6);
  expect(cut.length).toBe(9);
  expect(Math.min(...cut.filter((_, i) => i % 3 === 2))).toBe(6);
  // the same facing: its normal still points -y
  const ny =
    (cut[5] - cut[2]) * (cut[6] - cut[0]) -
    (cut[3] - cut[0]) * (cut[8] - cut[2]);
  expect(ny).toBeLessThan(0);
  // a quad's lower triangle keeps a fan of two
  expect(clipAbove([0, 0, 0, 10, 0, 0, 0, 0, 10], 2).length).toBe(9);
  expect(clipAbove([0, 0, 0, 10, 0, 10, 0, 0, 10], 2).length).toBe(18);
  expect(clipAbove(tri, 11)).toEqual([]);
  expect(clipAbove(tri, -1)).toEqual(tri);
});
