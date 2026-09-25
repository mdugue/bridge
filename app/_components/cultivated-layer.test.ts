import { expect, test } from "bun:test";
import { InstancedMesh } from "three";
import { buildVineyards, vineInstances } from "./cultivated-layer";
import { disposeObject3D } from "./three-utils";

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

test("vine rows are chunked instanced meshes that cast shadows", () => {
  const group = buildVineyards(
    [
      [
        [100, 200],
        [110, 200],
      ],
      [
        [900, 200],
        [905, 200],
      ],
    ],
    flat
  );
  const meshes = group.children as InstancedMesh[];
  expect(meshes.length).toBe(2); // two 250 m cells
  expect(meshes.every((m) => m instanceof InstancedMesh && m.castShadow)).toBe(
    true
  );
  disposeObject3D(group);
});
