import { expect, test } from "bun:test";
import { aimOf } from "./device-orientation";

const event = (fields: Record<string, unknown>) =>
  fields as unknown as DeviceOrientationEvent;

test("iOS: the compass heading, the pitch from beta/gamma", () => {
  const aim = aimOf(
    event({ webkitCompassHeading: 120, beta: 80, gamma: 0, alpha: 3 })
  );
  expect(aim?.headingDeg).toBe(120);
  expect(aim?.pitchDeg).toBeCloseTo(-10, 6);
  // −1 = the compass is not calibrated: no aim.
  expect(aimOf(event({ webkitCompassHeading: -1, beta: 80 }))).toBeNull();
});

test("absolute readings become an aim, relative ones do not", () => {
  const aim = aimOf(event({ absolute: true, alpha: 270, beta: 90, gamma: 0 }));
  expect(aim?.headingDeg).toBeCloseTo(90, 6);
  expect(aim?.pitchDeg).toBeCloseTo(0, 6);
  expect(
    aimOf(event({ absolute: false, alpha: 270, beta: 90, gamma: 0 }))
  ).toBeNull();
  expect(aimOf(event({ absolute: true, alpha: null }))).toBeNull();
});
