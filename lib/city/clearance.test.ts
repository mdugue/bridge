import { expect, test } from "bun:test";
import {
  clearHeight,
  GROUND_CLEARANCE,
  glideHull,
  hullLift,
  nearestFree,
  ROOF_CLEARANCE,
  upperHull,
  WALL_CLEARANCE,
} from "./clearance";

/** One block: x, z ∈ [0, 20], from the ground (0) up to its roof (15). */
const ROOF = 15;
const inBlock = (x: number, z: number) => x > 0 && x < 20 && z > 0 && z < 20;
const roofAbove = (x: number, y: number, z: number) =>
  inBlock(x, z) && y < ROOF ? ROOF : null;

test("clearHeight keeps a free camera where it is", () => {
  expect(clearHeight(1.7, 0, () => null)).toBe(1.7);
});

test("clearHeight lifts a camera below the ground over it", () => {
  expect(clearHeight(-3, 0, () => null)).toBe(GROUND_CLEARANCE);
});

test("clearHeight lifts a camera out of a building over its roof", () => {
  const h = clearHeight(4, 0, (y) => roofAbove(5, y, 5));
  expect(h).toBeGreaterThanOrEqual(ROOF + ROOF_CLEARANCE);
  expect(h).toBeLessThan(ROOF + ROOF_CLEARANCE + 0.01);
  // Just above the roof, the near plane would clip it: lifted too.
  expect(clearHeight(ROOF + 0.1, 0, (y) => roofAbove(5, y, 5))).toBeCloseTo(
    ROOF + ROOF_CLEARANCE,
    2
  );
});

test("clearHeight climbs through stacked parts", () => {
  // A tower on the block: its roof at 40, entered once over the block's.
  const stacked = (y: number) => (y < ROOF ? ROOF : y < 40 ? 40 : null);
  expect(clearHeight(2, 0, stacked)).toBeGreaterThanOrEqual(
    40 + ROOF_CLEARANCE
  );
});

test("nearestFree keeps a free spot", () => {
  expect(nearestFree(-5, 3, (x, z) => !inBlock(x, z))).toEqual({ x: -5, z: 3 });
});

test("nearestFree sets a spot inside out past the nearest facade", () => {
  const out = nearestFree(2, 10, (x, z) => !inBlock(x, z));
  expect(out).not.toBeNull();
  if (!out) {
    return;
  }
  expect(inBlock(out.x, out.z)).toBe(false);
  // Out through the west facade (2 m away), the margin beyond it.
  expect(out.x).toBeLessThan(0);
  expect(out.x).toBeGreaterThan(-WALL_CLEARANCE - 1.5);
  expect(Math.hypot(out.x - 2, out.z - 10)).toBeLessThan(
    3 + WALL_CLEARANCE + 0.01
  );
});

test("nearestFree tries the preferred direction first", () => {
  const out = nearestFree(10, 10, (x, z) => !inBlock(x, z), {
    preferAngle: Math.PI / 2,
  });
  expect(out?.z).toBeGreaterThan(20);
  expect(Math.abs((out?.x ?? 0) - 10)).toBeLessThan(1e-6);
});

test("nearestFree gives up past its radius", () => {
  expect(nearestFree(10, 10, () => false, { maxRadius: 5 })).toBeNull();
});

test("upperHull is pinned to zero at both ends and drops points under it", () => {
  const hull = upperHull([
    { s: 0.25, lift: 10 },
    { s: 0.5, lift: 4 },
    { s: 0.75, lift: 10 },
  ]);
  expect(hull).toEqual([
    { s: 0, lift: 0 },
    { s: 0.25, lift: 10 },
    { s: 0.75, lift: 10 },
    { s: 1, lift: 0 },
  ]);
  expect(hullLift(hull, 0.5)).toBe(10);
  expect(hullLift(hull, 0.125)).toBe(5);
  expect(hullLift(upperHull([]), 0.5)).toBe(0);
});

test("a glide's hull clears everything under its line", () => {
  // From west of the block to east of it at eye height: over the roof.
  const line = {
    from: { x: -30, y: 1.7, z: 10 },
    to: { x: 50, y: 1.7, z: 10 },
  };
  const floorAt = (x: number, z: number) =>
    (inBlock(x, z) ? ROOF + ROOF_CLEARANCE : 0) + GROUND_CLEARANCE;
  const hull = glideHull(line, floorAt);
  for (let i = 0; i <= 1000; i += 1) {
    const s = i / 1000;
    const x = line.from.x + (line.to.x - line.from.x) * s;
    const y = line.from.y + hullLift(hull, s);
    if (inBlock(x, 10)) {
      expect(y).toBeGreaterThanOrEqual(ROOF);
    }
  }
  // Over open ground the line needs nothing.
  expect(
    glideHull({ from: line.from, to: { x: -60, y: 1.7, z: 10 } }, floorAt)
  ).toEqual([
    { s: 0, lift: 0 },
    { s: 1, lift: 0 },
  ]);
});
