import { expect, test } from "bun:test";
import {
  BoxGeometry,
  type BufferGeometry,
  type Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from "three";
import { disposeObject3D } from "./three-utils";

/** Counts three's "dispose" events, which `.dispose()` dispatches. */
function countDisposals(resource: BufferGeometry | Material): () => number {
  let calls = 0;
  resource.addEventListener("dispose", () => {
    calls += 1;
  });
  return () => calls;
}

function shared(material: Material): Material {
  material.userData.shared = true;
  return material;
}

test("disposes the geometry and material of a nested mesh", () => {
  const geometry = new BoxGeometry();
  const material = new MeshBasicMaterial();
  const geometryCalls = countDisposals(geometry);
  const materialCalls = countDisposals(material);
  const group = new Object3D();
  group.add(new Mesh(geometry, material));

  disposeObject3D(group);

  expect(geometryCalls()).toBe(1);
  expect(materialCalls()).toBe(1);
});

test("spares a shared material but still frees its geometry", () => {
  const geometry = new BoxGeometry();
  const material = shared(new MeshBasicMaterial());
  const geometryCalls = countDisposals(geometry);
  const materialCalls = countDisposals(material);

  disposeObject3D(new Mesh(geometry, material));

  expect(geometryCalls()).toBe(1);
  expect(materialCalls()).toBe(0);
});

test("walks material arrays and skips only the shared entries", () => {
  const plain = new MeshBasicMaterial();
  const sharedMaterial = shared(new MeshBasicMaterial());
  const plainCalls = countDisposals(plain);
  const sharedCalls = countDisposals(sharedMaterial);

  disposeObject3D(new Mesh(new BoxGeometry(), [plain, sharedMaterial]));

  expect(plainCalls()).toBe(1);
  expect(sharedCalls()).toBe(0);
});

test("two meshes sharing one material dispose without throwing", () => {
  const material = new MeshBasicMaterial();
  const calls = countDisposals(material);
  const group = new Object3D();
  group.add(new Mesh(new BoxGeometry(), material));
  group.add(new Mesh(new BoxGeometry(), material));

  expect(() => disposeObject3D(group)).not.toThrow();
  expect(calls()).toBeGreaterThanOrEqual(1);
});

test("a bare Object3D is traversed without throwing", () => {
  expect(() => disposeObject3D(new Object3D())).not.toThrow();
});

test("frees the loader material stashed by applyCityStyle", () => {
  const original = new MeshBasicMaterial();
  const styleMaterial = shared(new MeshBasicMaterial());
  const originalCalls = countDisposals(original);
  const styleCalls = countDisposals(styleMaterial);
  const mesh = new Mesh(new BoxGeometry(), styleMaterial);
  mesh.userData.originalMaterial = original;

  disposeObject3D(mesh);

  expect(originalCalls()).toBe(1);
  expect(styleCalls()).toBe(0);
});
