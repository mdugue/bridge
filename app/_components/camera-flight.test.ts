import { expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import { createCameraFlight } from "./camera-flight";

const makeCamera = () => new PerspectiveCamera(55, 1, 0.3, 6000);

test("start then update moves the camera and reports ownership", () => {
  const camera = makeCamera();
  const flight = createCameraFlight(camera);
  flight.start({
    pos: { x: 100, y: 50, z: 0 },
    headingDeg: 90,
    pitchDeg: 0,
    fov: 55,
  });
  expect(flight.update(0.5)).toBe(true);
  expect(camera.position.x).toBeGreaterThan(0);
  expect(camera.position.x).toBeLessThan(100);
  // The frame that lands (t >= 1) still reports ownership; the next does not.
  expect(flight.update(5)).toBe(true);
  expect(flight.update(0.016)).toBe(false);
  expect(flight.isActive()).toBe(false);
  expect(camera.position.x).toBeCloseTo(100, 6);
  expect(camera.position.y).toBeCloseTo(50, 6);
  expect(camera.position.z).toBeCloseTo(0, 6);
});

test("cancel releases the camera where it is", () => {
  const camera = makeCamera();
  const flight = createCameraFlight(camera);
  flight.start({
    pos: { x: 100, y: 50, z: 0 },
    headingDeg: 90,
    pitchDeg: 0,
    fov: 55,
  });
  flight.update(0.3);
  const midway = camera.position.clone();
  flight.cancel();
  expect(flight.update(1)).toBe(false);
  expect(flight.isActive()).toBe(false);
  expect(camera.position.equals(midway)).toBe(true);
});

test("duration is clamped", () => {
  // A 1 m hop still takes MIN_DURATION (1.4 s).
  const hopCamera = makeCamera();
  const hop = createCameraFlight(hopCamera);
  hop.start({ pos: { x: 1, y: 0, z: 0 }, headingDeg: 0, pitchDeg: 0, fov: 55 });
  hop.update(1.39);
  expect(hop.isActive()).toBe(true);

  // A 10 km flight is capped at MAX_DURATION (3.8 s).
  const farCamera = makeCamera();
  const far = createCameraFlight(farCamera);
  far.start({
    pos: { x: 10_000, y: 0, z: 0 },
    headingDeg: 0,
    pitchDeg: 0,
    fov: 55,
  });
  far.update(3.81);
  expect(far.isActive()).toBe(false);
  expect(farCamera.position.x).toBeCloseTo(10_000, 6);
});

test("given the floor on its way, the path itself climbs over a tower between", () => {
  const camera = makeCamera();
  const flight = createCameraFlight(camera);
  // A 100 m tower halfway along a 200 m hop at eye height — far above the
  // bow's own 24 m, and close to both ends.
  const inTower = (x: number) => x > 60 && x < 140;
  flight.start(
    { pos: { x: 200, y: 1.7, z: 0 }, headingDeg: 90, pitchDeg: 0, fov: 55 },
    (x) => (inTower(x) ? 100.5 : 0.5)
  );
  let over = 0;
  while (flight.update(1 / 60)) {
    if (inTower(camera.position.x)) {
      expect(camera.position.y).toBeGreaterThanOrEqual(100);
      over += 1;
    }
  }
  expect(over).toBeGreaterThan(0);
  expect(camera.position.x).toBeCloseTo(200, 6);
  expect(camera.position.y).toBeCloseTo(1.7, 6);
});
