import { expect, test } from "bun:test";
import {
  Color,
  Matrix4,
  MeshStandardNodeMaterial,
  type Object3D,
  Vector3,
} from "three/webgpu";
import type { CanopyFeature, VegRowFeature } from "@/lib/city/features";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { TRUNK_ROWS, trunkRadiusAt } from "@/lib/city/tree-inventory";
import { isInstances } from "./instancing";
import {
  buildCrownWarmup,
  buildTrunkGeo,
  buildVegetation,
  sceneCrowns,
  TRUNK_H,
  updateVegetationLod,
  type VegetationContext,
} from "./vegetation-layer";

/** Instances drawn under a root (each set's `drawCount`). */
function instancesIn(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (isInstances(o)) {
      n += o.drawCount;
    }
  });
  return n;
}

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
  // samplePolyline: 0, 1.1, …, 9.9 → 10 samples, one Instances set.
  expect(instancesIn(hedges.group)).toBe(10);

  const trees = buildVegetation(
    { rows: [row("treerow", 20)], canopy: [] },
    ctx
  );
  // 0, 9, 18 → 3 trees; each is a trunk + a mid, a rich and a far crown
  // instance (a sparse chunk keeps every tree in the far tier).
  expect(instancesIn(trees.group)).toBe(3 * 4);
});

test("canopy points become trees; off-terrain points are skipped", () => {
  const built = buildVegetation(
    { rows: [], canopy: [canopy(5, 12), canopy(50, 8)], ndviAt: () => 0.7 },
    ctx
  );
  expect(instancesIn(built.group)).toBe(2 * 4);
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
  expect(chunk.far.drawCount).toBe(400);
});

test("trunks and the near crowns share one instance buffer", () => {
  const built = buildVegetation({ rows: [], canopy: [canopy(5, 12)] }, ctx);
  const [chunk] = built.chunks;
  expect(chunk.trunks.instanceMatrix).toBe(chunk.mid.instanceMatrix);
  expect(chunk.rich.instanceMatrix).toBe(chunk.mid.instanceMatrix);
  expect(chunk.rich.instanceTints).toBe(chunk.mid.instanceTints);
  // Each still culls against a sphere of its own geometry.
  expect(chunk.rich.geometry.boundingSphere).not.toBeNull();
  expect(chunk.trunks.geometry.boundingSphere).not.toBeNull();
  expect(chunk.trunks.geometry.boundingSphere?.radius).toBeLessThan(
    chunk.rich.geometry.boundingSphere?.radius ?? 0
  );
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
  expect(chunk.far.drawCount).toBe(2);
});

test("every tile wears the scene's crown and trunk materials; the warm-up carries both crowns", () => {
  const sun = new Vector3(0.3, 0.8, 0.1);
  const a = buildVegetation(
    { rows: [], canopy: [canopy(0, 12), canopy(20, 14)] },
    { ...ctx, sunDirection: sun }
  );
  const b = buildVegetation({ rows: [], canopy: [canopy(900, 12)] }, ctx);
  const [ca] = a.chunks;
  const [cb] = b.chunks;
  const { leafy, bare, uniforms } = sceneCrowns();
  // one material per part for the whole scene: one build, one pipeline
  for (const chunk of [ca, cb]) {
    expect([chunk.mid, chunk.rich, chunk.far].map((m) => m.material)).toEqual([
      leafy,
      leafy,
      leafy,
    ]); // before any season: the plain crown
  }
  expect(ca.trunks.material).toBe(cb.trunks.material);
  expect(ca.trunks.material).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(ca.trunks.material.userData.shared).toBe(true);
  expect(leafy.userData.shared).toBe(true);
  // the sun uniform holds the rig's vector by reference
  expect(uniforms.sunDirection.value).toBe(sun);
  // the look and the clock write the shared uniforms
  a.applyLook({ ...LOOK_DEFAULTS, shimmer: 0.42 });
  expect(uniforms.shimmer.value).toBe(0.42);
  b.setTime(12.5);
  expect(uniforms.time.value).toBe(12.5);
  a.applyLook(LOOK_DEFAULTS);
  const warm = buildCrownWarmup();
  expect(warm.main.map((m) => m.material)).toEqual([bare, leafy]);
  expect(warm.main[0].geometry.getAttribute("normal")).toBeDefined();
  warm.dispose();
});

test("the trunk geometry's rings are the profile its girth is fitted to", () => {
  const geo = buildTrunkGeo();
  const pos = geo.getAttribute("position");
  for (let k = 0; k <= TRUNK_ROWS; k++) {
    const y = (k / TRUNK_ROWS) * TRUNK_H;
    const ring: [number, number][] = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - y) < 1e-4) {
        ring.push([pos.getX(i), pos.getZ(i)]);
      }
    }
    // The bend moves a ring sideways, not apart: measure from its centre,
    // leaving out the end caps' centre vertices.
    const centre = (ps: [number, number][]) =>
      [0, 1].map((c) => ps.reduce((s, p) => s + p[c], 0) / ps.length);
    const [ax, az] = centre(ring);
    const rim = ring.filter(([x, z]) => Math.hypot(x - ax, z - az) > 0.02);
    const [cx, cz] = centre(rim);
    const mean =
      rim.reduce((s, [x, z]) => s + Math.hypot(x - cx, z - cz), 0) / rim.length;
    // ±10 % bark bumps per vertex average out to a few per cent.
    expect(Math.abs(mean / trunkRadiusAt(k / TRUNK_ROWS) - 1)).toBeLessThan(
      0.08
    );
  }
});
