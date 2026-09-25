import { expect, test } from "bun:test";
import {
  bandHeight,
  cutGaps,
  cutWallGates,
  FENCE_CODE,
  FENCE_UV_CODES,
  type FenceGeometryData,
  fenceGeometry,
  fenceU,
  type GatePoint,
} from "./fences";
import type { Point2 } from "./polyline";

const offset = { cx: 0, cy: 0 };
const flat = () => 100;
const line: Point2[] = [
  [0, 0],
  [10, 0],
];
const gate = (
  x: number,
  w = 1.2,
  extra: Partial<GatePoint> = {}
): GatePoint => ({
  at: [x, 0],
  on: "fence",
  w,
  ...extra,
});

/** Kind code of a vertex, decoded as the shader does. */
function codeOf(data: FenceGeometryData, v: number): number {
  return Math.floor(data.uvs[v * 2] * FENCE_UV_CODES);
}

test("fenceU puts each code in the middle of its slot, and decodes back", () => {
  for (const code of Object.values(FENCE_CODE)) {
    const u = fenceU(code);
    expect(Math.floor(u * FENCE_UV_CODES)).toBe(code);
    // 16-bit quantisation moves it by far less than half a slot.
    expect(Math.floor((Math.round(u * 65_535) / 65_535) * FENCE_UV_CODES)).toBe(
      code
    );
    expect(u).toBeGreaterThan(0);
    expect(u).toBeLessThan(1);
  }
});

test("a band stands at three quarters of the tagged height, 0.4–1 m", () => {
  expect(bandHeight(1.2)).toBeCloseTo(0.9, 6);
  expect(bandHeight(2)).toBe(1);
  expect(bandHeight(0.3)).toBe(0.4);
});

test("a gate cuts its gap out of the line and leaves a leaf in it", () => {
  const cut = cutGaps(line, [gate(5, 2)]);
  expect(cut.pieces).toHaveLength(2);
  expect(cut.pieces[0].at(-1)?.[0]).toBeCloseTo(4, 6);
  expect(cut.pieces[1][0][0]).toBeCloseTo(6, 6);
  expect(cut.leaves).toHaveLength(1);
  expect(cut.leaves[0].a[0]).toBeCloseTo(4, 6);
  expect(cut.leaves[0].b[0]).toBeCloseTo(6, 6);
  // A gate off the line cuts nothing; overlapping gaps merge into one.
  expect(cutGaps(line, [{ ...gate(5), at: [5, 3] }]).pieces).toEqual([line]);
  const twin = cutGaps(line, [gate(5, 2), gate(5.5, 2)]);
  expect(twin.pieces).toHaveLength(2);
  expect(twin.leaves).toHaveLength(1);
  // A gate at the very end leaves no stub shorter than 30 cm.
  expect(cutGaps(line, [gate(9.9, 1.2)]).pieces).toHaveLength(1);
});

test("a fence stands as one band, a quad per ≤ 2.5 m and nothing else", () => {
  const data = fenceGeometry(
    [
      {
        coords: [
          [0, 0],
          [5, 0.02], // within 10 cm of the chord: simplified away
          [10, 0],
        ],
        h: 1.2,
        type: "railing",
      },
    ],
    [],
    flat,
    offset
  );
  expect(data).not.toBeNull();
  if (!data) {
    return;
  }
  const ys = data.positions.filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys)).toBeCloseTo(100.9, 6); // the band's top: 0.75 × 1.2 m
  expect(Math.min(...ys)).toBeCloseTo(99.95, 6); // into the ground
  // 10 m in four 2.5 m quads: no posts, no rails.
  expect(data.indices.length / 3).toBe(4 * 2);
  const codes = new Set(
    Array.from({ length: data.positions.length / 3 }, (_, v) => codeOf(data, v))
  );
  expect([...codes]).toEqual([FENCE_CODE.railing]);
  for (const uv of data.uvs) {
    expect(uv).toBeGreaterThanOrEqual(0);
    expect(uv).toBeLessThanOrEqual(1);
  }
  // A handrail is only the top 15 cm of its band, in its own code.
  const rail = fenceGeometry(
    [{ coords: line, h: 1, type: "rail" }],
    [],
    flat,
    offset
  );
  expect(rail && codeOf(rail, 0)).toBe(FENCE_CODE.handrail);
  const railYs = rail?.positions.filter((_, i) => i % 3 === 1) ?? [];
  expect(Math.min(...railYs)).toBeCloseTo(100.6, 6);
  expect(Math.max(...railYs)).toBeCloseTo(100.75, 6);
});

