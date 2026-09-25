import { expect, test } from "bun:test";
import { Mesh } from "three";
import type { LowVegFeature } from "@/lib/city/features";
import {
  buildHedgeGeo,
  buildLowVegetation,
  hedgePieces,
} from "./low-vegetation-layer";
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
  const total = pieces.reduce((s, p) => s + p.len, 0);
  expect(total).toBeCloseTo(13);
});

test("hedges become instances; off-terrain ones are skipped", () => {
  const line = hedge([
    [0, 0],
    [5, 0],
  ]);
  expect(sceneCensus([buildLowVegetation([line], ctx)]).instances).toBe(2);
  const off = buildLowVegetation([line], { ...ctx, heightAt: () => null });
  expect(off.children).toHaveLength(0);
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
