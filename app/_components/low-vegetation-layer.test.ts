import { expect, test } from "bun:test";
import { Matrix4, Mesh, MeshStandardNodeMaterial, Vector3 } from "three/webgpu";
import type { LowVegFeature } from "@/lib/city/features";
import {
  buildHedgeGeo,
  buildLowVegetation,
  hedgeLines,
  hedgePieces,
} from "./low-vegetation-layer";
import type { VegRowFeature } from "@/lib/city/features";
import { DEFAULT_HEDGE_H } from "@/lib/city/ask-more";
import { isInstances } from "./instancing";
import { sceneCensus } from "./scene-census";

const ctx = { offset: { cx: 0, cy: 0 }, heightAt: () => 100 };

const hedge = (coords: [number, number][], h = 1.5): LowVegFeature => ({
  geometry: { type: "LineString", coordinates: coords },
  properties: { kind: "hedge", h, w: 1, src: "osm+lsc" },
});

test("a hedge is cut into ≤2.5 m pieces that follow every corner", () => {
  const pieces = hedgePieces(
    [
      [0, 0],
      [10, 0],
      [10, 3],
    ],
    1.4,
    0.8
  );
  // 10 m → 4 pieces of 2.5 m, 3 m → 2 pieces of 1.5 m
  expect(pieces).toHaveLength(6);
  expect(pieces[0]).toMatchObject({ x: 1.25, y: 0, len: 2.5, h: 1.4, w: 0.8 });
  expect(pieces[0].angle).toBeCloseTo(0);
  expect(pieces[5].angle).toBeCloseTo(Math.PI / 2);
  // the pieces meet end to end; the two at the right-angle corner reach on
  // by half the width each (their mitre), so the corner closes
  expect(pieces[1].from).toEqual([2.5, 0]);
  expect(pieces[3].len).toBeCloseTo(2.5 + 0.4);
  expect(pieces[3].to[0]).toBeCloseTo(10.4);
  expect(pieces[4].from[1]).toBeCloseTo(-0.4);
  const total = pieces.reduce((s, p) => s + p.len, 0);
  expect(total).toBeCloseTo(13 + 0.8);
});

test("on a slope the pieces of a hedge meet at one height", () => {
  const slope = { ...ctx, heightAt: (x: number) => 100 + x * 0.1 };
  const group = buildLowVegetation(
    [
      hedge([
        [0, 0],
        [5, 0],
      ]),
    ],
    slope
  );
  const set = group.children.filter(isInstances)[0];
  const m = new Matrix4();
  const ends = [0, 1].map((i) => {
    set.getMatrixAt(i, m);
    return [
      new Vector3(-0.5, 0, 0).applyMatrix4(m),
      new Vector3(0.5, 0, 0).applyMatrix4(m),
    ];
  });
  // the first piece's end is the second's start, at the ground's height
  expect(ends[0][1].distanceTo(ends[1][0])).toBeLessThan(1e-4);
  expect(ends[0][0].y).toBeCloseTo(100 - 0.25, 1);
  expect(ends[1][1].y).toBeCloseTo(100.5 - 0.25, 1);
});

test("hedges become instances; off-terrain ones are skipped", () => {
  const line = hedge([
    [0, 0],
    [5, 0],
  ]);
  const group = buildLowVegetation([line], ctx);
  const sets = group.children.filter(isInstances);
  expect(sets).toHaveLength(1);
  expect(sets[0].drawCount).toBe(2);
  // the moss is one scene-wide node material, its colour drifting in world
  // space: no per-instance tint (it would step at a joint or a tile seam)
  expect(sets[0].material).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(sets[0].material.userData.shared).toBe(true);
  expect(sets[0].instanceTints).toBeNull();
  expect(buildLowVegetation([line], ctx).children[0]).toHaveProperty(
    "material",
    sets[0].material
  );
  const off = buildLowVegetation([line], { ...ctx, heightAt: () => null });
  expect(off.children).toHaveLength(0);
});

const dlmRow = (
  coords: [number, number][],
  kind: "hedge" | "treerow" = "hedge"
): VegRowFeature => ({
  geometry: { type: "LineString", coordinates: coords },
  properties: { kind },
});

test("the DLM's hedge rows are drawn like OSM's hedges, tree rows not", () => {
  const lines = hedgeLines(
    [
      hedge([
        [0, 0],
        [20, 0],
      ]),
    ],
    [
      dlmRow([
        [0, 5],
        [40, 5],
      ]),
      dlmRow(
        [
          [0, 10],
          [30, 10],
        ],
        "treerow"
      ),
    ]
  );
  expect(lines.map((l) => l.h)).toEqual([1.5, DEFAULT_HEDGE_H]);
  const group = buildLowVegetation([], ctx, [
    dlmRow([
      [0, 0],
      [5, 0],
    ]),
  ]);
  expect(group.children.filter(isInstances)[0].drawCount).toBe(2);
});

test("a hedge's pieces share one height, so no step shows", () => {
  const group = buildLowVegetation(
    [
      hedge([
        [0, 0],
        [12, 0],
      ]),
    ],
    ctx
  );
  const set = group.children.filter(isInstances)[0];
  const m = new Matrix4();
  const heights: number[] = [];
  for (let i = 0; i < set.drawCount; i++) {
    set.getMatrixAt(i, m);
    heights.push(new Vector3().setFromMatrixColumn(m, 1).length());
  }
  expect(new Set(heights).size).toBe(1);
});

test("a closed ring of hedge is mitred where it closes too", () => {
  const ring = hedgePieces(
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
    1.5,
    1
  );
  // every piece of a 2 m square reaches half the width past both corners
  for (const p of ring) {
    expect(p.len).toBeCloseTo(3);
  }
  // a vine row's boxes are not mitred
  expect(
    hedgePieces(
      [
        [0, 0],
        [2, 0],
        [2, 2],
      ],
      1,
      1,
      false
    ).map((p) => p.len)
  ).toEqual([2, 2]);
});

test("the unit hedge block stays small and sits on the ground", () => {
  const geo = buildHedgeGeo();
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  expect(box?.min.y ?? -1).toBeGreaterThan(-0.2);
  expect(box?.max.y ?? 9).toBeLessThan(1.2);
  // cheap enough to instance thousands of times (the shadow pass pays twice):
  // below the cheap tree crown (320)
  expect(sceneCensus([new Mesh(buildHedgeGeo())]).triangles).toBeLessThan(320);
});
