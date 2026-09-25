import { expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import { EYE_HEIGHT, PITCH_LIMIT, RAD2DEG } from "@/lib/city/pose";
import { type CameraPoseOptions, createCameraPose } from "./camera-pose";
import type { MovementMode } from "./fps-movement";
import type { Viewpoint } from "@/lib/city/site";

const OFFSET = { cx: 412_000, cy: 5_657_000 };
const GROUND = 100;

const VIEW: Viewpoint = {
  id: "test",
  label: "Test",
  description: "",
  mode: "walk",
  epsg: { x: 412_300, y: 5_657_200 },
  aboveGround: EYE_HEIGHT,
  headingDeg: 90,
  pitchDeg: 0,
  fov: 62,
};

function rig(overrides: Partial<CameraPoseOptions> = {}) {
  const camera = new PerspectiveCamera(55, 1, 0.3, 6000);
  const modes: MovementMode[] = [];
  const poses: number[] = [];
  const pose = createCameraPose(camera, {
    groundFloor: () => GROUND - 20,
    heightAt: () => GROUND,
    offset: OFFSET,
    onModeChange: (m) => modes.push(m),
    onPose: (p) => poses.push(p.epsgX),
    ...overrides,
  });
  pose.teleportTo(OFFSET.cx, OFFSET.cy);
  return { camera, modes, pose, poses };
}

/** Runs the loop until nothing moves any more (a glide lands in < 4 s). */
function settle(pose: ReturnType<typeof rig>["pose"]) {
  for (let i = 0; i < 300; i += 1) {
    pose.step(1 / 60);
  }
}

test("the spawn stands at the recenter point, on the ground, facing north", () => {
  const { camera, pose, poses } = rig();
  expect(camera.position.x).toBeCloseTo(0, 10);
  expect(camera.position.z).toBeCloseTo(0, 10);
  expect(camera.position.y).toBeCloseTo(GROUND + EYE_HEIGHT, 10);
  const p = pose.getPose();
  expect(p.epsgX).toBe(OFFSET.cx);
  expect(p.epsgY).toBe(OFFSET.cy);
  expect(p.heading).toBeCloseTo(0, 10);
  expect(poses).toEqual([OFFSET.cx]);
});

test("teleport levels the view, keeps the heading and falls back to the floor off the DGM", () => {
  const { camera, pose } = rig({
    heightAt: (x) => (x > 412_500 ? null : GROUND),
  });
  pose.applyCameraState({
    mode: "fly",
    pos: { x: 0, y: 300, z: 0 },
    epsg: { x: 0, y: 0 },
    headingDeg: 120,
    pitchDeg: -60,
    fov: 55,
  });
  pose.teleportTo(412_200, 5_657_100);
  const s = pose.getCameraState();
  expect(s.headingDeg).toBeCloseTo(120, 6);
  expect(s.pitchDeg).toBeCloseTo(0, 6);
  expect(camera.position.y).toBeCloseTo(GROUND + EYE_HEIGHT, 10);
  expect(s.epsg).toEqual({ x: 412_200, y: 5_657_100 });

  pose.teleportTo(412_800, 5_657_100);
  expect(camera.position.y).toBeCloseTo(GROUND - 20 + EYE_HEIGHT, 10);
});

test("a camera state round-trips through apply and capture", () => {
  const { pose, modes } = rig();
  const target = {
    mode: "fly" as const,
    pos: { x: 120, y: 180, z: -40 },
    epsg: { x: 0, y: 0 },
    headingDeg: -150,
    pitchDeg: -22,
    fov: 48,
  };
  pose.applyCameraState(target);
  const s = pose.getCameraState();
  expect(s.mode).toBe("fly");
  expect(s.pos).toEqual(target.pos);
  expect(s.epsg).toEqual({ x: OFFSET.cx + 120, y: OFFSET.cy + 40 });
  expect(s.headingDeg).toBeCloseTo(target.headingDeg, 6);
  expect(s.pitchDeg).toBeCloseTo(target.pitchDeg, 6);
  expect(s.fov).toBe(48);
  expect(modes.at(-1)).toBe("fly");
});

test("a walk-mode state lands where it says and stays on the ground", () => {
  const { camera, pose } = rig();
  pose.applyCameraState({
    mode: "walk",
    pos: { x: 50, y: GROUND + EYE_HEIGHT, z: -30 },
    epsg: { x: 0, y: 0 },
    headingDeg: 10,
    pitchDeg: -5,
    fov: 0,
  });
  // fov <= 0 keeps the current FOV (older snapshots carry none).
  expect(camera.fov).toBe(55);
  pose.step(1 / 60);
  expect(pose.getMode()).toBe("walk");
  expect(camera.position.x).toBeCloseTo(50, 10);
  expect(camera.position.z).toBeCloseTo(-30, 10);
  expect(camera.position.y).toBeCloseTo(GROUND + EYE_HEIGHT, 6);
});

test("pitch is clamped at every entry, so a drag never snaps the view", () => {
  const { pose } = rig();
  pose.applyCameraState({
    mode: "fly",
    pos: { x: 0, y: 300, z: 0 },
    epsg: { x: 0, y: 0 },
    headingDeg: 0,
    pitchDeg: -89,
    fov: 55,
  });
  expect(pose.getCameraState().pitchDeg).toBeCloseTo(-PITCH_LIMIT * RAD2DEG, 4);
  pose.flyToViewpoint({ ...VIEW, pitchDeg: 89 });
  settle(pose);
  expect(pose.getCameraState().pitchDeg).toBeCloseTo(PITCH_LIMIT * RAD2DEG, 4);
});

test("a scenic glide lands on the viewpoint in its mode", () => {
  const { camera, pose, modes } = rig();
  pose.flyToViewpoint(VIEW);
  expect(pose.getMode()).toBe("fly");
  settle(pose);
  const s = pose.getCameraState();
  expect(s.mode).toBe("walk");
  expect(modes.at(-1)).toBe("walk");
  expect(s.epsg.x).toBeCloseTo(VIEW.epsg.x, 6);
  expect(s.epsg.y).toBeCloseTo(VIEW.epsg.y, 6);
  expect(s.headingDeg).toBeCloseTo(90, 6);
  expect(s.fov).toBeCloseTo(62, 6);
  expect(camera.position.y).toBeCloseTo(GROUND + EYE_HEIGHT, 6);
});

test("a drag mid-glide takes the wheel: the glide stops where it is", () => {
  const { camera, pose } = rig();
  pose.flyToViewpoint(VIEW);
  pose.step(0.5);
  const midway = camera.position.clone();
  pose.turn(40, 0);
  const headingAfterDrag = pose.getPose().heading;
  settle(pose);
  // Still in fly mode (the pending walk landing was dropped with the glide),
  // so the position holds and the drag's heading survives.
  expect(pose.getMode()).toBe("fly");
  expect(camera.position.distanceTo(midway)).toBeLessThan(1e-9);
  expect(pose.getPose().heading).toBeCloseTo(headingAfterDrag, 10);
  expect(headingAfterDrag * RAD2DEG).toBeLessThan(90);
});

test("a movement key or the stick cancels the glide; other keys and a centred stick do not", () => {
  const quiet = rig();
  quiet.pose.flyToViewpoint(VIEW);
  quiet.pose.press("KeyR");
  quiet.pose.setMoveInput(0, 0);
  settle(quiet.pose);
  expect(quiet.pose.getMode()).toBe("walk");

  const keyed = rig();
  keyed.pose.flyToViewpoint(VIEW);
  keyed.pose.step(0.2);
  keyed.pose.press("KeyW");
  keyed.pose.release("KeyW");
  settle(keyed.pose);
  expect(keyed.pose.getMode()).toBe("fly");

  const stick = rig();
  stick.pose.flyToViewpoint(VIEW);
  stick.pose.step(0.2);
  stick.pose.setMoveInput(0, 0.5);
  stick.pose.releaseAll();
  settle(stick.pose);
  expect(stick.pose.getMode()).toBe("fly");
});

test("a mode switch mid-glide is the player's choice, not the viewpoint's", () => {
  const { pose } = rig();
  pose.flyToViewpoint(VIEW);
  pose.step(0.2);
  pose.setMovementMode("walk");
  const grounded = pose.getCameraState();
  settle(pose);
  expect(pose.getMode()).toBe("walk");
  expect(pose.getCameraState().epsg.x).toBeCloseTo(grounded.epsg.x, 6);
});

test("toggleMode flips walk and fly and reports each change", () => {
  const { pose, modes } = rig();
  pose.toggleMode();
  expect(pose.getMode()).toBe("fly");
  pose.toggleMode();
  expect(pose.getMode()).toBe("walk");
  expect(modes).toEqual(["fly", "walk"]);
});

test("grab-look turns left when dragging right, mouse-look follows the mouse, both clamp the pitch", () => {
  const { pose } = rig();
  pose.turn(100, 0);
  expect(pose.getPose().heading).toBeLessThan(0);
  pose.look(200, 0);
  expect(pose.getPose().heading).toBeGreaterThan(0);
  pose.turn(0, 100_000);
  expect(pose.getCameraState().pitchDeg).toBeCloseTo(PITCH_LIMIT * RAD2DEG, 4);
  pose.look(0, 100_000);
  expect(pose.getCameraState().pitchDeg).toBeCloseTo(-PITCH_LIMIT * RAD2DEG, 4);
});

test("pinch zoom is relative to the FOV at its start, wheel zoom to the current one, and both take the wheel", () => {
  const { camera, pose } = rig();
  pose.beginZoom();
  pose.zoomTo(1.25);
  pose.zoomTo(1.1);
  expect(camera.fov).toBeCloseTo(50, 10);
  pose.zoomBy(1.25);
  expect(camera.fov).toBeCloseTo(40, 10);

  pose.flyToViewpoint(VIEW);
  pose.step(0.2);
  // The glide has begun easing the FOV towards the viewpoint's 62.
  const midGlide = camera.fov;
  pose.zoomBy(1.1);
  settle(pose);
  expect(pose.getMode()).toBe("fly");
  expect(camera.fov).toBeCloseTo(midGlide / 1.1, 10);
});

test("flyTo drops the camera at a world position in fly mode, facing the target", () => {
  const { camera, pose, poses } = rig();
  pose.flyTo({ x: 10, y: 250, z: 10 }, { x: 10, y: 100, z: 110 });
  expect(pose.getMode()).toBe("fly");
  expect(camera.position.y).toBe(250);
  expect(poses).toEqual([OFFSET.cx, OFFSET.cx + 10]);
  const s = pose.getCameraState();
  expect(Math.abs(s.headingDeg)).toBeCloseTo(180, 6);
  expect(s.pitchDeg).toBeCloseTo(Math.atan2(-150, 100) * RAD2DEG, 6);
});

test("placeAt lands on a viewpoint at once, in its mode, no glide", () => {
  const { camera, modes, pose, poses } = rig();
  pose.placeAt({
    ...VIEW,
    mode: "fly",
    aboveGround: 70,
    headingDeg: 222,
    pitchDeg: -7,
    fov: 58,
  });
  const s = pose.getCameraState();
  expect(s.mode).toBe("fly");
  expect(modes.at(-1)).toBe("fly");
  expect(s.epsg.x).toBeCloseTo(VIEW.epsg.x, 6);
  expect(s.epsg.y).toBeCloseTo(VIEW.epsg.y, 6);
  expect(camera.position.y).toBeCloseTo(GROUND + 70, 6);
  expect(s.headingDeg).toBeCloseTo(-138, 4); // 222° as a signed bearing
  expect(s.pitchDeg).toBeCloseTo(-7, 4);
  expect(camera.fov).toBe(58);
  expect(poses.at(-1)).toBeCloseTo(VIEW.epsg.x, 6);
  // Nothing left to glide: a step with no input keeps the pose.
  pose.step(1 / 60);
  expect(camera.position.y).toBeCloseTo(GROUND + 70, 6);
});

test("the climb input lifts the camera in fly mode and cancels a glide", () => {
  const { camera, pose } = rig();
  pose.setMovementMode("fly");
  const start = camera.position.y;
  pose.setClimbInput(1);
  pose.step(1);
  expect(camera.position.y).toBeGreaterThan(start + 10);

  pose.setClimbInput(0);
  pose.flyToViewpoint(VIEW);
  pose.setClimbInput(-1);
  const before = camera.position.clone();
  pose.step(1 / 60);
  // The glide was dropped: the step sank the camera instead of arcing it.
  expect(camera.position.y).toBeLessThanOrEqual(before.y);
  expect(camera.position.x).toBeCloseTo(before.x, 6);
});

test("live mode eases the view to the phone's aim; a drag ends it", () => {
  let ended = 0;
  const { pose } = rig({ onFollowEnd: () => (ended += 1) });
  pose.setFollowAim({ headingDeg: 350, pitchDeg: -20 });
  pose.step(1 / 60);
  // One frame in: part of the way, turned the short way (through north).
  const early = pose.getCameraState();
  expect(early.headingDeg).toBeLessThan(0);
  expect(early.headingDeg).toBeGreaterThan(-10);
  settle(pose);
  const s = pose.getCameraState();
  expect(((s.headingDeg % 360) + 360) % 360).toBeCloseTo(350, 3);
  expect(s.pitchDeg).toBeCloseTo(-20, 3);
  // A drag ends it: the aim no longer pulls the view back.
  pose.turn(100, 0);
  expect(ended).toBe(1);
  const turned = pose.getCameraState().headingDeg;
  settle(pose);
  expect(pose.getCameraState().headingDeg).toBeCloseTo(turned, 6);
  // Ending twice reports once.
  pose.turn(10, 0);
  expect(ended).toBe(1);
});

test("live mode walks the camera to each GPS fix, gliding near ones and jumping far ones", () => {
  let ended = 0;
  const { camera, pose, poses } = rig({ onFollowEnd: () => (ended += 1) });
  // 12 m east: a step — eased, not jumped.
  pose.setFollowPosition({ x: OFFSET.cx + 12, y: OFFSET.cy });
  expect(camera.position.x).toBeCloseTo(0, 10);
  pose.step(1 / 60);
  expect(camera.position.x).toBeGreaterThan(0);
  expect(camera.position.x).toBeLessThan(1);
  settle(pose);
  // Five seconds of a 1 s ease: within a few centimetres.
  expect(Math.abs(camera.position.x - 12)).toBeLessThan(0.1);
  expect(camera.position.y).toBeCloseTo(GROUND + EYE_HEIGHT, 3);
  // 500 m north: a jump — there at once, and reported like any teleport.
  const reported = poses.length;
  pose.setFollowPosition({ x: OFFSET.cx + 12, y: OFFSET.cy + 500 });
  expect(camera.position.z).toBeCloseTo(-500, 6);
  expect(poses.length).toBe(reported + 1);
  // The stick is the player's own walking: live mode ends.
  pose.setMoveInput(0, 1);
  expect(ended).toBe(1);
  pose.setMoveInput(0, 0);
  const z = camera.position.z;
  settle(pose);
  expect(camera.position.z).toBeCloseTo(z, 1);
});

test("live mode and flying combine: the GPS moves the camera at its altitude, climbing keeps it live", () => {
  let ended = 0;
  const { camera, pose } = rig({ onFollowEnd: () => (ended += 1) });
  pose.setMovementMode("fly");
  pose.setClimbInput(1);
  settle(pose);
  pose.setClimbInput(0);
  const altitude = camera.position.y;
  expect(altitude).toBeGreaterThan(GROUND + 20);
  pose.setFollowAim({ headingDeg: 90, pitchDeg: -30 });
  pose.setFollowPosition({ x: OFFSET.cx + 500, y: OFFSET.cy });
  // A jump: there at once, and still up in the air.
  expect(camera.position.x).toBeCloseTo(500, 6);
  expect(camera.position.y).toBeCloseTo(altitude, 6);
  // Climbing is the altitude live mode leaves to the player.
  pose.setClimbInput(1);
  pose.step(1 / 60);
  pose.setClimbInput(0);
  expect(ended).toBe(0);
  expect(camera.position.y).toBeGreaterThan(altitude);
  settle(pose);
  expect(pose.getMode()).toBe("fly");
  expect(pose.getCameraState().pitchDeg).toBeCloseTo(-30, 3);
});
