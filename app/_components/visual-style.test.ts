import { expect, test } from "bun:test";
import { DataTexture, MeshStandardNodeMaterial } from "three/webgpu";
import { uniform } from "three/tsl";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import {
  applyCityLook,
  createClayMaterial,
  createStyleResources,
  setCityTransparency,
} from "./visual-style";

// The alpha-hash test is part of the built node graph, so these tests watch
// `material.version` (the counter that `needsUpdate` increments) to pin down
// exactly when a rebuild is forced.

const objects = () => ({ rows: 1, texture: new DataTexture() });
const resourcesAt = () => createStyleResources(uniform(0), uniform(1));

test("clay switches to hash-dithered transparency and back", () => {
  const resources = resourcesAt();
  const clay = createClayMaterial(resources, objects());
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

test("transparency is clamped to 0..1 and reaches tiles that land later", () => {
  const resources = resourcesAt();
  setCityTransparency(resources, 2);
  expect(createClayMaterial(resources, objects()).opacity).toBe(0);
  setCityTransparency(resources, -1);
  expect(createClayMaterial(resources, objects()).opacity).toBe(1);
});

test("a disposed tile's material leaves the look fan-out", () => {
  const resources = resourcesAt();
  const clay = createClayMaterial(resources, objects());
  expect(resources.materials.has(clay)).toBe(true);
  clay.dispose();
  expect(resources.materials.has(clay)).toBe(false);
});

test("applyCityLook pushes the building rows into the uniforms and the transparency", () => {
  const resources = resourcesAt();
  const clay = createClayMaterial(resources, objects());
  applyCityLook(resources, {
    ...LOOK_DEFAULTS,
    tint: 0.42,
    roughness: 0.3,
    transparency: 0.5,
  });
  expect(resources.clayDetail.uTint.value).toBe(0.42);
  expect(resources.clayDetail.uRough.value).toBe(0.3);
  expect(clay.opacity).toBeCloseTo(0.5, 5);
  expect(clay.alphaHash).toBe(true);
});

test("the clay shares the scene's night and sky-view nodes", () => {
  const night = uniform(0);
  const skyView = uniform(1);
  const resources = createStyleResources(night, skyView);
  // The sun rig and the terrain's row write these in place — a copy would
  // silently stop driving every tile's clay.
  expect(resources.clayDetail.uNight).toBe(night);
  expect(resources.clayDetail.uSkyView).toBe(skyView);
});

test("a tile's clay is a node material with the facade detail wired", () => {
  const clay = createClayMaterial(resourcesAt(), objects());
  expect(clay).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(clay.colorNode).not.toBeNull();
  expect(clay.normalNode).not.toBeNull();
  expect(clay.roughnessNode).not.toBeNull();
  expect(clay.emissiveNode).not.toBeNull();
  expect(clay.aoNode).not.toBeNull();
});
