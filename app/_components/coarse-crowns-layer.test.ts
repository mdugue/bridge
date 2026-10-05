import { expect, test } from "bun:test";
import { Color, Matrix4, type Object3D, Vector3 } from "three/webgpu";
import {
  coarseCrowns,
  packCrowns,
  unpackCrowns,
} from "@/lib/city/coarse-crowns";
import type { CanopyFeature, TreeFeature } from "@/lib/city/features";
import { inventoryTrees } from "@/lib/city/tree-inventory";
import { canopyPlacements } from "@/lib/city/tree-placement";
import { buildCoarseCrowns } from "./coarse-crowns-layer";
import { type Instances, isInstances } from "./instancing";
import { buildTreeInventory } from "./tree-inventory-layer";
import { buildVegetation, type VegetationContext } from "./vegetation-layer";

const ctx: VegetationContext = {
  offset: { cx: 411_000.37, cy: 5_657_000.81 },
  heightAt: () => 100,
};

const canopy = (x: number, y: number, h: number): CanopyFeature => ({
  geometry: { type: "Point", coordinates: [x, y] },
  properties: { h },
});

const lime = (x: number, y: number): TreeFeature => ({
  geometry: { type: "Point", coordinates: [x, y] },
  properties: { a: 0, d: 9, h: 14, l: "d", gn: 3 },
});

function sets(root: Object3D): Instances[] {
  const out: Instances[] = [];
  root.traverse((o) => {
    if (isInstances(o)) {
      out.push(o);
    }
  });
  return out;
}

/** Every drawn instance's matrix and tint, keyed by where it stands. */
function drawn(list: Instances[]): Map<string, { m: Matrix4; c: Color }> {
  const out = new Map<string, { m: Matrix4; c: Color }>();
  for (const set of list) {
    const tints = set.instanceTints?.array;
    for (let i = 0; i < set.drawCount; i++) {
      const m = set.getMatrixAt(i, new Matrix4());
      const t = new Vector3().setFromMatrixPosition(m);
      const c = tints
        ? new Color(tints[i * 3], tints[i * 3 + 1], tints[i * 3 + 2])
        : new Color(1, 1, 1);
      out.set(`${t.x},${t.z}`, { m, c });
    }
  }
  return out;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the coarse level draws the fine far tier's crowns where it stands them", async () => {
  const points = Array.from({ length: 60 }, (_, i) =>
    canopy(
      411_100 + (i % 10) * 9.3,
      5_656_900 + Math.floor(i / 10) * 8.7,
      6 + (i % 7) * 2
    )
  );
  const register = [
    lime(411_050.5, 5_656_880.25),
    lime(411_060.5, 5_656_870.75),
  ];
  const inventory = buildTreeInventory(register, ctx);
  const fine = buildVegetation(
    {
      rows: [],
      canopy: points,
      keepTree: inventory.keepTree,
      extraTrees: inventory.instances,
    },
    ctx
  );
  const far = drawn(fine.chunks.map((c) => c.far));

  // every tree kept (floor 1): the coarse crowns are the far tier itself
  const crowns = coarseCrowns(
    canopyPlacements(points, ctx, undefined, inventory.keepTree),
    inventoryTrees(register, ctx),
    1
  );
  const packed = packCrowns(crowns);
  let loads = 0;
  const coarse = buildCoarseCrowns(
    () => {
      loads++;
      return Promise.resolve(unpackCrowns(packed.buffer as ArrayBuffer) ?? []);
    },
    {
      compile: () => Promise.resolve(),
      heightAt: () => 100,
      offset: ctx.offset,
      onChange: () => undefined,
      season: () => 190,
    }
  );
  // on foot and in the air nothing loads
  coarse.setTreeShare(1);
  await tick();
  expect(loads).toBe(0);
  expect(coarse.group.visible).toBe(false);
  // Modell thins the trees: the crowns load once and show
  coarse.setTreeShare(0.6);
  coarse.setTreeShare(0.5);
  for (let i = 0; i < 5; i++) {
    await tick();
  }
  expect(loads).toBe(1);
  expect(coarse.group.visible).toBe(true);
  const got = drawn(sets(coarse.group));
  expect(got.size).toBe(far.size);
  for (const [key, { m, c }] of got) {
    const twin = far.get(key);
    expect(twin).toBeDefined();
    // the same matrix to the file's units (scale 1/4096, turn 1/65535)
    const a = m.elements;
    const b = twin?.m.elements ?? [];
    for (let k = 0; k < 16; k++) {
      expect(a[k]).toBeCloseTo(b[k], 2);
    }
    expect(c.r).toBeCloseTo(twin?.c.r ?? 0, 2);
    expect(c.g).toBeCloseTo(twin?.c.g ?? 0, 2);
    expect(c.b).toBeCloseTo(twin?.c.b ?? 0, 2);
  }
  // back on foot they hide
  coarse.setTreeShare(1);
  expect(coarse.group.visible).toBe(false);
});

test("a tile that goes while its crowns load builds nothing", async () => {
  let release: (v: ReturnType<typeof coarseCrowns>) => void = () => undefined;
  const coarse = buildCoarseCrowns(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    {
      compile: () => Promise.resolve(),
      heightAt: () => 0,
      offset: { cx: 0, cy: 0 },
      onChange: () => undefined,
      season: () => 0,
    }
  );
  coarse.setTreeShare(0.4);
  coarse.dispose?.();
  release([{ kind: "canopy", x: 1, z: 1, rot: 0, s: 1, widen: 1 }]);
  await tick();
  expect(coarse.group.children).toHaveLength(0);
  // the share is the scene's: leave it as the other tests find it
  coarse.setTreeShare(1);
});