test("every triangle winds counter-clockwise about its vertex normals", () => {
  const data = fenceGeometry(
    [
      {
        coords: [
          [0, 0],
          [6, 0],
          [6, 5],
        ],
        h: 1.5,
        type: "picket",
      },
    ],
    [],
    flat,
    offset
  );
  if (!data) {
    throw new Error("no fence");
  }
  const p = (i: number) => data.positions.slice(i * 3, i * 3 + 3);
  const n = (i: number) => data.normals.slice(i * 3, i * 3 + 3);
  for (let t = 0; t < data.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => data.indices[t + k]);
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    const e1 = pb.map((v, k) => v - pa[k]);
    const e2 = pc.map((v, k) => v - pa[k]);
    const face = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const mean = [0, 1, 2].map((k) => n(a)[k] + n(b)[k] + n(c)[k]);
    expect(
      face[0] * mean[0] + face[1] * mean[1] + face[2] * mean[2]
    ).toBeGreaterThan(0);
  }
});

test("gates: a leaf in the gap, a boom for a lift gate", () => {
  const fence = { coords: line, h: 1.2, type: "mesh" as const };
  const leaf = fenceGeometry([fence], [gate(5)], flat, offset);
  const boom = fenceGeometry(
    [fence],
    [gate(5, 4, { type: "lift_gate" })],
    flat,
    offset
  );
  if (!(leaf && boom)) {
    throw new Error("no fence");
  }
  const codes = (d: FenceGeometryData) =>
    new Set(
      Array.from({ length: d.positions.length / 3 }, (_, v) => codeOf(d, v))
    );
  expect(codes(leaf).has(FENCE_CODE.gate)).toBe(true);
  expect(codes(leaf).has(FENCE_CODE.frame)).toBe(false);
  expect(codes(boom).has(FENCE_CODE.gate)).toBe(false);
  expect(codes(boom).has(FENCE_CODE.frame)).toBe(true);
  // No quad of the fence itself crosses the gap (4.4–5.6 m).
  for (let t = 0; t < leaf.indices.length; t += 3) {
    const vs = [0, 1, 2].map((k) => leaf.indices[t + k]);
    if (codeOf(leaf, vs[0]) !== FENCE_CODE.mesh) {
      continue;
    }
    const xs = vs.map((v) => leaf.positions[v * 3]);
    expect(Math.min(...xs) >= 5.6 - 1e-6 || Math.max(...xs) <= 4.4 + 1e-6).toBe(
      true
    );
  }
  // Unknown ground stands nothing.
  expect(fenceGeometry([fence], [], () => null, offset)).toBeNull();
});

test("gates on a wall cut only freestanding walls, with a leaf as tall as the wall", () => {
  const onWall = gate(5, 1.2, { on: "wall" });
  const garden = { coords: line, h: 1.8, kind: "wall" };
  const retaining = { coords: line, h: 3, kind: "retaining_wall" };
  const cut = cutWallGates([garden, retaining], [onWall, gate(2)]);
  expect(cut.walls).toHaveLength(3); // two garden pieces + the retaining wall
  expect(cut.walls[2]).toBe(retaining);
  expect(cut.leaves).toHaveLength(1);
  expect(cut.leaves[0].h).toBeCloseTo(1.8, 6);
  const leaf = fenceGeometry([], [], flat, offset, cut.leaves);
  expect(leaf?.indices.length ?? 0).toBeGreaterThan(0);
});

/** Metres along a closed ring (from its first vertex) of a point on it. */
function alongRing(ring: Point2[], p: Point2): number {
  let acc = 0;
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const t = ((p[0] - x0) * (x1 - x0) + (p[1] - y0) * (y1 - y0)) / len ** 2;
    const off = Math.hypot(
      x0 + (x1 - x0) * t - p[0],
      y0 + (y1 - y0) * t - p[1]
    );
    if (t >= -1e-9 && t <= 1 + 1e-9 && off < 1e-6) {
      return acc + t * len;
    }
    acc += len;
  }
  throw new Error("not on the ring");
}

const lengthOf = (piece: Point2[]) =>
  piece.reduce(
    (sum, [x, y], i) =>
      i === 0 ? 0 : sum + Math.hypot(x - piece[i - 1][0], y - piece[i - 1][1]),
    0
  );

