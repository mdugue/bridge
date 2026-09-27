import { expect, test } from "bun:test";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import {
  disposeSharedMaterial,
  isSharedMaterial,
  shareMaterial,
} from "./node-shared";
import { disposeObject3D } from "./three-utils";

function disposals(material: MeshBasicMaterial): () => number {
  let calls = 0;
  material.addEventListener("dispose", () => {
    calls++;
  });
  return () => calls;
}

test("a tile's teardown spares a scene-owned material", () => {
  const material = shareMaterial(new MeshBasicMaterial());
  const calls = disposals(material);
  const geometry = new BoxGeometry();
  let geometryCalls = 0;
  geometry.addEventListener("dispose", () => {
    geometryCalls++;
  });

  disposeObject3D(new Mesh(geometry, material));
  material.dispose(); // as the tile renderer frees a tile's materials

  expect(calls()).toBe(0);
  expect(geometryCalls).toBe(1);
  expect(isSharedMaterial(material)).toBe(true);
});

test("the scene's end frees it, once", () => {
  const material = shareMaterial(new MeshBasicMaterial());
  const calls = disposals(material);

  disposeSharedMaterial(material);

  expect(calls()).toBe(1);
  expect(isSharedMaterial(material)).toBe(false);
});

test("sharing twice keeps the real dispose", () => {
  const material = shareMaterial(shareMaterial(new MeshBasicMaterial()));
  const calls = disposals(material);

  disposeSharedMaterial(material);

  expect(calls()).toBe(1);
});
