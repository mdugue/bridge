import { expect, test } from "bun:test";
import {
  cutGaps,
  cutWallGates,
  FENCE_CODE,
  FENCE_UV_CODES,
  FENCE_UV_SPAN,
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

/** Pattern code of a vertex, decoded as the shader does. */
function codeOf(data: FenceGeometryData, v: number): number {
  const uu = data.uvs[v * 2] * FENCE_UV_CODES * FENCE_UV_SPAN;
  return Math.floor(uu / FENCE_UV_SPAN);
}

test("fenceU packs the code and the distance, and decodes back", () => {
  for (const [code, along] of [
    [0, 0],
    [3, 2.5],
    [6, 4.9],
  ]) {
    const uu = fenceU(code, along) * FENCE_UV_CODES * FENCE_UV_SPAN;
    expect(Math.floor(uu / FENCE_UV_SPAN)).toBe(code);
    expect(uu - code * FENCE_UV_SPAN).toBeCloseTo(
      Math.min(Math.max(along, 0.01), FENCE_UV_SPAN - 0.01),
      6
    );
  }
  expect(fenceU(FENCE_UV_CODES - 1, 99)).toBeLessThan(1);
  expect(fenceU(0, -1)).toBeGreaterThan(0);
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

test("a fence stands a panel between each pair of posts, and a last post", () => {
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
  expect(Math.max(...ys)).toBeCloseTo(101.2, 6); // the rail, drawn at the top
  expect(Math.min(...ys)).toBeCloseTo(99.95, 6); // into the ground
  // 10 m in four 2.5 m panels and one end post: five quads.
  expect(data.indices.length / 3).toBe(5 * 2);
  const codes = new Set(
    Array.from({ length: data.positions.length / 3 }, (_, v) => codeOf(data, v))
  );
  expect([...codes].toSorted((x, y) => x - y)).toEqual([
    FENCE_CODE.railing,
    FENCE_CODE.iron,
  ]);
  for (const uv of data.uvs) {
    expect(uv).toBeGreaterThanOrEqual(0);
    expect(uv).toBeLessThanOrEqual(1);
  }
  // A handrail draws its own code (posts and a rail, no infill).
  const rail = fenceGeometry(
    [{ coords: line, h: 1, type: "rail" }],
    [],
    flat,
    offset
  );
  expect(rail && codeOf(rail, 0)).toBe(FENCE_CODE.handrail);
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

test("gates: a closed leaf in the gap, a boom for a lift gate", () => {
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
  expect(codes(leaf).has(FENCE_CODE.frame)).toBe(false); // the leaf draws its own frame
  expect(codes(boom).has(FENCE_CODE.gate)).toBe(false);
  expect(codes(boom).has(FENCE_CODE.frame)).toBe(true);
  // No panel of the fence itself crosses the gap (4.4–5.6 m).
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
