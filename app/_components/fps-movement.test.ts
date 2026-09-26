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

test("analog input is clamped per axis, then to walking speed", () => {
  const { camera, movement } = rig();
  movement.setAnalog(2, -3); // clamps to (1, -1): full right, full backward
  movement.update(1);
  // The setter clamps each axis to [-1, 1]; the combined vector is then
  // normalised, so a full diagonal still covers WALK_STEP, not WALK_STEP*√2.
  const diagonal = WALK_STEP / Math.SQRT2;
  expect(camera.position.x).toBeCloseTo(diagonal, 5);
  expect(camera.position.z).toBeCloseTo(diagonal, 5);
  expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(
    WALK_STEP,
    5
  );
});

test("diagonal input walks at walking speed, not √2x", () => {
  const { camera, movement } = rig();
  movement.press("KeyW");
  movement.press("KeyD");
  movement.update(1);
  expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(
    WALK_STEP,
    5
  );
  expect(camera.position.x).toBeCloseTo(WALK_STEP / Math.SQRT2, 3);
  expect(camera.position.z).toBeCloseTo(-WALK_STEP / Math.SQRT2, 3);
});

test("stick and key pushing the same way do not stack to double speed", () => {
  const { camera, movement } = rig();
  movement.press("KeyW");
  movement.setAnalog(0, 1);
  movement.update(1);
  expect(camera.position.z).toBeCloseTo(-WALK_STEP, 5);
});

test("sub-unit stick input is not normalised up", () => {
  const { camera, movement } = rig();
  movement.setAnalog(0.5, 0);
  movement.update(1);
  expect(camera.position.x).toBeCloseTo(WALK_STEP / 2, 5);
});

test("releaseAll drops held keys and the stick", () => {
  const { camera, movement } = rig();
  movement.press("KeyW");
  movement.setAnalog(1, 0);
  movement.releaseAll();
  movement.update(1);
  expect(camera.position.x).toBeCloseTo(0, 5);
  expect(camera.position.z).toBeCloseTo(0, 5);
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

test("flying meets the facades too: fly mode applies resolveStep", () => {
  const blocked = rig({ resolveStep: () => new Vector3() });
  blocked.movement.setMode("fly");
  blocked.movement.press("KeyW");
  blocked.movement.update(1);
  expect(blocked.camera.position.z).toBeCloseTo(0, 5);

  const free = rig({ resolveStep: (_position, displacement) => displacement });
  free.movement.setMode("fly");
  free.movement.press("KeyW");
  free.movement.update(1);
  expect(free.camera.position.z).toBeCloseTo(-FLY_STEP, 5);
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
  down.camera.position.y = 100;
  down.movement.setMode("fly");
  down.movement.press("ShiftLeft");
  down.movement.update(1);
  expect(down.camera.position.y).toBeCloseTo(100 - FLY_STEP, 5);

  const walking = rig();
  walking.movement.press("ShiftLeft");
  walking.movement.update(1);
  expect(walking.camera.position.y).toBeCloseTo(EYE, 5);
});

test("E and Q climb and sink like Space and Shift", () => {
  const { camera, movement } = rig();
  camera.position.y = 100;
  movement.setMode("fly");
  movement.press("KeyE");
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(100 + FLY_STEP, 5);
  movement.release("KeyE");
  movement.press("KeyQ");
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(100, 5);
});

test("the altitude stick climbs in proportion and adds to the keys", () => {
  const { camera, movement } = rig();
  camera.position.y = 100;
  movement.setMode("fly");
  movement.setVertical(0.5);
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(100 + FLY_STEP / 2, 5);
  // Stick + key saturate at full speed, not beyond.
  movement.press("Space");
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(100 + FLY_STEP * 1.5, 5);
  movement.releaseAll();
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(100 + FLY_STEP * 1.5, 5);
});

test("sinking in fly mode stops at eye height above the ground", () => {
  const { camera, movement } = rig({ groundHeight: () => 20 });
  camera.position.y = 30;
  movement.setMode("fly");
  movement.setVertical(-1);
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(20 + EYE, 5);
  // Off the terrain there is no floor to stop at.
  const off = rig({ groundHeight: () => null });
  off.camera.position.y = 30;
  off.movement.setMode("fly");
  off.movement.setVertical(-1);
  off.movement.update(1);
  expect(off.camera.position.y).toBeCloseTo(30 - FLY_STEP, 5);
});

test("a pose already below the floor is held, not yanked up", () => {
  const { camera, movement } = rig({ groundHeight: () => 20 });
  camera.position.y = 5;
  movement.setMode("fly");
  movement.press("ShiftLeft");
  movement.update(1);
  expect(camera.position.y).toBeCloseTo(5, 5);
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
