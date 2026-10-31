import { expect, test } from "bun:test";
import type { RailFeature } from "./features";
import { checkJoins, SINK } from "./ground-join";
import {
  footCorners,
  monorailJoins,
  monorailShape,
  monorailSupports,
  SUPPORT_EVERY_M,
  supportFeet,
} from "./monorail";

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

test("a portal's feet stand either side, under the lowest ground at their corners", () => {
  const shape = monorailShape("hanging", 1);
  // ground falling 0.5 m per metre towards +y
  const heightAt = (_x: number, y: number) => 100 - 0.5 * y;
  const s = {
    at: [0, 0] as [number, number],
    dir: [1, 0] as [number, number],
    under: 110,
  };
  const feet = supportFeet(s, shape, heightAt);
  expect(feet?.length).toBe(2);
  const [left, right] = feet ?? [];
  expect(left.at[1]).toBeCloseTo(shape.legs);
  expect(right.at[1]).toBeCloseTo(-shape.legs);
  // each foot below the lowest of its corners' ground, by the box's sink
  for (const foot of feet ?? []) {
    const low = Math.min(
      ...footCorners(foot.at, foot.half).map(([x, y]) => heightAt(x, y))
    );
    expect(foot.base).toBeCloseTo(low - SINK.box);
  }
  // a beam the ground comes close to, or unknown ground: no support
  expect(supportFeet({ ...s, under: 101 }, shape, heightAt)).toBeNull();
  expect(supportFeet(s, shape, () => null)).toBeNull();
});

test("a monorail reports its feet in the ground", () => {
  const heightAt = (x: number) => 100 + 0.3 * x;
  const f: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [40, 0],
      ],
    },
    properties: { mono: "top", bz: [106, 118] },
  };
  const joins = monorailJoins(f, heightAt);
  // five columns, four corners each
  expect(joins.length).toBe(20);
  const report = checkJoins(joins, heightAt);
  expect(report.feet).toBe(20);
  expect(report.misses).toEqual([]);
  expect(monorailJoins({ ...f, properties: { tracks: 1 } }, heightAt)).toEqual(
    []
  );
});
