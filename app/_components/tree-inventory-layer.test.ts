import { expect, test } from "bun:test";
import { Vector3 } from "three";
import type { CanopyFeature, TreeFeature } from "@/lib/city/features";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { sceneCensus } from "./scene-census";
import { buildTreeInventory } from "./tree-inventory-layer";
import { buildVegetation, type VegetationContext } from "./vegetation-layer";

const ctx: VegetationContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 100,
};

const tree = (x: number, a: number, h = 12, d = 8): TreeFeature => ({
  geometry: { type: "Point", coordinates: [x, 0] },
  properties: { a, d, h, l: a === 3 ? "e" : "d" },
});

const canopy = (x: number): CanopyFeature => ({
  geometry: { type: "Point", coordinates: [x, 0] },
  properties: { h: 12 },
});

test("one trunk per tree plus a cheap and a rich crown per shape present", () => {
  // round + oval + small share the broadleaf crown; columnar, conifer and
  // weeping each get their own.
  const inv = buildTreeInventory(
    [
      tree(0, 0),
      tree(10, 1),
      tree(20, 5),
      tree(30, 2),
      tree(40, 3),
      tree(50, 4),
    ],
    ctx
  );
  expect(inv.counts).toEqual({ broad: 3, spindle: 1, cone: 1, weep: 1 });
  const census = sceneCensus([inv.control.group]);
  // 1 trunk mesh + 4 shapes × 2 LODs, all in one 250 m chunk
  expect(census.meshes).toBe(1 + 4 * 2);
  expect(census.instances).toBe(6 + 6 * 2);
});

test("crowns stand on the ground, never NaN (a NaN matrix culls the chunk)", () => {
  const inv = buildTreeInventory([tree(0, 2, 15, 4)], ctx);
  for (const child of inv.control.group.children) {
    const sphere = (
      child as { boundingSphere?: { center: Vector3; radius: number } }
    ).boundingSphere;
    expect(sphere).toBeDefined();
    expect(Number.isFinite(sphere?.radius)).toBe(true);
    expect(sphere?.center.y).toBeGreaterThan(100);
  }
});

test("keepTree vetoes the canopy points inside an inventory crown", () => {
  const inv = buildTreeInventory([tree(0, 0, 12, 10)], ctx);
  expect(inv.keepTree(3, 0)).toBe(false);
  expect(inv.keepTree(30, 0)).toBe(true);
  const veg = buildVegetation(
    { rows: [], canopy: [canopy(2), canopy(40)], keepTree: inv.keepTree },
    ctx
  );
  // only the far canopy point survives: trunk + cheap + rich instances
  expect(sceneCensus([veg.group]).instances).toBe(3);
});

test("empty input builds nothing and vetoes nothing; the control still works", () => {
  const inv = buildTreeInventory([], ctx);
  expect(inv.control.group.children).toHaveLength(0);
  expect(inv.keepTree(0, 0)).toBe(true);
  const built = buildTreeInventory([tree(5, 0)], ctx);
  expect(() => built.control.applyLook(LOOK_DEFAULTS)).not.toThrow();
  expect(built.control.updateLod(new Vector3(5, 100, 0))).toBe(true);
  expect(built.control.updateLod(new Vector3(5, 100, 0))).toBe(false);
  built.control.setTime(1);
});
