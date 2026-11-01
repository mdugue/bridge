import { expect, test } from "bun:test";
import { appendTriangles, takeTriangles, wholeTrees } from "./hidden-triangles";

test("a design's objects leave the index and come back whole", () => {
  // three triangles: objects 0, 1, 0
  const featureIds = [0, 0, 0, 1, 1, 1, 0, 0, 0];
  const index = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const { kept, taken } = takeTriangles(index, featureIds, (i) => i === 0);
  expect([...kept]).toEqual([3, 4, 5]);
  expect([...(taken.get(0) ?? [])]).toEqual([0, 1, 2, 6, 7, 8]);
  const back = appendTriangles(kept, [...taken.values()]);
  expect([...back].sort((a, b) => a - b)).toEqual(index);
});

test("a covered house is hidden with what hangs on it", () => {
  // 0: a Building, 1: its part, 2: its plinth, 3: a neighbour, 4: its door
  const root = [0, 0, 0, 3, 3];
  expect([...wholeTrees(root, new Set([1]))]).toEqual([0, 1, 2]);
  expect([...wholeTrees(root, new Set([3, 9]))]).toEqual([3, 4]);
  expect(wholeTrees(root, new Set()).size).toBe(0);
});
