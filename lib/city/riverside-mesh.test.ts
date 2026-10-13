import { expect, test } from "bun:test";
import { ShapeUtils, Vector2 } from "three";
import type { RiversideFeature } from "./features";
import { checkJoins } from "./ground-join";
import type { Triangulate } from "./mesh3";
import type { MeshContext } from "./rail-mesh";
import { landings, riversideParts } from "./riverside-mesh";

const triangulate: Triangulate = (contour, holes) =>
  ShapeUtils.triangulateShape(
    contour.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y)))
  );

/** A bank at 108 m north of y = 0, the flat river at 104 m south of it. */
const ctx: MeshContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: (_x, y) => (y >= 0 ? 108 : 104),
  triangulate,
};

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ] as [number, number][],
];

const topY = (pos: readonly number[]): number => {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < pos.length; i += 3) {
    max = Math.max(max, pos[i]);
  }
  return max;
};
const bottomY = (pos: readonly number[]): number => {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pos.length; i += 3) {
    min = Math.min(min, pos[i]);
  }
  return min;
};

test("nothing on the river, no parts", () => {
  const parts = riversideParts([], ctx);
  expect(parts.deck.pos).toEqual([]);
  expect(parts.piles).toEqual([]);
  expect(parts.ferry.index).toEqual([]);
  expect(parts.joins).toEqual([]);
});

test("a pier stands its deck on piles over the water, not on the bank", () => {
  const pier: RiversideFeature = {
    geometry: { type: "Polygon", coordinates: rect(0, -20, 3, 2) },
    properties: { k: "pier", deck: 108.4 },
  };
  const parts = riversideParts([pier], ctx);
  expect(topY(parts.deck.pos)).toBeCloseTo(108.4, 4);
  expect(parts.piles.length).toBeGreaterThan(4);
  // every pile stands in the river, 0.8 m into its bed, up to the deck
  for (const pile of parts.piles) {
    expect(pile.z).toBeGreaterThan(0);
    expect(pile.y0).toBeCloseTo(103.2, 4);
    expect(pile.y1).toBeCloseTo(108.1, 4);
  }
  expect(parts.railing.pos.length).toBeGreaterThan(0);
  expect(parts.posts.length).toBeGreaterThan(0);
  expect(checkJoins(parts.joins, ctx.heightAt).misses).toEqual([]);
});

test("a pontoon floats on the drawn water, with a hut and a gangway", () => {
  const pontoon: RiversideFeature = {
    geometry: { type: "Polygon", coordinates: rect(0, -30, 4, -10) },
    properties: { k: "pontoon", len: 20, bank: [2, 1] },
  };
  const parts = riversideParts([pontoon], ctx);
  expect(topY(parts.hull.pos)).toBeCloseTo(104.35, 4);
  expect(topY(parts.pontoonDeck.pos)).toBeCloseTo(104.5, 4);
  expect(parts.hut.pos.length).toBeGreaterThan(0);
  expect(parts.roof.pos.length).toBeGreaterThan(0);
  expect(parts.gangway.pos.length).toBeGreaterThan(0);
  // the gangway lands on the bank: its one join, an edge within reach
  expect(parts.joins).toHaveLength(1);
  expect(parts.joins[0].kind).toBe("edge");
  expect(checkJoins(parts.joins, ctx.heightAt).misses).toEqual([]);
  expect(landings([pontoon])).toEqual([pontoon]);
});

test("a ferry line is a wake on the water; a groyne a stone ridge into the bed", () => {
  const ferry: RiversideFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, -50],
        [100, -60],
      ],
    },
    properties: { k: "ferry", name: "Johannstadt Fähre" },
  };
  const groyne: RiversideFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 5],
        [0, -40],
      ],
    },
    properties: { k: "groyne" },
  };
  const parts = riversideParts([ferry, groyne], ctx);
  expect(parts.ferry.along.length).toBe(parts.ferry.pos.length / 3);
  expect(topY(parts.ferry.pos)).toBeCloseTo(104.06, 4);
  expect(topY(parts.groyne.pos)).toBeCloseTo(108.5, 4);
  // its flanks' feet run under the ground on either side
  expect(parts.joins.length).toBeGreaterThan(0);
  expect(checkJoins(parts.joins, ctx.heightAt).misses).toEqual([]);
  expect(landings([ferry, groyne])).toEqual([]);
});

test("a ferry line past the loaded ground keeps no vertex at sea level", () => {
  const ferry: RiversideFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, -50],
        [200, -50],
      ],
    },
    properties: { k: "ferry" },
  };
  // No terrain east of x = 100: those samples have no ground.
  const partial: MeshContext = {
    ...ctx,
    heightAt: (x, y) => (x > 100 ? null : ctx.heightAt(x, y)),
  };
  const parts = riversideParts([ferry], partial);
  expect(bottomY(parts.ferry.pos)).toBeCloseTo(104.06, 4);
});
