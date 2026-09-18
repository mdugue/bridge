import { expect, test } from "bun:test";
import {
  createStyleResources,
  DEFAULT_GHOST_TRANSPARENCY,
  setCityTransparency,
} from "./visual-style";

// three bakes the transmission / alpha-hash code paths into the compiled
// program, so these tests watch `material.version` (the counter that
// `needsUpdate` increments) to pin down exactly when a recompile is forced.

test("ghost transmission follows the transparency without a recompile", () => {
  const resources = createStyleResources();
  expect(resources.ghost.transmission).toBe(DEFAULT_GHOST_TRANSPARENCY);
  const before = resources.ghost.version;
  setCityTransparency(resources, "ghost", 0.6);
  expect(resources.ghost.transmission).toBe(0.6);
  expect(resources.ghost.version).toBe(before);
});

test("ghost recompiles when transmission crosses zero in either direction", () => {
  const resources = createStyleResources();
  const offSolid = resources.ghost.version;
  setCityTransparency(resources, "ghost", 0);
  expect(resources.ghost.transmission).toBe(0);
  // Only "a recompile was forced" is asserted, not by how much `version`
  // moved: three's own `transmission` setter already bumps it on the zero
  // crossing, so setCityTransparency's needsUpdate is a second bump.
  const wentSolid = resources.ghost.version;
  expect(wentSolid).toBeGreaterThan(offSolid);
  setCityTransparency(resources, "ghost", 0.4);
  expect(resources.ghost.transmission).toBe(0.4);
  expect(resources.ghost.version).toBeGreaterThan(wentSolid);
});

test("clay switches to hash-dithered transparency and back", () => {
  const resources = createStyleResources();
  const clay = resources.clay;
  const before = clay.version;

  setCityTransparency(resources, "clay", 0.5);
  expect(clay.opacity).toBeCloseTo(0.5, 5);
  expect(clay.alphaHash).toBe(true);
  expect(clay.transparent).toBe(false);
  expect(clay.version).toBe(before + 1);

  setCityTransparency(resources, "clay", 0.8);
  expect(clay.opacity).toBeCloseTo(0.2, 5);
  expect(clay.version).toBe(before + 1);

  setCityTransparency(resources, "clay", 0);
  expect(clay.alphaHash).toBe(false);
  expect(clay.opacity).toBeCloseTo(1, 5);
  expect(clay.version).toBe(before + 2);
});

test("transparency is clamped to 0..1", () => {
  const resources = createStyleResources();
  setCityTransparency(resources, "ghost", -1);
  expect(resources.ghost.transmission).toBe(0);
  setCityTransparency(resources, "ghost", 2);
  expect(resources.ghost.transmission).toBe(1);
  setCityTransparency(resources, "clay", 2);
  expect(resources.clay.opacity).toBe(0);
  setCityTransparency(resources, "clay", -1);
  expect(resources.clay.opacity).toBe(1);
});

test("the standard style owns no transparency of its own", () => {
  const resources = createStyleResources();
  const transmission = resources.ghost.transmission;
  const opacity = resources.clay.opacity;
  setCityTransparency(resources, "standard", 0.5);
  expect(resources.ghost.transmission).toBe(transmission);
  expect(resources.clay.opacity).toBe(opacity);
});

test("style materials are flagged shared so disposeObject3D spares them", () => {
  const resources = createStyleResources();
  expect(resources.ghost.userData.shared).toBe(true);
  expect(resources.clay.userData.shared).toBe(true);
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
