import { expect, test } from "bun:test";
import type { PlateTile } from "@/lib/city/ground-plate";
import { landcoverSrgb, srgbToLinear } from "@/lib/city/landcover";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { buildGroundPlate, plateColours } from "./ground-plate-layer";

const n = 3;
const tile = (bounds: TerrainBounds, cls = 1): PlateTile => ({
  id: `${bounds[0]}`,
  bounds,
  classes: new Uint8Array(n * n).fill(cls),
  heights: new Float32Array(n * n).fill(110),
});
const WEST: TerrainBounds = [0, 0, 2000, 2000];
const EAST: TerrainBounds = [2000, 0, 4000, 2000];

test("each tile's plate hides while that tile shows terrain, and comes back", () => {
  const plate = buildGroundPlate([tile(WEST), tile(EAST)], n, {
    cx: 2000,
    cy: 1000,
  });
  const [west, east] = plate.group.children;
  expect(west.visible && east.visible).toBe(true);
  plate.showUnder(new Set(["2000"]));
  expect(west.visible).toBe(true);
  expect(east.visible).toBe(false);
  plate.showUnder(new Set());
  expect(east.visible).toBe(true);
  plate.dispose();
});

test("the plate shares one material and casts no shadow", () => {
  const plate = buildGroundPlate([tile(WEST), tile(EAST)], n, {
    cx: 0,
    cy: 0,
  });
  const meshes = plate.group.children as unknown as {
    castShadow: boolean;
    material: unknown;
    receiveShadow: boolean;
  }[];
  expect(meshes[0].material).toBe(meshes[1].material);
  expect(meshes.every((m) => !m.castShadow && m.receiveShadow)).toBe(true);
  plate.dispose();
});

test("the colours are the palette's, in linear light", () => {
  const colours = plateColours(Uint8Array.of(7));
  const [r, g, b] = landcoverSrgb(7);
  expect([...colours]).toEqual([
    ...[r, g, b].map((c) => Math.round(srgbToLinear(c) * 255)),
    255,
  ]);
});
