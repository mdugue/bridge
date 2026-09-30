import { expect, test } from "bun:test";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { buildVineyards, vineInstances } from "./cultivated-layer";
import { Instances } from "./instancing";
import { disposeObject3D, retainSceneMaterials } from "./three-utils";

const flat = { offset: { cx: 100, cy: 200 }, heightAt: () => 110 };

test("a vine row is a chain of boxes along it, on the ground", () => {
  const items = vineInstances(
    [
      [
        [100, 200],
        [110, 200],
      ],
    ],
    flat
  );
  // ≤ 2.5 m pieces: 10 m → 4
  expect(items).toHaveLength(4);
  for (const p of items) {
    expect(p.rot).toBeCloseTo(0, 9); // east
    expect(p.z).toBeCloseTo(0, 9); // world z = −(y − cy)
    expect(p.y).toBeLessThan(110); // sunk into the ground
  }
  expect(items.map((p) => p.x)).toEqual([1.25, 3.75, 6.25, 8.75]);
});

test("rows off the terrain are skipped; no rows, an empty group", () => {
  const off = { offset: flat.offset, heightAt: () => null };
  expect(
    vineInstances(
      [
        [
          [0, 0],
          [5, 0],
        ],
      ],
      off
    )
  ).toHaveLength(0);
  expect(buildVineyards([], flat).children).toHaveLength(0);
});

const twoRows = [
  [
    [100, 200],
    [110, 200],
  ],
  [
    [900, 200],
    [905, 200],
  ],
] as [number, number][][];

test("vine rows are chunked instance sets that cast shadows", () => {
  const release = retainSceneMaterials();
  const group = buildVineyards(twoRows, flat);
  const sets = group.children as Instances[];
  expect(sets.length).toBe(2); // two 250 m cells
  expect(sets.every((m) => m instanceof Instances && m.castShadow)).toBe(true);
  // 10 m → 4 boxes, 5 m → 2, each tinted
  expect(sets.map((m) => m.drawCount).toSorted((a, b) => a - b)).toEqual([
    2, 4,
  ]);
  expect(sets.every((m) => m.instanceTints !== null)).toBe(true);
  expect(sets.every((m) => m.geometry.boundingSphere !== null)).toBe(true);
  disposeObject3D(group);
  release();
});

test("every tile's vines wear one scene material with the instance nodes", () => {
  const release = retainSceneMaterials();
  const a = buildVineyards(twoRows, flat).children[0] as Instances;
  const b = buildVineyards(twoRows, flat).children[1] as Instances;
  const material = a.material as MeshStandardNodeMaterial;
  expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(b.material).toBe(material);
  expect(material.userData.shared).toBe(true);
  // the instance transform and tint are applied in the node
  expect(material.positionNode).not.toBeNull();
  expect(material.colorNode).not.toBeNull();
  // disposing a tile keeps the shared material
  let disposed = false;
  material.addEventListener("dispose", () => {
    disposed = true;
  });
  disposeObject3D(a);
  expect(disposed).toBe(false);
  release();
});
