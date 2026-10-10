import { expect, test } from "bun:test";
import { ShapeUtils, Vector2 } from "three";
import { deckLift } from "./decks";
import type { BridgeFeature, TramFeature } from "./features";
import { checkJoins } from "./ground-join";
import type { Mesh3, Triangulate } from "./mesh3";
import { buildDeckTable, type MeshContext } from "./rail-mesh";
import { CONTACT_WIRE_M, RAIL_TOP_M } from "./tram";
import { tramParts, tramStops } from "./tram-mesh";

const triangulate: Triangulate = (contour, holes) =>
  ShapeUtils.triangulateShape(
    contour.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y)))
  );

const ctx: MeshContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 100,
  triangulate,
};

const track = (
  bed: "ballast" | "grass" | "street",
  extra: Partial<NonNullable<TramFeature["properties"]>> = {}
): TramFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [60, 0],
    ],
  },
  properties: { k: "track", bed, s: [30], ...extra },
});

const maxY = (pos: readonly number[]): number => {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < pos.length; i += 3) {
    max = Math.max(max, pos[i]);
  }
  return max;
};
const empty = (acc: Mesh3) => acc.pos.length === 0;

test("no features, no parts", () => {
  const parts = tramParts([], [], ctx);
  expect(Object.values(parts.tracks).every(empty)).toBe(true);
  expect(parts.wires.index).toEqual([]);
  expect(parts.masts).toEqual([]);
  expect(parts.joins).toEqual([]);
});

test("a street track is flush rails with its wire 5.6 m up", () => {
  const parts = tramParts([track("street")], [], ctx);
  // rail heads, no groove, no bed strip
  expect(empty(parts.tracks.streetRail)).toBe(false);
  expect(empty(parts.tracks.rail)).toBe(true);
  expect(empty(parts.tracks.grass)).toBe(true);
  expect(maxY(parts.tracks.streetRail.pos)).toBeCloseTo(
    100 + RAIL_TOP_M.street,
    5
  );
  expect(maxY(parts.wires.pos)).toBeCloseTo(
    100 + RAIL_TOP_M.street + CONTACT_WIRE_M,
    5
  );
  // each wire vertex has its direction, side and half-width
  const n = parts.wires.pos.length / 3;
  expect(parts.wires.dir.length).toBe(n * 3);
  expect(parts.wires.side.length).toBe(n);
  expect(parts.wires.half.length).toBe(n);
});

test("a lawn track has rails and a meadow strip under them", () => {
  const parts = tramParts([track("grass")], [], ctx);
  expect(empty(parts.tracks.rail)).toBe(false);
  expect(empty(parts.tracks.grass)).toBe(false);
  expect(empty(parts.tracks.streetRail)).toBe(true);
});

test("masts stand where they are mapped; a span hangs over the wire it crosses", () => {
  const mast = (x: number, y: number): TramFeature => ({
    geometry: { type: "Point", coordinates: [x, y] },
    properties: { k: "mast" },
  });
  const span: TramFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [30, -8],
        [30, 8],
      ],
    },
    properties: { k: "span", x: [0.5] },
  };
  const parts = tramParts(
    [track("street"), mast(30, -8), mast(30, 8), span],
    [],
    ctx
  );
  expect(parts.masts).toHaveLength(2);
  // a mast's foot 0.2 m into the ground
  expect(parts.masts[0].y).toBeCloseTo(99.8, 5);
  // the span's anchors are 7 m up the masts
  expect(maxY(parts.wires.pos)).toBeCloseTo(107, 5);
});

test("a track the OSM way puts on a bridge rides the deck, along its ramp", () => {
  const deck: BridgeFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, -5],
          [60, -5],
          [60, 5],
          [0, 5],
          [0, -5],
        ],
      ],
    },
    properties: { kind: "road", deck: [104, 108, 108, 104, 104] },
  };
  const decks = buildDeckTable([deck], { offset: ctx.offset });
  // world z = −y: the lift is read in the Y-up frame
  expect(deckLift(decks, 30, 0)).toBeCloseTo(106, 5);
  expect(deckLift(decks, 30, 0, ["rail"])).toBeNull();
  const on = tramParts([track("street", { bridge: 1 })], [deck], ctx);
  const off = tramParts([track("street")], [deck], ctx);
  expect(maxY(on.tracks.streetRail.pos)).toBeGreaterThan(107);
  expect(maxY(off.tracks.streetRail.pos)).toBeCloseTo(
    100 + RAIL_TOP_M.street,
    5
  );
  // on the deck the track stands on the deck: no feet of its own there
  expect(on.joins.length).toBeLessThan(off.joins.length);
});

test("a track meets the ground at its webs and its strip's edges", () => {
  for (const bed of ["street", "grass", "ballast"] as const) {
    const parts = tramParts([track(bed)], [], ctx);
    expect(parts.joins.length).toBeGreaterThan(0);
    expect(checkJoins(parts.joins, ctx.heightAt).misses).toEqual([]);
  }
  // across a slope steeper than the lawn strip's web is deep, its downhill
  // edge stands over the ground
  const slope = { ...ctx, heightAt: (_x: number, y: number) => 100 + y * 0.3 };
  const tilted = tramParts([track("grass")], [], slope);
  expect(
    checkJoins(tilted.joins, slope.heightAt).misses.length
  ).toBeGreaterThan(0);
});

test("the stops are what the viewer stands a sign at and the inquiry asks", () => {
  const stop: TramFeature = {
    geometry: { type: "Point", coordinates: [10, 3] },
    properties: { k: "stop", a: 180, name: "Albertplatz" },
  };
  expect(tramStops([track("street"), stop])).toEqual([stop]);
});
