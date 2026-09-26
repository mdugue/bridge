import { expect, test } from "bun:test";
import {
  NOMINAL_SPAN_M,
  SPAN_CLEARANCE_M,
  spanHeight,
  spanLift,
  WIRE_SAG_M,
  wireDrop,
  wireStations,
} from "./tram";

test("the wire is held at both ends and at every mapped support", () => {
  expect(wireStations(50, [20])).toEqual([0, 20, 50]);
  // supports outside the line are ignored, unsorted ones sorted
  expect(wireStations(50, [40, -3, 20, 60])).toEqual([0, 20, 40, 50]);
});

test("gaps longer than a nominal span get evenly spaced virtual supports", () => {
  const s = wireStations(100, []);
  expect(s[0]).toBe(0);
  expect(s.at(-1)).toBe(100);
  for (let i = 1; i < s.length; i++) {
    expect(s[i] - s[i - 1]).toBeLessThanOrEqual(NOMINAL_SPAN_M + 1e-9);
  }
  expect(s).toHaveLength(5); // 4 spans of 25 m
});

test("the wire sags most midway, not at all on a support", () => {
  const s = [0, 30, 60];
  expect(wireDrop(s, 0)).toBe(0);
  expect(wireDrop(s, 30)).toBeCloseTo(0, 9);
  expect(wireDrop(s, 15)).toBeCloseTo(WIRE_SAG_M, 9);
  // a short span sags less
  expect(wireDrop([0, 10], 5)).toBeCloseTo(WIRE_SAG_M / 3, 9);
  expect(wireDrop(s, 99)).toBe(0);
});

test("a span wire sags between its anchors and is lifted over its wires", () => {
  expect(spanHeight(7, 7, 0)).toBe(7);
  expect(spanHeight(7, 7, 0.5)).toBeLessThan(7);
  expect(spanLift(7, 7, [{ t: 0.5, h: 5.6 }])).toBe(0);
  // the ground rises under the far anchor: the wire there is 7.4 m up
  const lift = spanLift(7, 7, [{ t: 0.9, h: 7.4 }]);
  expect(spanHeight(7 + lift, 7 + lift, 0.9)).toBeCloseTo(
    7.4 + SPAN_CLEARANCE_M,
    9
  );
});
