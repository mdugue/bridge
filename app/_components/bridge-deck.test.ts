import { expect, test } from "bun:test";
import type { BridgeFeature } from "@/lib/city/features";
import { deckLift, ringToWorld } from "@/lib/city/decks";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { approaches, buildDeckTable } from "./bridge-deck";

const ctx: GroundContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 100,
};

const square = (x: number, y: number, s = 10): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

test("a deck end above the ground gets an approach down to it", () => {
  // 40 m along x, 10 m wide, its top 101 m over flat ground at 100 m
  const ring = ringToWorld(
    square(0, -5, 10).map(([x, y]) => [x * 4, y]),
    {
      cx: 0,
      cy: 0,
    }
  );
  const topY = ring.pts.map(() => 101);
  const found = approaches(ring, topY, "road", undefined, ctx, []);
  expect(found.length).toBe(2);
  for (const a of found) {
    for (const c of a.columns) {
      const run = Math.hypot(c.land.x - c.x, c.land.z - c.z);
      // at 8 % a metre's drop lands 12 m out, at the ground
      expect(run).toBeCloseTo(12, 5);
      expect(c.land.y).toBeCloseTo(100.04, 5);
      // it runs away from the deck, along x
      expect(Math.abs(a.dir.x)).toBeCloseTo(1, 5);
      expect(c.land.x < 0 || c.land.x > 40).toBe(true);
    }
  }
  // flush with the ground: none
  const flush = ring.pts.map(() => 100.02);
  expect(approaches(ring, flush, "road", undefined, ctx, [])).toEqual([]);
  // an end continued by another deck: none there
  const next = ringToWorld(square(40, -5, 10), { cx: 0, cy: 0 });
  const other = buildDeckTable(
    [
      {
        geometry: { type: "Polygon", coordinates: [square(40, -5, 10)] },
        properties: { kind: "road", deck: next.pts.map(() => 101) },
      },
    ],
    { offset: ctx.offset }
  );
  expect(approaches(ring, topY, "road", undefined, ctx, other).length).toBe(1);
});

test("the lift table carries the approaches for what rides up to a deck", () => {
  const bridge: BridgeFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [square(0, -5, 10).map(([x, y]) => [x * 4, y])],
    },
    properties: { kind: "road", deck: [101, 101, 101, 101, 101] },
  };
  const decks = buildDeckTable([bridge], ctx);
  // 6 m out from the west end (world x = −6), halfway down the approach
  expect(deckLift(decks, -6, 0, undefined, "ramps")).toBeCloseTo(100.52, 1);
  expect(deckLift(decks, -6, 0, undefined, "decks")).toBeNull();
  expect(deckLift(decks, 20, 0, undefined, "decks")).toBeCloseTo(101, 5);
  // without the ground, only the decks
  expect(buildDeckTable([bridge], { offset: ctx.offset }).length).toBe(1);
});
