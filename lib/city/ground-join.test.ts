import { expect, test } from "bun:test";
import {
  checkJoins,
  EDGE_TOLERANCE_M,
  farthestNear,
  followGround,
  lowestGround,
  meetGround,
  reachLevel,
} from "./ground-join";

test("an edge meets the ground, never above the top nor below its floor", () => {
  expect(meetGround(100.12, 100.04)).toBeCloseTo(100.05, 6);
  expect(meetGround(100.12, 100.5)).toBe(100.12); // the ground above: the top
  expect(meetGround(100.12, 99.5, { floor: 100.01 })).toBe(100.01);
  expect(meetGround(100.12, null)).toBe(100.12);
});

test("a level is reached where the ground comes up to it", () => {
  const ramp = (d: number) => 100 + Math.min(d, 3); // a 3 m bank
  const opts = { reach: 5, step: 0.25 };
  // a flat cap at 103: the ground reaches it 3 m out
  expect(reachLevel(ramp, () => 103, opts)).toBe(3);
  expect(reachLevel(ramp, () => 103, { ...opts, tolerance: 0.5 })).toBe(2.5);
  // a ramp falling from 101 m at 50 % lands on the 100 m ground 2 m out
  expect(
    reachLevel(
      () => 100,
      (d) => 101 - 0.5 * d,
      opts
    )
  ).toBe(2);
  // out of reach, and unknown ground skipped or stopping the search
  expect(reachLevel(ramp, () => 110, opts)).toBeNull();
  const hole = (d: number) => (d < 1 ? null : 103);
  expect(reachLevel(hole, () => 103, opts)).toBe(1);
  expect(
    reachLevel(hole, () => 103, { ...opts, onUnknown: "stop" })
  ).toBeNull();
});

test("values are carried to their neighbours within their group", () => {
  const v = [1, 3, 1, null, 1, 1];
  expect(farthestNear(v, 1, () => 1)).toEqual([3, 3, 3, null, 1, 1]);
  expect(farthestNear(v, 1, () => -1)).toEqual([1, 1, 1, null, 1, 1]);
  // a neighbour of another group is not carried over
  expect(
    farthestNear(
      v,
      1,
      () => 1,
      (i) => i < 2
    )
  ).toEqual([3, 3, 1, null, 1, 1]);
});

test("feet must reach the ground, edges must not stand above it", () => {
  const ground = (x: number) => (x < 100 ? 10 : null);
  const report = checkJoins(
    [
      { kind: "foot", x: 0, y: 0, z: 9.9 },
      { kind: "foot", x: 1, y: 0, z: 10.5 }, // floating
      { kind: "edge", x: 2, y: 0, z: 10 + EDGE_TOLERANCE_M - 0.01 },
      { kind: "edge", x: 3, y: 0, z: 9 }, // tucked under: fine
      { kind: "edge", x: 4, y: 0, z: 11 }, // a step
      { kind: "edge", x: 200, y: 0, z: 0 }, // off the ground
    ],
    ground
  );
  expect(report.feet).toBe(2);
  expect(report.edges).toBe(3);
  expect(report.unknown).toBe(1);
  expect(report.misses.map((m) => m.join.x)).toEqual([4, 1]);
});

test("a line follows the ground where it bends between its points", () => {
  // a 1 m deep gutter 2 m wide around x = 5 on a 10 m span
  const gutter = (x: number) => (Math.abs(x - 5) < 1 ? 99 : 100);
  const line = followGround(
    [
      [0, 0],
      [10, 0],
    ],
    gutter
  );
  expect(line.length).toBeGreaterThan(2);
  expect(line.some(([x]) => Math.abs(x - 5) < 1)).toBe(true);
  // flat ground is left alone
  expect(
    followGround(
      [
        [0, 0],
        [10, 0],
      ],
      () => 100
    )
  ).toEqual([
    [0, 0],
    [10, 0],
  ]);
  expect(
    lowestGround(gutter, [
      [0, 0],
      [5, 0],
      [20, 0],
    ])
  ).toBe(99);
  expect(lowestGround(() => null, [[0, 0]])).toBeNull();
});
