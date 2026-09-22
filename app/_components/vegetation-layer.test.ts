import { expect, test } from "bun:test";
import { Vector3 } from "three";
import type { CanopyFeature, VegRowFeature } from "@/lib/city/features";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { sceneCensus } from "./scene-census";
import { buildVegetation, type VegetationContext } from "./vegetation-layer";

const ctx: VegetationContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 100,
};

const row = (kind: "hedge" | "treerow", length: number): VegRowFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [length, 0],
    ],
  },
  properties: { kind },
});

const canopy = (x: number, h: number): CanopyFeature => ({
  geometry: { type: "Point", coordinates: [x, 0] },
  properties: { h },
});

test("a hedge is one instance per 1.1 m, a tree row one tree per 9 m", () => {
  const hedges = buildVegetation({ rows: [row("hedge", 10)], canopy: [] }, ctx);
  // samplePolyline: 0, 1.1, …, 9.9 → 10 samples, one InstancedMesh.
  expect(sceneCensus([hedges.group]).instances).toBe(10);

  const trees = buildVegetation(
    { rows: [row("treerow", 20)], canopy: [] },
    ctx
  );
  // 0, 9, 18 → 3 trees; each is a trunk + a cheap and a rich crown instance.
  expect(sceneCensus([trees.group]).instances).toBe(3 * 3);
});

test("canopy points become trees; off-terrain points are skipped", () => {
  const built = buildVegetation(
    { rows: [], canopy: [canopy(5, 12), canopy(50, 8)], ndviAt: () => 0.7 },
    ctx
  );
  expect(sceneCensus([built.group]).instances).toBe(2 * 3);
  const off = buildVegetation(
    { rows: [], canopy: [canopy(5, 12)] },
    { ...ctx, heightAt: () => null }
  );
  expect(off.group.children).toHaveLength(0);
});

test("the control accepts the look and reports a crown LOD change", () => {
  const built = buildVegetation({ rows: [], canopy: [canopy(5, 12)] }, ctx);
  expect(() => built.applyLook(LOOK_DEFAULTS)).not.toThrow();
  // Born on the cheap crown; the camera standing next to it switches to rich.
  expect(built.updateLod(new Vector3(5, 100, 0))).toBe(true);
  expect(built.updateLod(new Vector3(5, 100, 0))).toBe(false);
  built.setTime(1);
});
