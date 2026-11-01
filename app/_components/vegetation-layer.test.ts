import { describe, expect, test } from "bun:test";
import {
  Color,
  Matrix4,
  MeshStandardNodeMaterial,
  type Object3D,
  Vector3,
} from "three/webgpu";
import type { CanopyFeature, VegRowFeature } from "@/lib/city/features";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import {
  PINE_CROWN_BASE,
  TRUNK_ROWS,
  trunkRadiusAt,
} from "@/lib/city/tree-inventory";
import {
  BASE_TREE_H,
  crownBase,
  GENERIC_CROWN_FOOT,
  GENERIC_CROWN_W,
} from "@/lib/city/tree-placement";
import { isInstances } from "./instancing";
import {
  buildConeTiers,
  buildCrownGeo,
  buildPineTiers,
  buildCrownWarmup,
  buildTrunkGeo,
  buildVegetation,
  sceneCrowns,
  createVegetationLod,
  setCrownTime,
  TRUNK_H,
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

test("a hedge row is not planted here, a tree row one tree per 9 m", () => {
  // the DLM's hedges are low-vegetation-layer.ts's
  const hedges = buildVegetation({ rows: [row("hedge", 10)], canopy: [] }, ctx);
  expect(instancesIn(hedges.group)).toBe(0);

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
  const lod = createVegetationLod();
  expect(lod([built], new Vector3(5, 100, 0))).toBe(true);
  expect(built.chunks[0].tier).toBe("rich");
  expect(lod([built], new Vector3(5, 100, 0))).toBe(false);
});

test("a pass after a tile left plans the tiles still there, from their own tiers", () => {
  // Two tiles 2 km apart, the camera at the first: its chunk rich, the
  // other's far.
  const near = buildVegetation({ rows: [], canopy: [canopy(5, 12)] }, ctx);
  const far = buildVegetation({ rows: [], canopy: [canopy(2_005, 12)] }, ctx);
  const lod = createVegetationLod();
  expect(lod([near, far], new Vector3(5, 100, 0))).toBe(true);
  expect([near.chunks[0].tier, far.chunks[0].tier]).toEqual(["rich", "far"]);
  // The first tile leaves; between the far tier's in and out distances of
  // the second, it keeps the far tier it has (the state reused for it is
  // its own, not the rich one the first chunk left in that slot).
  expect(lod([far], new Vector3(2_005 + 600, 100, 0))).toBe(false);
  expect(far.chunks[0].tier).toBe("far");
  // Walking up to it, it goes rich.
  expect(lod([far], new Vector3(2_005, 100, 0))).toBe(true);
  expect(far.chunks[0].tier).toBe("rich");
});

test("far away a chunk draws the far crown and no trunks", () => {
  const built = buildVegetation({ rows: [], canopy: [canopy(5, 12)] }, ctx);
  expect(createVegetationLod()([built], new Vector3(5_000, 100, 0))).toBe(true);
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
  // one wind clock for every tile's crowns
  setCrownTime(12.5);
  expect(uniforms.time.value).toBe(12.5);
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

describe("the generic crown's measures", () => {
  test("BASE_TREE_H and GENERIC_CROWN_W are the crown geometry's own", () => {
    const g = buildCrownGeo();
    g.computeBoundingBox();
    const box = g.boundingBox;
    expect(box?.max.y).toBeCloseTo(BASE_TREE_H, 0);
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
    expect(Math.abs(width - GENERIC_CROWN_W)).toBeLessThan(0.3);
    expect(box?.min.y).toBeCloseTo(GENERIC_CROWN_FOOT, 1);
  });
});

describe("a tree's crown base", () => {
  test("its crown spans its base to its top; its trunk stands on the ground", () => {
    const built = buildVegetation({ rows: [], canopy: [canopy(5, 24)] }, ctx);
    const [chunk] = built.chunks;
    const m = new Matrix4();
    chunk.mid.getMatrixAt(0, m);
    const top = new Vector3(0, BASE_TREE_H, 0).applyMatrix4(m).y - 100;
    const foot = new Vector3(0, GENERIC_CROWN_FOOT, 0).applyMatrix4(m).y - 100;
    // the measured 24 m within the 10 % jitter, its crown from 0.438 of it
    expect(top).toBeGreaterThan(21);
    expect(top).toBeLessThan(27);
    expect(foot).toBeCloseTo(crownBase(top), 3);
    // the trunk rides the crown's matrix, its foot lowered by the drop
    expect(chunk.trunks.instanceMatrix).toBe(chunk.mid.instanceMatrix);
    const drop = chunk.trunks.geometry.getAttribute("iDrop")?.getX(0) ?? 0;
    expect(new Vector3(0, -drop, 0).applyMatrix4(m).y).toBeCloseTo(100, 3);
    // … and its top still reaches into the crown
    const trunkTop = new Vector3(0, TRUNK_H, 0).applyMatrix4(m).y - 100;
    expect(trunkTop).toBeGreaterThan(foot);
    expect(trunkTop).toBeLessThan(foot + 0.2 * (top - foot));
    // the trunks' cull sphere still holds the foot on the ground
    const sphere = chunk.trunks.geometry.boundingSphere;
    expect((sphere?.center.y ?? 0) - (sphere?.radius ?? 0)).toBeLessThan(100);
  });
});

test("a canopy evergreen stands as a cone of its own, in leaf all year", () => {
  const pine: CanopyFeature = {
    geometry: { type: "Point", coordinates: [8, 0] },
    properties: { h: 18, l: "e" },
  };
  const built = buildVegetation(
    { rows: [], canopy: [canopy(5, 12), pine] },
    ctx
  );
  // one chunk per form in the same 250 m cell, each with its one tree
  expect(built.chunks).toHaveLength(2);
  const [broad, conifer] = [...built.chunks].sort(
    (a, b) =>
      Number(a.mid.userData.styleCrown === undefined) -
      Number(b.mid.userData.styleCrown === undefined)
  );
  // the cone: its own geometry, the crown's attributes and no index (one
  // node build with the lobed crown's), the scene's crown material
  for (const tier of ["far", "mid", "rich"] as const) {
    const cone = conifer[tier].geometry;
    expect(cone).not.toBe(broad[tier].geometry);
    expect(cone.index).toBeNull();
    expect(broad[tier].geometry.index).toBeNull();
    expect(Object.keys(cone.attributes).sort()).toEqual(
      Object.keys(broad[tier].geometry.attributes).sort()
    );
    expect(conifer[tier].material).toBe(broad[tier].material);
    // a picture style's crowns swap the broadleaves, never the cone
    expect(conifer[tier].userData.styleCrown).toBeUndefined();
    expect(broad[tier].userData.styleCrown).toBe(tier);
  }
  // July is the leafy summer it was built in: nothing to write
  expect(built.setSeason(190)).toBe(false);
  // January: the broadleaf bares in every tier, the evergreen keeps the
  // leafy material
  expect(built.setSeason(9)).toBe(true);
  const { bare } = sceneCrowns();
  for (const tier of ["far", "mid", "rich"] as const) {
    expect(broad[tier].material).toBe(bare);
    expect(conifer[tier].material).not.toBe(bare);
  }
});

test("a canopy pine wears the pine's crown, high on its stem, a chunk of its own", () => {
  const at = (x: number, pine: boolean): CanopyFeature => ({
    geometry: { type: "Point", coordinates: [x, 0] },
    properties: { h: 20, l: "e", ...(pine ? { pine: 1 as const } : {}) },
  });
  const built = buildVegetation(
    { rows: [], canopy: [at(5, false), at(9, true)] },
    ctx
  );
  // a cone and a pine in the same 250 m cell: a chunk per form
  expect(built.chunks).toHaveLength(2);
  const foot = (c: (typeof built.chunks)[number]) => {
    const m = new Matrix4();
    c.mid.getMatrixAt(0, m);
    return {
      foot: new Vector3(0, GENERIC_CROWN_FOOT, 0).applyMatrix4(m).y - 100,
      top: new Vector3(0, BASE_TREE_H, 0).applyMatrix4(m).y - 100,
      drop: c.trunks.geometry.getAttribute("iDrop")?.getX(0) ?? 0,
      m,
    };
  };
  const [cone, pine] = [...built.chunks]
    .map(foot)
    .sort((a, b) => a.foot / a.top - b.foot / b.top);
  // the pine's crown from PINE_CROWN_BASE of its height, the cone's lower
  expect(pine.foot / pine.top).toBeCloseTo(PINE_CROWN_BASE, 3);
  expect(cone.foot / cone.top).toBeLessThan(PINE_CROWN_BASE);
  // its trunk still stands on the ground
  expect(new Vector3(0, -pine.drop, 0).applyMatrix4(pine.m).y).toBeCloseTo(
    100,
    3
  );
  // the pine's own geometry: the crown's attributes, no index, no style's
  // crown, the leafy material all year
  const pineChunk = built.chunks.find((c) => {
    const m = new Matrix4();
    c.mid.getMatrixAt(0, m);
    return m.elements[12] === pine.m.elements[12];
  });
  const coneChunk = built.chunks.find((c) => c !== pineChunk);
  for (const tier of ["far", "mid", "rich"] as const) {
    const g = pineChunk?.[tier].geometry;
    expect(g).not.toBe(coneChunk?.[tier].geometry);
    expect(g?.index).toBeNull();
    expect(Object.keys(g?.attributes ?? {}).sort()).toEqual(
      Object.keys(coneChunk?.[tier].geometry.attributes ?? {}).sort()
    );
    expect(pineChunk?.[tier].userData.styleCrown).toBeUndefined();
  }
  built.setSeason(9);
  expect(pineChunk?.mid.material).not.toBe(sceneCrowns().bare);
});

test("the pine tiers stand in the lobed tiers' boxes", () => {
  const broad = {
    far: buildCrownGeo(1),
    mid: buildCrownGeo(),
    rich: buildCrownGeo(),
    trunk: buildTrunkGeo(),
  };
  const pines = buildPineTiers(broad);
  expect(pines.trunk).toBe(broad.trunk);
  for (const tier of ["far", "mid", "rich"] as const) {
    broad[tier].computeBoundingBox();
    pines[tier].computeBoundingBox();
    const [a, b] = [broad[tier].boundingBox, pines[tier].boundingBox];
    expect(b?.max.y).toBeCloseTo(a?.max.y ?? 0, 1);
    expect(b?.min.y).toBeCloseTo(a?.min.y ?? 0, 1);
    expect(b?.max.y ?? 0).toBeLessThanOrEqual((a?.max.y ?? 0) + 1e-6);
    expect(b?.min.y ?? 0).toBeGreaterThanOrEqual((a?.min.y ?? 0) - 1e-6);
  }
});

test("the cone stands in the lobed crown's box, as tall and as wide", () => {
  const lobed = buildCrownGeo();
  lobed.computeBoundingBox();
  const cones = buildConeTiers({
    far: buildCrownGeo(1),
    mid: lobed,
    rich: lobed,
    trunk: buildTrunkGeo(),
  });
  const box = lobed.boundingBox;
  for (const tier of ["far", "mid", "rich"] as const) {
    const g = cones[tier];
    g.computeBoundingBox();
    const b = g.boundingBox;
    expect(b?.max.y).toBeCloseTo(box?.max.y ?? 0, 5);
    expect(b?.min.y).toBeCloseTo(box?.min.y ?? 0, 5);
    // the widest skirt, give or take its wobble
    const w = Math.max(
      (b?.max.x ?? 0) - (b?.min.x ?? 0),
      (b?.max.z ?? 0) - (b?.min.z ?? 0)
    );
    const lw = Math.max(
      (box?.max.x ?? 0) - (box?.min.x ?? 0),
      (box?.max.z ?? 0) - (box?.min.z ?? 0)
    );
    expect(w / lw).toBeGreaterThan(0.9);
    expect(w / lw).toBeLessThan(1.15);
  }
});
