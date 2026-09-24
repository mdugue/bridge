import { expect, test } from "bun:test";
import { groundRayDistance } from "./ground-ray";

const flat = (h: number) => () => h;

test("a ray looking down meets flat ground where geometry says", () => {
  // From 10 m up, 45° down: the ground at y = 0 is √2·10 m away.
  const d = Math.SQRT1_2;
  const t = groundRayDistance(
    { x: 0, y: 10, z: 0 },
    { x: d, y: -d, z: 0 },
    flat(0),
    { far: 1000 }
  );
  expect(t).not.toBeNull();
  expect(Math.abs((t ?? 0) - 10 * Math.SQRT2)).toBeLessThan(0.05);
});

test("a ray above the horizon never hits", () => {
  expect(
    groundRayDistance({ x: 0, y: 10, z: 0 }, { x: 1, y: 0.1, z: 0 }, flat(0), {
      far: 5000,
    })
  ).toBeNull();
});

test("a hill in the way is hit before the plain behind it", () => {
  // A 30 m bump between x = 100 and 120 in front of a flat plain.
  const hill = (x: number) => (x > 100 && x < 120 ? 30 : 0);
  const t = groundRayDistance(
    { x: 0, y: 20, z: 0 },
    { x: 1, y: -0.05, z: 0 },
    (x) => hill(x),
    { far: 2000 }
  );
  // The ray is at 15 m at x = 100: inside the hill, not on the plain at 400 m.
  expect(t).not.toBeNull();
  expect(t ?? 0).toBeGreaterThan(99);
  expect(t ?? 0).toBeLessThan(101);
});

test("off the loaded terrain the ray keeps going instead of hitting", () => {
  // No ground for x < 50, flat ground at y = 0 beyond it.
  const t = groundRayDistance(
    { x: 0, y: 5, z: 0 },
    { x: 1, y: -0.2, z: 0 },
    (x) => (x < 50 ? null : 0),
    { far: 1000 }
  );
  // The geometric crossing (x = 25) has no ground; the first grounded
  // sample below the surface is just past x = 50.
  expect(t).not.toBeNull();
  expect(t ?? 0).toBeGreaterThanOrEqual(50);
  expect(t ?? 0).toBeLessThan(52);
});
