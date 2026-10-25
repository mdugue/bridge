import { expect, test } from "bun:test";
import {
  type AskItem,
  type AskSet,
  askSets,
  hitsInSets,
  insideRingXz,
  nearestItem,
  rayCylinder,
  rayPrism,
  ringDistanceXz,
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
  expect(ringDistanceXz(basin, 2, 2)).toBe(0);
  expect(ringDistanceXz(basin, 7, 2)).toBeCloseTo(3, 9);
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

test("sets of things: across many sets the nearest hit within reach answers", () => {
  const items: AskItem<number>[] = Array.from({ length: 200 }, (_, i) => ({
    target: i,
    solids: [
      {
        cylinder: {
          x: (i % 20) * 10,
          z: Math.floor(i / 20) * 10,
          y0: 0,
          y1: 5,
          r: 1,
        },
      },
    ],
  }));
  const sets = askSets(items, 64);
  expect(sets.length).toBeGreaterThan(1);
  // along the row z = 30 from the west: the first post it meets, then the
  // rest of the row behind it, in order
  const hits = hitsInSets({ x: -10, y: 2, z: 30 }, east, sets, 1000);
  expect(hits[0]?.target).toBe(60);
  expect(hits[0]?.distance).toBeCloseTo(9, 9);
  expect(hits.map((h) => h.target)).toEqual(
    Array.from({ length: 20 }, (_, i) => 60 + i)
  );
  expect(hitsInSets({ x: -10, y: 2, z: 30 }, east, sets, 5)[0]).toBeUndefined();
});

test("sets of things: a box the ray misses is never opened", () => {
  const unopened: AskSet<string> = {
    box: { min: { x: 0, y: 0, z: 50 }, max: { x: 100, y: 5, z: 60 } },
    nearest: () => {
      throw new Error("opened a box the ray misses");
    },
    along: () => {
      throw new Error("opened a box the ray misses");
    },
  };
  const [near] = askSets<string>([
    { target: "post", solids: [{ cylinder: trunk }] },
  ]);
  const hits = hitsInSets({ x: 0, y: 2, z: 0 }, east, [unopened, near], 100);
  expect(hits.map((h) => h.target)).toEqual(["post"]);
});

test("sets of things: hits from overlapping sets interleave nearest first, a set's along before its nearest", () => {
  const post = (x: number) => ({ cylinder: { ...trunk, x } });
  const a = askSets<string>([
    { target: "a10", solids: [post(10)] },
    { target: "a30", solids: [post(30)] },
  ]);
  const b = askSets<string>([
    { target: "b20", solids: [post(20)] },
    { target: "b40", solids: [post(40)] },
  ]);
  // a set without `along` gives its nearest only
  const nearestOnly: AskSet<string> = { ...b[0], along: undefined };
  const o = { x: 0, y: 2, z: 0 };
  expect(hitsInSets(o, east, [...a, ...b], 100).map((h) => h.target)).toEqual([
    "a10",
    "b20",
    "a30",
    "b40",
  ]);
  expect(
    hitsInSets(o, east, [...a, nearestOnly], 100).map((h) => h.target)
  ).toEqual(["a10", "b20", "a30"]);
});