test("a gate at a closed ring's closing vertex cuts its whole gap", () => {
  // A 10 m square yard, closing at its corner (0, 0), a 4 m gate there.
  const square: Point2[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const cut = cutGaps(square, [{ at: [0, 0], on: "fence", w: 4 }]);
  expect(cut.leaves).toHaveLength(1);
  const { a, b } = cut.leaves[0];
  // 2 m along each side of the corner.
  const ends = [a, b]
    .map((p) => alongRing(square, p))
    .toSorted((x, y) => x - y);
  expect(ends[0]).toBeCloseTo(2, 6);
  expect(ends[1]).toBeCloseTo(38, 6);
  // One piece, the rest of the ring (no second end at the closure).
  expect(cut.pieces).toHaveLength(1);
  expect(lengthOf(cut.pieces[0])).toBeCloseTo(36, 6);
  // The same yard closing mid-side: a straight 4 m leaf.
  const midSide: Point2[] = [
    [5, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
    [5, 0],
  ];
  const mid = cutGaps(midSide, [{ at: [5, 0], on: "fence", w: 4 }]);
  expect(mid.leaves).toHaveLength(1);
  const [m] = mid.leaves;
  expect(Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1])).toBeCloseTo(4, 6);
  expect(mid.pieces).toHaveLength(1);
  expect(lengthOf(mid.pieces[0])).toBeCloseTo(36, 6);
  // A ring with a gate elsewhere opens there: one piece, no end at (0, 0).
  const side = cutGaps(square, [{ at: [10, 5], on: "fence", w: 2 }]);
  expect(side.pieces).toHaveLength(1);
  expect(lengthOf(side.pieces[0])).toBeCloseTo(38, 6);
});

test("a neighbour's gate over the seam cuts this tile's piece and draws its share", () => {
  // The fence runs across a seam at x = 10; the 4 m gate stands 1 m past it,
  // on the neighbour's side.
  const here: Point2[] = [
    [0, 0],
    [10, 0],
  ];
  const there: Point2[] = [
    [10, 0],
    [20, 0],
  ];
  const owned: GatePoint = { at: [11, 0], on: "fence", w: 4 };
  const seam: GatePoint = { ...owned, seam: true };
  const mine = cutGaps(here, [seam]);
  expect(mine.pieces).toHaveLength(1);
  expect(mine.pieces[0].at(-1)?.[0]).toBeCloseTo(9, 6);
  expect(mine.leaves).toHaveLength(1);
  expect(mine.leaves[0].a[0]).toBeCloseTo(9, 6);
  expect(mine.leaves[0].b[0]).toBeCloseTo(10, 6);
  // The owner cuts the rest: 9 → 13 m across both tiles, the gate's 4 m.
  const theirs = cutGaps(there, [owned]);
  expect(theirs.leaves[0].a[0]).toBeCloseTo(10, 6);
  expect(theirs.leaves[0].b[0]).toBeCloseTo(13, 6);
  // Without the flag, or beyond w/2, the neighbour's gate cuts nothing here.
  expect(cutGaps(here, [owned]).pieces).toEqual([here]);
  expect(cutGaps(here, [{ ...seam, at: [12.5, 0] }]).pieces).toEqual([here]);
  // Nor one off the line's continuation.
  expect(cutGaps(here, [{ ...seam, at: [11, 1.5] }]).pieces).toEqual([here]);
});

test("a swing gate is a boom at the band's top", () => {
  const fence = { coords: line, h: 1.2, type: "mesh" as const };
  const swing = fenceGeometry(
    [fence],
    [gate(5, 3, { type: "swing_gate" })],
    flat,
    offset
  );
  if (!swing) {
    throw new Error("no fence");
  }
  const codes = new Set(
    Array.from({ length: swing.positions.length / 3 }, (_, v) =>
      codeOf(swing, v)
    )
  );
  expect([...codes].toSorted((x, y) => x - y)).toEqual([
    FENCE_CODE.mesh,
    FENCE_CODE.frame,
  ]);
  const boomYs = Array.from({ length: swing.positions.length / 3 }, (_, v) => v)
    .filter((v) => codeOf(swing, v) === FENCE_CODE.frame)
    .map((v) => swing.positions[v * 3 + 1]);
  expect(Math.min(...boomYs)).toBeCloseTo(100.75, 6);
  expect(Math.max(...boomYs)).toBeCloseTo(100.9, 6);
});
