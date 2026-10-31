import { expect, test } from "bun:test";
import { monorailShape, monorailSupports, SUPPORT_EVERY_M } from "./monorail";

test("supports stand every spacing along the beam, at its height there", () => {
  // a bend at (40, 0): the count runs on round it
  const s = monorailSupports(
    [
      [0, 0],
      [40, 0],
      [40, 40],
    ],
    [100, 110, 130]
  );
  expect(s.length).toBe(10);
  expect(s[0].at).toEqual([SUPPORT_EVERY_M / 2, 0]);
  expect(s[0].under).toBeCloseTo(101);
  expect(s[0].dir).toEqual([1, 0]);
  // 44 m along: 4 m up the second leg, a fifth of its rise
  expect(s[5].at[0]).toBeCloseTo(40);
  expect(s[5].at[1]).toBeCloseTo(4);
  expect(s[5].under).toBeCloseTo(112);
  expect(s[5].dir).toEqual([0, 1]);
});

test("no supports for heights that do not fit the line", () => {
  expect(
    monorailSupports(
      [
        [0, 0],
        [40, 0],
      ],
      [100]
    )
  ).toEqual([]);
});

test("a hanging car's portal stands clear of the beam on both sides", () => {
  const one = monorailShape("hanging", 1);
  const two = monorailShape("hanging", 2);
  expect(two.half).toBeGreaterThan(one.half);
  expect(two.legs - two.half).toBeGreaterThan(1);
  expect(monorailShape("top", 1).legs).toBe(0);
});
