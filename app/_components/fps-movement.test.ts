import { expect, test } from "bun:test";
import { PerspectiveCamera, Vector3 } from "three";
import { createFpsMovement, type FpsMovementOptions } from "./fps-movement";

const EYE = 1.7;
/** WALK_SPEED in fps-movement.ts — one second of input equals this many metres. */
const WALK_STEP = 9;
const SPRINT_STEP = 27;
const FLY_STEP = 35;

function rig(overrides: Partial<FpsMovementOptions> = {}) {
  const camera = new PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(0, EYE, 0);
  camera.lookAt(0, EYE, -100); // facing -Z
  const movement = createFpsMovement(camera, {
    eyeHeight: EYE,
    groundHeight: () => 0,
    ...overrides,
  });
  return { camera, movement };
}

test("W walks one second forward along -Z", () => {
  const { camera, movement } = rig();
  movement.press("KeyW");
  movement.update(1);
  expect(camera.position.z).toBeCloseTo(-WALK_STEP, 5);
  expect(camera.position.x).toBeCloseTo(0, 5);
  expect(camera.position.y).toBeCloseTo(EYE, 5);
});

test("S, D and A move back, right and left", () => {
  const back = rig();
  back.movement.press("KeyS");
  back.movement.update(1);
  expect(back.camera.position.z).toBeCloseTo(WALK_STEP, 5);

  const rightward = rig();
  rightward.movement.press("KeyD");
  rightward.movement.update(1);
  expect(rightward.camera.position.x).toBeCloseTo(WALK_STEP, 5);

  const leftward = rig();
  leftward.movement.press("KeyA");
  leftward.movement.update(1);
  expect(leftward.camera.position.x).toBeCloseTo(-WALK_STEP, 5);
});

test("Shift sprints at three times walking speed", () => {
  const { camera, movement } = rig();
  movement.press("KeyW");
  movement.press("ShiftLeft");
  movement.update(1);
  expect(camera.position.z).toBeCloseTo(-SPRINT_STEP, 5);
});

test("opposing keys cancel out", () => {
  const { camera, movement } = rig();
  movement.press("KeyW");
  movement.press("KeyS");
  movement.update(1);
  expect(camera.position.x).toBeCloseTo(0, 5);
  expect(camera.position.z).toBeCloseTo(0, 5);
});

test("analog input is clamped to the unit square", () => {
  const { camera, movement } = rig();
  movement.setAnalog(2, -3); // clamps to (1, -1): full right, full backward
  movement.update(1);
  expect(camera.position.x).toBeCloseTo(WALK_STEP, 5);
  expect(camera.position.z).toBeCloseTo(WALK_STEP, 5);
});

test("releasing a key stops the movement", () => {
  const { camera, movement } = rig();
  movement.press("KeyW");
  movement.release("KeyW");
  movement.update(1);
  expect(camera.position.z).toBeCloseTo(0, 5);
});

test("walk mode applies exactly what resolveStep returns", () => {
  const blocked = rig({ resolveStep: () => new Vector3() });
  blocked.movement.press("KeyW");
  blocked.movement.update(1);
  expect(blocked.camera.position.x).toBeCloseTo(0, 5);
  expect(blocked.camera.position.z).toBeCloseTo(0, 5);

  const proposals: Vector3[] = [];
  const spied = rig({
    resolveStep: (_position, displacement) => {
      // The argument is a shared, mutated instance — never keep the reference.
      proposals.push(displacement.clone());
      return displacement;
    },
  });
  spied.movement.press("KeyW");
  spied.movement.update(1);
  expect(proposals).toHaveLength(1);
  expect(proposals[0]?.z).toBeCloseTo(-WALK_STEP, 5);
});

test("off the terrain the eye height is held, not dropped", () => {
  const { camera, movement } = rig({ groundHeight: () => null });
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(EYE, 5);
});

test("fly mode moves vertically with Space and Shift", () => {
  const up = rig();
  up.movement.setMode("fly");
  up.movement.press("Space");
  up.movement.update(1);
  expect(up.camera.position.y).toBeCloseTo(EYE + FLY_STEP, 5);

  const down = rig();
  down.movement.setMode("fly");
  down.movement.press("ShiftLeft");
  down.movement.update(1);
  expect(down.camera.position.y).toBeCloseTo(EYE - FLY_STEP, 5);

  const walking = rig();
  walking.movement.press("ShiftLeft");
  walking.movement.update(1);
  expect(walking.camera.position.y).toBeCloseTo(EYE, 5);
});

test("snapToGround sets the eye height without smoothing", () => {
  const { camera, movement } = rig({ groundHeight: () => 50 });
  expect(movement.getMode()).toBe("walk");
  movement.snapToGround();
  // Exactly ground + eyeHeight: no approachHeight smoothing on a snap.
  expect(camera.position.y).toBe(50 + EYE);
  movement.setMode("fly");
  expect(movement.getMode()).toBe("fly");
});
