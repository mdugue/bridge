import { expect, test } from "bun:test";
import { type Point2, samplePolyline, subdividePolyline } from "./polyline";

const L: Point2[] = [
  [0, 0],
  [10, 0],
  [10, 5],
];

const gaps = (pts: Point2[]) =>
  pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));

test("subdividePolyline keeps every vertex and never exceeds the spacing", () => {
  const pts = subdividePolyline(L, 4);
  expect(pts[0]).toEqual([0, 0]);
  expect(pts).toContainEqual([10, 0]);
  expect(pts.at(-1)).toEqual([10, 5]);
  for (const gap of gaps(pts)) {
    expect(gap).toBeLessThanOrEqual(4 + 1e-9);
  }
  // 10 m at 4 m spacing → 3 steps of 3.33; 5 m → 2 steps of 2.5.
  expect(pts).toHaveLength(3 + 2 + 1);
});

test("subdividePolyline: a segment shorter than the spacing still yields both ends", () => {
  expect(
    subdividePolyline(
      [
        [0, 0],
        [1, 0],
      ],
      4
    )
  ).toEqual([
    [0, 0],
    [1, 0],
  ]);
  expect(subdividePolyline([[3, 3]], 4)).toEqual([[3, 3]]);
  expect(subdividePolyline([], 4)).toEqual([]);
});

test("subdividePolyline never emits a repeated vertex twice", () => {
  expect(
    subdividePolyline(
      [
        [0, 0],
        [0, 0],
        [2, 0],
      ],
      4
    )
  ).toEqual([
    [0, 0],
    [2, 0],
  ]);
});

test("a non-positive spacing throws instead of looping forever", () => {
  expect(() => subdividePolyline(L, 0)).toThrow(RangeError);
  expect(() => samplePolyline(L, Number.NaN)).toThrow(RangeError);
});

test("samplePolyline keeps an even rhythm through a corner", () => {
  const pts = samplePolyline(L, 4);
  // 0, 4, 8 on the first leg; the 12 m mark lands 2 m up the second leg.
  expect(pts).toEqual([
    [0, 0],
    [4, 0],
    [8, 0],
    [10, 2],
  ]);
});

test("samplePolyline skips zero-length segments and never samples the end", () => {
  expect(
    samplePolyline(
      [
        [0, 0],
        [0, 0],
        [3, 0],
      ],
      1
    )
  ).toEqual([
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  expect(samplePolyline([[5, 5]], 1)).toEqual([]);
});
