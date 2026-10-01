import { expect, test } from "bun:test";
import {
  type AskItem,
  insideRingXz,
  nearestItem,
  rayCylinder,
  rayPrism,
} from "./ask-solids";

const east = { x: 1, y: 0, z: 0 };
const down = { x: 0, y: -1, z: 0 };
const trunk = { x: 10, z: 0, y0: 0, y1: 4, r: 0.5 };

test("a ray meets a cylinder's side, its cap, or misses it", () => {
  expect(rayCylinder({ x: 0, y: 2, z: 0 }, east, trunk)).toBeCloseTo(9.5, 9);
  expect(rayCylinder({ x: 10, y: 9, z: 0 }, down, trunk)).toBeCloseTo(5, 9);
  // above it, beside it, behind the origin
  expect(rayCylinder({ x: 0, y: 5, z: 0 }, east, trunk)).toBeNull();
  expect(rayCylinder({ x: 0, y: 2, z: 2 }, east, trunk)).toBeNull();
  expect(rayCylinder({ x: 20, y: 2, z: 0 }, east, trunk)).toBeNull();
  // from inside: right here
  expect(rayCylinder({ x: 10, y: 2, z: 0 }, east, trunk)).toBe(0);
});

const basin: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

test("a ray meets a prism's wall or its top; a ring is even–odd", () => {
  const prism = { ring: basin, y0: 0, y1: 1 };
  expect(rayPrism({ x: -3, y: 0.5, z: 2 }, east, prism)).toBeCloseTo(3, 9);
  expect(rayPrism({ x: 2, y: 10, z: 2 }, down, prism)).toBeCloseTo(9, 9);
  expect(rayPrism({ x: -3, y: 2, z: 2 }, east, prism)).toBeNull();
  expect(rayPrism({ x: 6, y: 10, z: 2 }, down, prism)).toBeNull();
  expect(insideRingXz(basin, 2, 2)).toBe(true);
  expect(insideRingXz(basin, 5, 2)).toBe(false);
});

test("of several things, the nearest within reach answers", () => {
  const items: AskItem<string>[] = [
    { target: "far", solids: [{ cylinder: { ...trunk, x: 30 } }] },
    { target: "near", solids: [{ cylinder: trunk }] },
    { target: "basin", solids: [{ prism: { ring: basin, y0: 0, y1: 1 } }] },
  ];
  const o = { x: -10, y: 0.5, z: 2 };
  expect(nearestItem(o, east, items, 100)?.target).toBe("basin");
  expect(nearestItem({ x: 0, y: 2, z: 0 }, east, items, 100)?.target).toBe(
    "near"
  );
  expect(nearestItem({ x: 0, y: 2, z: 0 }, east, items, 5)).toBeNull();
});
