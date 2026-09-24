import { expect, test } from "bun:test";
import { DataTexture } from "three";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import {
  applyCityLook,
  createClayMaterial,
  createStyleResources,
  setCityTransparency,
} from "./visual-style";

// three bakes the alpha-hash code path into the compiled program, so these
// tests watch `material.version` (the counter that `needsUpdate` increments)
// to pin down exactly when a recompile is forced.

const objects = () => ({ rows: 1, texture: new DataTexture() });

test("clay switches to hash-dithered transparency and back", () => {
  const resources = createStyleResources();
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
  const resources = createStyleResources();
  setCityTransparency(resources, 2);
  expect(createClayMaterial(resources, objects()).opacity).toBe(0);
  setCityTransparency(resources, -1);
  expect(createClayMaterial(resources, objects()).opacity).toBe(1);
});

test("a disposed tile's material leaves the look fan-out", () => {
  const resources = createStyleResources();
  const clay = createClayMaterial(resources, objects());
  expect(resources.materials.has(clay)).toBe(true);
  clay.dispose();
  expect(resources.materials.has(clay)).toBe(false);
});

test("applyCityLook pushes the building rows into the uniforms and the transparency", () => {
  const resources = createStyleResources();
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

test("clay detail uniforms are live references the HUD can retune", () => {
  const resources = createStyleResources();
  // The sliders mutate these objects in place — a copy would silently stop
  // driving the compiled shader.
  resources.clayDetail.uTint.value = 0.42;
  expect(resources.clayDetail.uTint.value).toBe(0.42);
  expect(resources.clayDetail.uRoofTint).toBeDefined();
  expect(resources.clayDetail.uDuskGlow).toBeDefined();
});
