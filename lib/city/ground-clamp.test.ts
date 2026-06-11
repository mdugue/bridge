import { expect, test } from "bun:test";
import { approachHeight, epsgToWorld, worldToEpsg } from "./ground-clamp";

const offset = { cx: 413_000, cy: 5_657_000 };

test("worldToEpsg maps the world origin to the recenter point", () => {
  expect(worldToEpsg(0, 0, offset)).toEqual({ x: 413_000, y: 5_657_000 });
});

test("worldToEpsg: +x is east, -z is north", () => {
  expect(worldToEpsg(100, -200, offset)).toEqual({
    x: 413_100,
    y: 5_657_200,
  });
});

test("epsgToWorld is the inverse of worldToEpsg", () => {
  const world = epsgToWorld(412_500, 5_657_700, offset);
  const roundTrip = worldToEpsg(world.x, world.z, offset);
  expect(roundTrip.x).toBeCloseTo(412_500);
  expect(roundTrip.y).toBeCloseTo(5_657_700);
});

test("approachHeight converges monotonically toward the target", () => {
  let y = 100;
  let previousGap = Math.abs(110 - y);
  for (let i = 0; i < 60; i++) {
    y = approachHeight(y, 110, 1 / 60, 0.12);
    const gap = Math.abs(110 - y);
    expect(gap).toBeLessThanOrEqual(previousGap);
    previousGap = gap;
  }
  expect(y).toBeCloseTo(110, 1);
});

test("approachHeight is frame-rate independent", () => {
  // One 100 ms step lands where two 50 ms steps land.
  const one = approachHeight(0, 10, 0.1, 0.12);
  const two = approachHeight(approachHeight(0, 10, 0.05, 0.12), 10, 0.05, 0.12);
  expect(one).toBeCloseTo(two, 10);
});

test("approachHeight snaps when tau <= 0", () => {
  expect(approachHeight(5, 42, 0.016, 0)).toBe(42);
});
