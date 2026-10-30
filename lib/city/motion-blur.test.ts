import { expect, test } from "bun:test";
import { Matrix4, PerspectiveCamera } from "three";
import { blurs, BLUR_JUMP_PX, type Motion, motionPixels } from "./motion-blur";

const W = 1000;
const H = 600;

/** Two poses of one camera; the measure between them. */
function moved(change: (camera: PerspectiveCamera) => void): Motion {
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
  const m = moved(() => undefined);
  expect(m.most).toBeCloseTo(0, 6);
  expect(blurs(m, false)).toBe(false);
});

test("a turn moves the picture by its angle in pixels, everywhere", () => {
  // 1° of yaw: the centre moves focal length × tan 1° (px),
  // the wide edges up to (1 + tan²) times more
  const m = moved((c) => c.rotateY((1 * Math.PI) / 180));
  const focal = H / 2 / Math.tan((55 / 2) * (Math.PI / 180));
  expect(m.least).toBeGreaterThan(focal * Math.tan(Math.PI / 180) * 0.99);
  expect(m.most).toBeLessThan(focal * Math.tan(Math.PI / 180) * 1.8);
  expect(blurs(m, false)).toBe(true);
  expect(blurs(m, true)).toBe(true);
});

test("a walk's step moves the near street, not the far city", () => {
  // 2.5 cm a frame: 1.5 m/s at 60 Hz
  const m = moved((c) => c.translateZ(-0.025));
  expect(m.most).toBeGreaterThan(1);
  expect(m.most).toBeLessThan(20);
  expect(m.median).toBeLessThan(1);
  // the far city would lose its antialiasing and gain no smear
  expect(blurs(m, true)).toBe(false);
  expect(blurs(m, false)).toBe(false);
});

test("a teleport is a jump, not motion", () => {
  const m = moved((c) => c.position.set(500, 200, 300));
  expect(m.most).toBeGreaterThan(BLUR_JUMP_PX);
  expect(blurs(m, false)).toBe(false);
});

test("a point behind the last camera is a jump", () => {
  expect(moved((c) => c.rotateY(Math.PI)).most).toBe(Infinity);
});
