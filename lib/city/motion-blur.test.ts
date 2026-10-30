import { expect, test } from "bun:test";
import { Matrix4, PerspectiveCamera } from "three";
import { blurs, BLUR_JUMP_PX, motionPixels } from "./motion-blur";

const W = 1000;
const H = 600;

/** Two poses of one camera; the measure between them. */
function moved(change: (camera: PerspectiveCamera) => void): number {
  const camera = new PerspectiveCamera(55, W / H, 0.3, 6000);
  camera.position.set(0, 1.7, 0);
  camera.updateMatrixWorld();
  const prevView = camera.matrixWorldInverse.clone();
  const prevProjection = camera.projectionMatrix.clone();
  change(camera);
  camera.updateMatrixWorld();
  const viewToPrev = new Matrix4().multiplyMatrices(
    prevView,
    camera.matrixWorld
  );
  return motionPixels(
    viewToPrev.elements,
    camera.projectionMatrix.elements,
    prevProjection.elements,
    W,
    H
  );
}

test("a still camera does not move", () => {
  expect(moved(() => undefined)).toBeCloseTo(0, 6);
  expect(blurs(0)).toBe(false);
});

test("a turn moves the picture by its angle in pixels", () => {
  // 1° of yaw: the centre moves focal length × tan 1° (px),
  // the wide edges up to (1 + tan²) times more
  const px = moved((c) => c.rotateY((1 * Math.PI) / 180));
  const focal = H / 2 / Math.tan((55 / 2) * (Math.PI / 180));
  expect(px).toBeGreaterThan(focal * Math.tan(Math.PI / 180));
  expect(px).toBeLessThan(focal * Math.tan(Math.PI / 180) * 1.8);
  expect(blurs(px)).toBe(true);
});

test("a walk's step moves the near street, not the sky", () => {
  // 2.5 cm a frame: 1.5 m/s at 60 Hz
  const walk = moved((c) => c.translateZ(-0.025));
  expect(walk).toBeGreaterThan(1);
  expect(walk).toBeLessThan(20);
});

test("a teleport is a jump, not motion", () => {
  const px = moved((c) => c.position.set(500, 200, 300));
  expect(px).toBeGreaterThan(BLUR_JUMP_PX);
  expect(blurs(px)).toBe(false);
});

test("a point behind the last camera is a jump", () => {
  expect(moved((c) => c.rotateY(Math.PI))).toBe(Infinity);
});
