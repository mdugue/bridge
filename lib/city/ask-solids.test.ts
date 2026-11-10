import { expect, test } from "bun:test";
import {
  askSets,
  hitsInSets,
  insideRingXz,
  nearestInSets,
  nearestItem,
  rayCylinder,
  rayDeckTop,
  rayPrism,
  ringDistanceXz,
  setsBox,
} from "./ask-solids";
import type { AskItem, AskSet, Slab } from "./ask-solids";

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

test("the nearest in sets: the first thing the ray meets, within reach", () => {
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
  const hit = nearestInSets({ x: -10, y: 2, z: 30 }, east, sets, 1000);
  expect(hit?.target).toBe(60);
  expect(hit?.distance).toBeCloseTo(9, 9);
  // from the far end, westwards: the row's last post first
  const back = nearestInSets(
    { x: 300, y: 2, z: 30 },
    { x: -1, y: 0, z: 0 },
    sets,
    1000
  );
  expect(back?.target).toBe(79);
  expect(nearestInSets({ x: -10, y: 2, z: 30 }, east, sets, 5)).toBeNull();
  expect(nearestInSets({ x: -10, y: 9, z: 30 }, east, sets, 1000)).toBeNull();
});

const postAt = (target: number, x: number): AskItem<number> => ({
  target,
  solids: [{ cylinder: { x, z: 0, y0: 0, y1: 5, r: 1 } }],
});

test("the nearest in sets looks past the thing it starts in, one turned down and one unbuilt", () => {
  const sets = askSets([postAt(0, 0), postAt(1, 10), postAt(2, 20)], 64);
  // from inside the first post: the next one ahead, not the start
  const inside = nearestInSets({ x: 0, y: 2, z: 0 }, east, sets, 1000);
  expect(inside?.target).toBe(1);
  expect(inside?.distance).toBeCloseTo(9, 9);
  // the second folded away: the third
  const kept = nearestInSets(
    { x: -10, y: 2, z: 0 },
    east,
    sets,
    1000,
    (hit) => hit.target !== 1 && hit.target !== 0
  );
  expect(kept?.target).toBe(2);
  // a set that would build first is not asked, unless roughly
  const unbuilt: AskSet<number> = {
    box: { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 5, z: 5 } },
    nearest: () => {
      throw new Error("asked a set that would build first");
    },
    unbuilt: () => true,
  };
  const past = nearestInSets(
    { x: -10, y: 2, z: 0 },
    east,
    [unbuilt, ...sets],
    1000
  );
  expect(past?.target).toBe(0);
  const rough = nearestInSets(
    { x: -10, y: 2, z: 0 },
    east,
    [
      { ...unbuilt, rough: () => ({ target: 9, distance: 3, solids: [] }) },
      ...sets,
    ],
    1000
  );
  expect(rough?.target).toBe(9);
  // glass is passed by
  const glass: AskSet<number> = {
    ...unbuilt,
    unbuilt: undefined,
    glass: true,
  };
  expect(
    nearestInSets({ x: -10, y: 2, z: 0 }, east, [glass, ...sets], 1000)?.target
  ).toBe(0);
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

const post = (x: number) => ({ cylinder: { ...trunk, x } });

test("sets of things: hits from overlapping sets interleave nearest first, a set's along before its nearest", () => {
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

test("a ray comes down onto a deck's top, from above it or standing on it", () => {
  // a deck 100 m long, its top rising from 10 m to 12 m eastwards
  const deck: Slab = {
    ring: [
      [0, -5],
      [100, -5],
      [100, 5],
      [0, 5],
    ],
    y0: 10,
    y1: 12,
    above: 2,
    below: 1,
    topAt: (x) => 10 + x / 50,
  };
  // standing on it, 1.6 m over its top at x = 20, looking along and down
  const look = { x: Math.cos(0.1), y: -Math.sin(0.1), z: 0 };
  const t = rayDeckTop({ x: 20, y: 10.4 + 1.6, z: 0 }, look, deck, 1000);
  expect(t).not.toBeNull();
  // the point lies on the top, within a step
  const x = 20 + (t ?? 0) * look.x;
  expect(Math.abs(12 - (t ?? 0) * Math.sin(0.1) - (10 + x / 50))).toBeLessThan(
    0.05
  );
  // looking up, or beyond reach: nothing
  expect(
    rayDeckTop({ x: 20, y: 12, z: 0 }, { x: 1, y: 0, z: 0 }, deck, 1000)
  ).toBeNull();
  expect(rayDeckTop({ x: 20, y: 12, z: 0 }, look, deck, 3)).toBeNull();
});

test("the box around sets: none for no sets", () => {
  expect(setsBox([])).toBeNull();
  const sets = askSets([postAt(0, 0), postAt(1, 100)], 64);
  const box = setsBox(sets);
  expect(box?.min.x).toBeCloseTo(-1, 9);
  expect(box?.max.x).toBeCloseTo(101, 9);
});
