import { expect, test } from "bun:test";
import { ShapeUtils, Vector2 } from "three";
import { deckLift, ringToWorld } from "./decks";
import type { AreaFeature, BridgeFeature, RailFeature } from "./features";
import { checkJoins } from "./ground-join";
import type { Mesh3, Triangulate } from "./mesh3";
import {
  approaches,
  ballastMesh,
  buildDeckTable,
  type RailContext,
  railParts,
} from "./rail-mesh";

const triangulate: Triangulate = (contour, holes) =>
  ShapeUtils.triangulateShape(
    contour.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y)))
  );

const ctx: RailContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 100,
  triangulate,
};

const square = (x: number, y: number, s = 10): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

const polygon: AreaFeature = {
  geometry: { type: "Polygon", coordinates: [square(0, 0)] },
  properties: {},
};

const multiPolygon: AreaFeature = {
  geometry: {
    type: "MultiPolygon",
    coordinates: [[square(100, 0)], [square(200, 0)]],
  },
  properties: {},
};

const triangles = (acc: Mesh3): number => acc.pos.length / 9;

/** The soup's extent, per axis (Y-up world). */
function bounds(...accs: Mesh3[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const acc of accs) {
    for (let i = 0; i < acc.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], acc.pos[i + k]);
        max[k] = Math.max(max[k], acc.pos[i + k]);
      }
    }
  }
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
  };
}

const none = { rails: [], bridges: [], ballast: [], platforms: [] };

test("a Polygon ballast area builds a slab", () => {
  expect(triangles(ballastMesh([polygon], ctx))).toBeGreaterThan(0);
});

test("a yard across an underpass follows the ground, not its corners", () => {
  // the embankment at 117 m, a street at 111 m through it (x 40–60); the
  // yard's outline has corners down in the street
  const underpass: RailContext = {
    ...ctx,
    heightAt: (x) => (x > 40 && x < 60 ? 111 : 117),
  };
  const yard: AreaFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [45, 0],
          [55, 0],
          [100, 0],
          [100, 30],
          [55, 30],
          [45, 30],
          [0, 30],
          [0, 0],
        ],
      ],
    },
    properties: {},
  };
  const { pos } = ballastMesh([yard], underpass);
  expect(pos.length).toBeGreaterThan(0);
  let overStreet = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const mx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
    const top = Math.max(pos[i + 1], pos[i + 4], pos[i + 7]);
    if (mx > 44 && mx < 56 && top > 113) {
      overStreet++;
    }
  }
  // no sheet stands over the street, closing the passage
  expect(overStreet).toBe(0);
});

test("MultiPolygon ballast contributes every part", () => {
  const single = triangles(ballastMesh([polygon], ctx));
  const multi = triangles(ballastMesh([polygon, multiPolygon], ctx));
  // Two extra squares → three times the geometry of one.
  expect(multi).toBe(single * 3);
});

test("null properties and geometries are tolerated", () => {
  const nullProps: AreaFeature = {
    geometry: { type: "Polygon", coordinates: [square(0, 0)] },
    properties: null,
  };
  expect(triangles(ballastMesh([nullProps], ctx))).toBeGreaterThan(0);
  const nullGeometry: AreaFeature = { geometry: null, properties: null };
  expect(triangles(ballastMesh([nullGeometry, polygon], ctx))).toBeGreaterThan(
    0
  );
  expect(triangles(ballastMesh([nullGeometry], ctx))).toBe(0);
});

test("railParts: nothing from nothing; a track and a platform each a part", () => {
  const empty = railParts(none, ctx);
  for (const part of [
    empty.ballast,
    empty.tracks,
    empty.platforms,
    empty.spanTop,
    empty.spanStone,
  ]) {
    expect(triangles(part)).toBe(0);
  }
  expect(empty.joins).toEqual([]);
  const track: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [40, 0],
      ],
    },
    properties: { tracks: 2 },
  };
  const built = railParts(
    { ...none, rails: [track], platforms: [polygon] },
    ctx
  );
  expect(triangles(built.tracks)).toBeGreaterThan(0);
  expect(triangles(built.platforms)).toBeGreaterThan(0);
  expect(triangles(built.spanTop)).toBe(0);
});

test("a track over the gap the DGM leaves beside a bridge spans it on a deck of its own", () => {
  // an embankment at 117.5 with a 40 m gap down to the street at 111.5 —
  // a bridge with no deck outline in the data
  const gap: RailContext = {
    ...ctx,
    heightAt: (x) => (x > 80 && x < 120 ? 111.5 : 117.5),
  };
  const track: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [200, 0],
      ],
    },
    properties: { tracks: 1 },
  };
  const built = railParts({ ...none, rails: [track] }, gap);
  // the rails never dip into the gap
  expect(bounds(built.tracks).min.y).toBeGreaterThan(117.5);
  // and a deck stands under them, at their level, on piers down to the
  // street
  const deck = bounds(built.spanTop, built.spanStone);
  expect(deck.min.x).toBeLessThan(85);
  expect(deck.max.x).toBeGreaterThan(115);
  expect(deck.max.y).toBeGreaterThan(117.5);
  expect(deck.min.y).toBeLessThan(111.5);
  // its piers' feet reach the street
  expect(built.joins.length).toBeGreaterThan(0);
  expect(checkJoins(built.joins, gap.heightAt).misses).toEqual([]);
});

test("a yard and a platform report their feet, on the ground they stood on", () => {
  // a ground that rises 2 m across the yard: the fascia's foot follows it
  const slope: RailContext = { ...ctx, heightAt: (x) => 100 + x * 0.02 };
  const built = railParts(
    { ...none, ballast: [multiPolygon], platforms: [polygon] },
    slope
  );
  expect(built.joins.length).toBeGreaterThan(0);
  expect(built.joins.every((j) => j.kind === "foot")).toBe(true);
  expect(checkJoins(built.joins, slope.heightAt).misses).toEqual([]);
  // a dip between two outline samples the fascia does not reach: a miss
  const dip: RailContext = {
    ...ctx,
    heightAt: (x) => (Math.abs(x - 103) < 1 ? 99 : 100),
  };
  const yard: AreaFeature = {
    geometry: { type: "Polygon", coordinates: [square(100, 0, 6)] },
    properties: {},
  };
  const dipped = railParts({ ...none, ballast: [yard] }, dip);
  expect(checkJoins(dipped.joins, dip.heightAt).misses.length).toBeGreaterThan(
    0
  );
  // a line-mapped platform is a ribbon at platform height: no joins
  const line: AreaFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [30, 0],
      ],
    },
    properties: {},
  };
  const ribbon = railParts({ ...none, platforms: [line] }, ctx);
  expect(triangles(ribbon.platforms)).toBeGreaterThan(0);
  expect(ribbon.joins).toEqual([]);
});

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
