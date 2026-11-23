import { expect, test } from "bun:test";
import {
  approachHeight,
  epsgToWorld,
  groundSlope,
  worldToEpsg,
} from "./ground-clamp";

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
  for (let i = 0; i < 60; i += 1) {
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

test("the ground's slope reads along world x and world z, held to ±1", () => {
  const at = { cx: 1000, cy: 2000 };
  // rises 0.1 m per m east and 0.2 m per m north
  const ground = {
    offset: at,
    heightAt: (e: number, n: number) => 0.1 * e + 0.2 * n,
  };
  const [sx, sz] = groundSlope(ground, 5, -7);
  expect(sx).toBeCloseTo(0.1, 9);
  // world z runs south: the ground falls along it
  expect(sz).toBeCloseTo(-0.2, 9);
  const cliff = { offset: at, heightAt: (e: number) => 5 * e };
  expect(groundSlope(cliff, 0, 0)[0]).toBe(1);
  // on the terrain's edge: one-sided from the point, 0 where nothing reads
  const edge = {
    offset: at,
    heightAt: (e: number, n: number) => (e > 1000 ? null : 0.1 * e + 0.2 * n),
  };
  const [ex, ez] = groundSlope(edge, 0, 0);
  expect(ex).toBeCloseTo(0.1, 9);
  expect(ez).toBeCloseTo(-0.2, 9);
  const off = { offset: at, heightAt: () => null };
  expect(groundSlope(off, 0, 0)).toEqual([0, 0]);
});
