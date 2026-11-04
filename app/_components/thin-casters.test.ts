import { expect, test } from "bun:test";
import { Matrix4, Vector3 } from "three/webgpu";
import {
  setThinCasterMap,
  sunAcross,
  sunMapMatrix,
  sunMapTexels,
  thinCasterReach,
} from "./thin-casters";

test("the thin casters read the map the sun last drew", () => {
  const matrix = new Matrix4().makeScale(2, 3, 4);
  setThinCasterMap(
    matrix,
    3072,
    new Vector3(-0.45, 0.6, 0.66).normalize(),
    true
  );
  expect(sunMapMatrix.value.equals(matrix)).toBe(true);
  // a copy: the light's matrix moving on does not move the casters'
  matrix.makeScale(1, 1, 1);
  expect(sunMapMatrix.value.equals(matrix)).toBe(false);
  expect(sunMapTexels.value).toBe(3072);
});

test("a caster widens level and across the sun", () => {
  const sun = new Vector3(-0.45, 0.6, 0.66).normalize();
  setThinCasterMap(new Matrix4(), 2048, sun, true);
  const across = sunAcross.value;
  expect(across.y).toBe(0);
  expect(across.length()).toBeCloseTo(1, 6);
  expect(across.dot(sun)).toBeCloseTo(0, 6);
  // the sun overhead: still a level unit axis
  setThinCasterMap(new Matrix4(), 2048, new Vector3(0, 1, 0), true);
  expect(sunAcross.value.length()).toBeCloseTo(1, 6);
  expect(sunAcross.value.y).toBe(0);
});

test("only the warped map widens a caster", () => {
  const sun = new Vector3(-0.45, 0.6, 0.66).normalize();
  setThinCasterMap(new Matrix4(), 3072, sun, true);
  expect(thinCasterReach.value).toBeGreaterThan(0);
  setThinCasterMap(new Matrix4(), 3072, sun, false);
  expect(thinCasterReach.value).toBe(0);
});
