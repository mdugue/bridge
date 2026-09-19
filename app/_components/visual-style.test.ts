import { expect, test } from "bun:test";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import {
  applyCityStyle,
  createStyleResources,
  setCityTransparency,
} from "./visual-style";

// three bakes the alpha-hash code path into the compiled program, so these
// tests watch `material.version` (the counter that `needsUpdate` increments)
// to pin down exactly when a recompile is forced.

test("clay switches to hash-dithered transparency and back", () => {
  const resources = createStyleResources();
  const clay = resources.clay;
  const before = clay.version;

  setCityTransparency(resources, 0.5);
  expect(clay.opacity).toBeCloseTo(0.5, 5);
  expect(clay.alphaHash).toBe(true);
  expect(clay.transparent).toBe(false);
  expect(clay.version).toBe(before + 1);

  setCityTransparency(resources, 0.8);
  expect(clay.opacity).toBeCloseTo(0.2, 5);
  expect(clay.version).toBe(before + 1);

  setCityTransparency(resources, 0);
  expect(clay.alphaHash).toBe(false);
  expect(clay.opacity).toBeCloseTo(1, 5);
  expect(clay.version).toBe(before + 2);
});

test("transparency is clamped to 0..1", () => {
  const resources = createStyleResources();
  setCityTransparency(resources, 2);
  expect(resources.clay.opacity).toBe(0);
  setCityTransparency(resources, -1);
  expect(resources.clay.opacity).toBe(1);
});

test("the clay material is flagged shared so disposeObject3D spares it", () => {
  expect(createStyleResources().clay.userData.shared).toBe(true);
});

test("clay detail uniforms are live references the HUD can retune", () => {
  const resources = createStyleResources();
  // The sliders mutate these objects in place — a copy would silently stop
  // driving the compiled shader.
  resources.clayDetail.uTint.value = 0.42;
  expect(resources.clayDetail.uTint.value).toBe(0.42);
  expect(resources.clayDetail.uRoofTint).toBeDefined();
  expect(resources.clayDetail.uDuskGlow).toBeDefined();
});

/** A loader-shaped mesh: the flag applyCityStyle keys on. */
function cityMesh(material: MeshBasicMaterial): Mesh {
  const mesh = new Mesh(new BoxGeometry(), material);
  (mesh as Mesh & { isCityObjectMesh?: boolean }).isCityObjectMesh = true;
  return mesh;
}

test("applyCityStyle dresses city meshes and frees the loader's material", () => {
  const resources = createStyleResources();
  const loaderMaterial = new MeshBasicMaterial();
  let disposals = 0;
  loaderMaterial.addEventListener("dispose", () => {
    disposals += 1;
  });
  const group = new Group();
  // Two meshes sharing one loader material: it must be disposed exactly once.
  group.add(cityMesh(loaderMaterial), cityMesh(loaderMaterial));

  applyCityStyle(group, resources);

  for (const child of group.children) {
    expect((child as Mesh).material).toBe(resources.clay);
  }
  expect(disposals).toBe(1);
});

test("applyCityStyle leaves non-city meshes alone and is idempotent", () => {
  const resources = createStyleResources();
  const plain = new MeshBasicMaterial();
  let disposals = 0;
  plain.addEventListener("dispose", () => {
    disposals += 1;
  });
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(), plain));

  applyCityStyle(group, resources);
  expect((group.children[0] as Mesh).material).toBe(plain);

  // A second pass over already-dressed meshes must not dispose the shared
  // clay material (it would recompile the program on the next frame).
  const dressed = new Group();
  dressed.add(cityMesh(new MeshBasicMaterial()));
  applyCityStyle(dressed, resources);
  applyCityStyle(dressed, resources);
  expect(resources.clay.version).toBe(0);
  expect(disposals).toBe(0);
});
