import { expect, test } from "bun:test";
import type { CameraState } from "@/lib/city/pose";
import { PerspectiveCamera } from "three/webgpu";
import { createModelRig } from "./model-rig";

test("leaving mid-dolly at once restores the field of view the walk had", () => {
  const camera = new PerspectiveCamera(50, 16 / 9, 0.3, 6000);
  camera.position.set(0, 1.7, 0);
  const state = (): CameraState => ({
    mode: "walk",
    pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    epsg: { x: 0, y: 0 },
    headingDeg: 0,
    pitchDeg: -10,
    fov: camera.fov,
  });
  const rig = createModelRig({
    camera,
    pose: {
      applyCameraState: () => undefined,
      cancelGlide: () => undefined,
      getCameraState: state,
      setMovementMode: () => undefined,
    },
    groundAt: () => 0,
    // the flat ground at y = 0
    groundAlong: (origin, direction, far) => {
      if (direction.y >= 0) {
        return null;
      }
      const hit = -origin.y / direction.y;
      return hit <= far ? hit : null;
    },
    viewport: () => ({ width: 1280, height: 720 }),
    bounds: [-5000, -5000, 5000, 5000],
    onSwap: () => undefined,
    onModeChange: () => undefined,
  });
  rig.enter("iso");
  for (let i = 0; i < 4; i++) {
    rig.step(0.1);
  }
  // the dolly zoom narrows the walk camera's field of view
  expect(camera.fov).not.toBeCloseTo(50, 3);
  // a flyTo or placeAt during the entry
  rig.exitNow();
  expect(rig.owns()).toBe(false);
  expect(camera.fov).toBeCloseTo(50, 6);
  expect(camera.near).toBeCloseTo(0.3, 6);
  expect(camera.far).toBe(6000);
});
