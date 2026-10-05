import { expect, test } from "bun:test";
import { Color, Matrix4, type Object3D, Vector3 } from "three/webgpu";
import {
  COARSE_TREE_WIDEN,
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

const column = (m: Matrix4, i: number) =>
  new Vector3().setFromMatrixColumn(m, i).length();

test("a coarse crown stands where its fine tree does, as tall and wider", () => {
  const points = Array.from({ length: 200 }, (_, i) =>
    canopy(
      411_100 + (i % 20) * 9.3,
      5_656_900 + Math.floor(i / 20) * 8.7,
      6 + (i % 7) * 2
    )
  );
  const register = Array.from({ length: 30 }, (_, i) =>
    lime(411_050.5 + i * 7.1, 5_656_880.25)
  );
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
  // the fine level's crowns before any far-tier thinning
  const all = drawn(fine.chunks.map((c) => c.mid));

  const crowns = coarseCrowns(
    canopyPlacements(points, ctx, undefined, inventory.keepTree),
    inventoryTrees(register, ctx)
  );
  const file = unpackCrowns(packCrowns(crowns).buffer as ArrayBuffer) ?? [];
  const coarse = drawn(sets(buildCoarseCrowns(file, ctx).group));
  // a third of them, register and canopy both
  expect(coarse.size).toBeGreaterThan(all.size * 0.2);
  expect(coarse.size).toBeLessThan(all.size * 0.5);
  for (const [key, { m, c }] of coarse) {
    const twin = all.get(key);
    expect(twin).toBeDefined();
    if (!twin) {
      continue;
    }
    // the same height (to the file's units), COARSE_TREE_WIDEN wider
    expect(column(m, 1)).toBeCloseTo(column(twin.m, 1), 2);
    expect(column(m, 0) / column(twin.m, 0)).toBeCloseTo(COARSE_TREE_WIDEN, 2);
    expect(m.elements[13]).toBeCloseTo(twin.m.elements[13], 2);
    // the same colour
    expect(c.r).toBeCloseTo(twin.c.r, 2);
    expect(c.g).toBeCloseTo(twin.c.g, 2);
    expect(c.b).toBeCloseTo(twin.c.b, 2);
  }
});
