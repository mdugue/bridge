import { expect, test } from "bun:test";
import {
  Color,
  type InstancedMesh,
  type Material,
  Matrix4,
  Vector3,
} from "three";
import type { CanopyFeature, VegRowFeature } from "@/lib/city/features";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { createHeightFogUniforms } from "./height-fog";
import { sceneCensus } from "./scene-census";
import {
  buildCrownWarmup,
  buildVegetation,
  updateVegetationLod,
  type VegetationContext,
} from "./vegetation-layer";

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

const canopy = (x: number, h: number, y = 0): CanopyFeature => ({
  geometry: { type: "Point", coordinates: [x, y] },
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
  // 0, 9, 18 → 3 trees; each is a trunk + a mid, a rich and a far crown
  // instance (a sparse chunk keeps every tree in the far tier).
  expect(sceneCensus([trees.group]).instances).toBe(3 * 4);
});

test("canopy points become trees; off-terrain points are skipped", () => {
  const built = buildVegetation(
    { rows: [], canopy: [canopy(5, 12), canopy(50, 8)], ndviAt: () => 0.7 },
    ctx
  );
  expect(sceneCensus([built.group]).instances).toBe(2 * 4);
  const off = buildVegetation(
    { rows: [], canopy: [canopy(5, 12)] },
    { ...ctx, heightAt: () => null }
  );
  expect(off.group.children).toHaveLength(0);
});

test("the control accepts the look and reports a crown tier change", () => {
  const built = buildVegetation({ rows: [], canopy: [canopy(5, 12)] }, ctx);
  expect(() => built.applyLook(LOOK_DEFAULTS)).not.toThrow();
  // Born on the mid crown; the camera standing next to it switches to rich.
  expect(updateVegetationLod([built], new Vector3(5, 100, 0))).toBe(true);
  expect(built.chunks[0].tier).toBe("rich");
  expect(updateVegetationLod([built], new Vector3(5, 100, 0))).toBe(false);
  built.setTime(1);
});

test("far away a chunk draws the far crown and no trunks", () => {
  const built = buildVegetation({ rows: [], canopy: [canopy(5, 12)] }, ctx);
  expect(updateVegetationLod([built], new Vector3(5_000, 100, 0))).toBe(true);
  const [chunk] = built.chunks;
  expect(chunk.tier).toBe("far");
  expect([chunk.far.visible, chunk.mid.visible, chunk.rich.visible]).toEqual([
    true,
    false,
    false,
  ]);
  expect(chunk.trunks.visible).toBe(false);
});

test("a dense chunk's far tier keeps every other tree", () => {
  // 800 trees 5 m apart, all inside one 250 m chunk (northings 10–105 m are
  // world z −10…−105).
  const forest = Array.from({ length: 800 }, (_, i) =>
    canopy((i % 40) * 5, 12, 10 + Math.floor(i / 40) * 5)
  );
  const built = buildVegetation({ rows: [], canopy: forest }, ctx);
  const [chunk] = built.chunks;
  expect(chunk.trees).toBe(800);
  expect(chunk.far.count).toBe(400);
});

test("trunks and the near crowns share one instance buffer", () => {
  const built = buildVegetation({ rows: [], canopy: [canopy(5, 12)] }, ctx);
  const [chunk] = built.chunks;
  expect(chunk.trunks.instanceMatrix).toBe(chunk.mid.instanceMatrix);
  expect(chunk.rich.instanceMatrix).toBe(chunk.mid.instanceMatrix);
  expect(chunk.rich.instanceColor).toBe(chunk.mid.instanceColor);
  // Each still culls against a sphere of its own geometry.
  expect(chunk.rich.boundingSphere).not.toBeNull();
  expect(chunk.trunks.boundingSphere).not.toBeNull();
});

test("a chunk with precomputed trees keeps its own matrices per mesh", () => {
  const trunk = new Matrix4().makeTranslation(3, 100, 3);
  const crown = {
    cheap: new Matrix4().makeTranslation(3, 104, 3),
    rich: new Matrix4().makeTranslation(3, 105, 3),
    colour: new Color(0x88_99_66),
  };
  const built = buildVegetation(
    {
      rows: [],
      canopy: [canopy(5, 12)],
      extraTrees: [{ x: 3, z: 3, trunk, crown }],
    },
    ctx
  );
  const [chunk] = built.chunks;
  expect(chunk.trees).toBe(2);
  // The cadastre tree's trunk and crowns differ, so nothing is shared.
  expect(chunk.trunks.instanceMatrix).not.toBe(chunk.mid.instanceMatrix);
  expect(chunk.rich.instanceMatrix).not.toBe(chunk.mid.instanceMatrix);
  expect(chunk.far.count).toBe(2);
});

test("the crown warm-up carries the program keys a tile's crowns switch between", () => {
  const heightFog = createHeightFogUniforms();
  const veg = buildVegetation(
    { rows: [], canopy: [canopy(0, 12), canopy(20, 14)] },
    { ...ctx, heightFog }
  );
  const keyOf = (m: Material | Material[]) =>
    (m as Material).customProgramCacheKey();
  const worn = new Set<string>();
  veg.group.traverse((o) => {
    const mesh = o as InstancedMesh;
    if (mesh.isInstancedMesh && keyOf(mesh.material).startsWith("crown-")) {
      worn.add(keyOf(mesh.material));
    }
  });
  expect([...worn]).toEqual(["crown-true-leafy"]); // before any season: the plain crown
  const warm = buildCrownWarmup(heightFog);
  expect(warm.main.map((m) => keyOf(m.material))).toEqual([
    "crown-true-bare",
    "crown-true-leafy",
  ]);
  expect(warm.depth[0].geometry.getAttribute("normal")).toBeDefined();
  warm.dispose();
});
