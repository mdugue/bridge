import { expect, test } from "bun:test";
import type { Mesh } from "three";
import type { WallFeature } from "@/lib/city/features";
import { buildWalls, type WallContext } from "./wall-layer";

const ctx: WallContext = { offset: { cx: 0, cy: 0 }, heightAt: () => 100 };

const line = (h: number | null): WallFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [10, 0],
    ],
  },
  properties: h === null ? null : { h, kind: "retaining_wall" },
});

const vertexCount = (group: ReturnType<typeof buildWalls>): number => {
  const mesh = group.children[0] as Mesh | undefined;
  return mesh?.geometry.getAttribute("position").count ?? 0;
};

test("a wall becomes one ribbon: a quad (two triangles) per densified segment", () => {
  const group = buildWalls([line(3)], ctx);
  expect(group.name).toBe("walls");
  expect(group.children).toHaveLength(1);
  // 10 m at 2.5 m spacing → 5 columns → 4 quads → 24 vertices.
  expect(vertexCount(group)).toBe(4 * 6);
});

test("kerb-height walls and empty inputs build nothing", () => {
  expect(buildWalls([], ctx).children).toHaveLength(0);
  expect(buildWalls([line(0.5)], ctx).children).toHaveLength(0);
});

test("null properties fall back to a default height", () => {
  expect(vertexCount(buildWalls([line(null)], ctx))).toBeGreaterThan(0);
});

test("a wall off the terrain is skipped, not thrown", () => {
  const off = buildWalls([line(3)], { ...ctx, heightAt: () => null });
  expect(off.children).toHaveLength(0);
});
