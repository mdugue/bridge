import { expect, test } from "bun:test";
import { MARK_EDGE_M, markTriangles } from "./study-marks-geometry";

function area(tris: number[]): number {
  let a = 0;
  for (let i = 0; i < tris.length; i += 6) {
    const [x0, y0, x1, y1, x2, y2] = tris.slice(i, i + 6);
    a += ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)) / 2;
  }
  return a;
}

test("an outline becomes small upward triangles covering it, holes left out", () => {
  const square = [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
    [0, 0],
  ] as [number, number][];
  const hole = [
    [5, 2],
    [5, 6],
    [9, 6],
    [9, 2],
  ] as [number, number][];
  const tris = markTriangles({
    rings: [square, hole],
    x: 10,
    y: 5,
    shade: 0.5,
  });
  // every triangle counter-clockwise from above: the area sums up positive
  expect(area(tris)).toBeCloseTo(200 - 16, 6);
  for (let i = 0; i < tris.length; i += 6) {
    const [x0, y0, x1, y1, x2, y2] = tris.slice(i, i + 6);
    expect((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)).toBeGreaterThan(0);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThanOrEqual(MARK_EDGE_M);
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThanOrEqual(MARK_EDGE_M);
  }
});

test("a point place is a small disc round it", () => {
  const tris = markTriangles({ rings: null, x: 100, y: 200, shade: 0.2 });
  expect(tris.length).toBeGreaterThan(0);
  expect(area(tris)).toBeGreaterThan(15);
  expect(area(tris)).toBeLessThan(20);
});
