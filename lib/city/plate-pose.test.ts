/** A settled camera against its snapshot: what counts as not there. */
import { describe, expect, test } from "bun:test";
import { POSE_SLACK, poseFault, turnBetween } from "./plate-pose";
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

  test("each axis has its slack, and no more", () => {
    const { m } = POSE_SLACK;
    for (const axis of ["x", "y", "z"] as const) {
      expect(poseFault(FLY, at(FLY, { [axis]: FLY.pos[axis] + m }))).toBeNull();
      expect(
        poseFault(FLY, at(FLY, { [axis]: FLY.pos[axis] - m - 0.01 }))
      ).not.toBeNull();
    }
  });

  test("the walker's eye may settle onto the ground, not wander", () => {
    const { eyeM, m } = POSE_SLACK;
    expect(poseFault(WALK, at(WALK, { y: WALK.pos.y - eyeM }))).toBeNull();
    expect(
      poseFault(WALK, at(WALK, { y: WALK.pos.y + eyeM + 0.01 }))
    ).not.toBeNull();
    expect(
      poseFault(WALK, at(WALK, { x: WALK.pos.x + m + 0.01 }))
    ).not.toBeNull();
    // (flying has no such room)
    expect(poseFault(FLY, at(FLY, { y: FLY.pos.y + eyeM }))).not.toBeNull();
  });

  test("heading and pitch", () => {
    const { deg } = POSE_SLACK;
    expect(poseFault(FLY, { ...FLY, headingDeg: 350 + deg - 360 })).toBeNull();
    expect(poseFault(FLY, { ...FLY, headingDeg: 351 })).not.toBeNull();
    expect(poseFault(FLY, { ...FLY, pitchDeg: -30 - deg })).toBeNull();
    expect(poseFault(FLY, { ...FLY, pitchDeg: -29 })).not.toBeNull();
  });

  test("Modell on one side only", () => {
    expect(poseFault(MODEL, FLY)).toBe("Modell off, not iso");
    expect(poseFault(FLY, MODEL)).toBe("Modell iso, not off");
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

  test("in Modell the eye is the rig's: it is not compared", () => {
    expect(poseFault(MODEL, at(MODEL, { x: 9999, y: 9 }))).toBeNull();
  });
});
