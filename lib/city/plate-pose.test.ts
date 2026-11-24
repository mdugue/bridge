/** A settled camera against its snapshot: what counts as not there. */
import { describe, expect, test } from "bun:test";
import { poseFault, turnBetween } from "./plate-pose";
import type { CameraStateJson } from "./snapshot";

const FLY: CameraStateJson = {
  epsg: { x: 412_000, y: 5_656_000 },
  fov: 55,
  headingDeg: 350,
  mode: "fly",
  pitchDeg: -30,
  pos: { x: -800, y: 500, z: 1100 },
};
const WALK: CameraStateJson = {
  ...FLY,
  mode: "walk",
  pos: { x: 5, y: 110, z: 7 },
};
/** `base` with its eye moved. */

const at = (base: CameraStateJson, d: Partial<CameraStateJson["pos"]>) => ({
  ...base,
  pos: { ...base.pos, ...d },
});
const MODEL_VIEW = {
  pivot: { x: -1200, y: 104, z: 367 },
  preset: "iso",
  scale: 2500,
  tiltDeg: 35.26,
  turnDeg: 45,
} satisfies NonNullable<CameraStateJson["model"]>;
const MODEL: CameraStateJson = { ...FLY, model: MODEL_VIEW };
/** `MODEL` with part of its view changed. */
const model = (d: Partial<NonNullable<CameraStateJson["model"]>>) => ({
  ...MODEL,
  model: { ...MODEL_VIEW, ...d },
});

test("turnBetween wraps at north, either way round", () => {
  expect(turnBetween(359.8, 0.1)).toBeCloseTo(0.3, 9);
  expect(turnBetween(0.1, 359.8)).toBeCloseTo(0.3, 9);
  expect(turnBetween(-10, 350)).toBeCloseTo(0, 9);
  expect(turnBetween(90, 270)).toBe(180);
});

describe("poseFault", () => {
  test("the snapshot's own pose is there", () => {
    expect(poseFault(FLY, FLY)).toBeNull();
    expect(poseFault(WALK, WALK)).toBeNull();
    expect(poseFault(MODEL, MODEL)).toBeNull();
  });

  test("the view before, still standing, is not", () => {
    expect(poseFault(FLY, at(FLY, { x: 300 }))).toContain("camera at");
    expect(poseFault(FLY, WALK)).toBe("mode walk, not fly");
  });

  test("Modell is its preset, pivot, scale, turn and tilt", () => {
    expect(poseFault(MODEL, model({ preset: "plan" }))).toBe(
      "Modell plan, not iso"
    );
    expect(
      poseFault(MODEL, model({ pivot: { x: -1200, y: 104, z: 900 } }))
    ).toContain("pivot");
    expect(poseFault(MODEL, model({ scale: 2500 * 1.01 }))).toBeNull();
    expect(poseFault(MODEL, model({ scale: 5000 }))).toBe(
      "Modell's scale 1:5000, not 1:2500"
    );
    expect(poseFault(MODEL, model({ turnDeg: 46 }))).toContain("turned 46°");
    expect(poseFault(MODEL, model({ tiltDeg: 60 }))).toContain("tilted 60°");
    expect(poseFault(MODEL, model({ turnDeg: 45.4, tiltDeg: 35 }))).toBeNull();
  });
});
