import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyFeature,
  FeatureCollection,
  LampFeature,
  RailFeature,
  TreeFeature,
  VegRowFeature,
  WallFeature,
} from "./features";
import { TILE_BLOCK, type TileArtifact, tileArtifacts } from "./tile";

// The committed bakes under data/dlm, checked against the shapes the layers
// read. Every tile, every kind — a renamed property or a geometry type the
// bake starts writing shows up here, not as a silently empty layer.
const DATA = join(import.meta.dir, "..", "..", "data", "dlm");

function load<F>(artifact: TileArtifact): F[] {
  const path = join(DATA, artifact.file);
  if (!existsSync(path)) {
    // An optional artifact may be absent (the loader treats it as "off"); a
    // required one must be committed, or prepare-data fails at build time.
    expect(artifact.required).toBe(false);
    return [];
  }
  const doc = JSON.parse(readFileSync(path, "utf8")) as FeatureCollection<F>;
  expect(Array.isArray(doc.features)).toBe(true);
  return doc.features ?? [];
}

const isPoint2 = (p: unknown): boolean =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every((v) => typeof v === "number" && Number.isFinite(v));

const isLine = (coords: unknown): boolean =>
  Array.isArray(coords) && coords.length >= 2 && coords.every(isPoint2);

const isRing = (ring: unknown): boolean =>
  Array.isArray(ring) && ring.length >= 4 && ring.every(isPoint2);

const cases = TILE_BLOCK.map(
  (spec) => [spec.tile, tileArtifacts(spec)] as const
);

test.each(cases)("%s: tree rows are hedge/treerow LineStrings", (_, a) => {
  for (const f of load<VegRowFeature>(a.vegrows)) {
    expect(f.geometry.type).toBe("LineString");
    expect(isLine(f.geometry.coordinates)).toBe(true);
    expect(["hedge", "treerow"]).toContain(f.properties?.kind ?? "");
  }
});

test.each(cases)("%s: canopy points carry a finite height", (_, a) => {
  for (const f of load<CanopyFeature>(a.canopy)) {
    expect(f.geometry.type).toBe("Point");
    expect(isPoint2(f.geometry.coordinates)).toBe(true);
    expect(Number.isFinite(f.properties?.h)).toBe(true);
  }
});

test.each(cases)(
  "%s: lamps are points, walls are LineStrings with a height",
  (_, a) => {
    for (const f of load<LampFeature>(a.lamps)) {
      expect(f.geometry.type).toBe("Point");
      expect(isPoint2(f.geometry.coordinates)).toBe(true);
    }
    for (const f of load<WallFeature>(a.walls)) {
      expect(f.geometry.type).toBe("LineString");
      expect(isLine(f.geometry.coordinates)).toBe(true);
      expect(typeof f.properties?.kind).toBe("string");
      expect(Number.isFinite(f.properties?.h)).toBe(true);
    }
  }
);

test.each(cases)("%s: rails, bridges, ballast and platforms", (_, a) => {
  for (const f of load<RailFeature>(a.rail)) {
    expect(f.geometry.type).toBe("LineString");
    expect(isLine(f.geometry.coordinates)).toBe(true);
  }
  for (const f of load<BridgeFeature>(a.bridge)) {
    expect(f.geometry.type).toBe("Polygon");
    const outer = f.geometry.coordinates[0];
    expect(isRing(outer)).toBe(true);
    // One deck height per outer-ring vertex, when the bake measured any.
    const deck = f.properties?.deck;
    if (deck) {
      expect(deck).toHaveLength(outer.length);
      expect(deck.every((z) => Number.isFinite(z))).toBe(true);
    }
  }
  for (const kind of ["railarea", "platform"] as const) {
    for (const f of load<AreaFeature>(a[kind])) {
      const g = f.geometry;
      expect(g).not.toBeNull();
      if (g?.type === "Polygon") {
        expect(isRing(g.coordinates[0])).toBe(true);
      } else if (g?.type === "MultiPolygon") {
        expect(g.coordinates.every((poly) => isRing(poly[0]))).toBe(true);
      } else {
        expect(g?.type).toBe("LineString");
        expect(isLine(g?.coordinates)).toBe(true);
      }
    }
  }
});

test.each(cases)(
  "%s: inventory trees carry height, crown, archetype and leaf type",
  (_, a) => {
    for (const f of load<TreeFeature>(a.trees)) {
      expect(f.geometry.type).toBe("Point");
      expect(isPoint2(f.geometry.coordinates)).toBe(true);
      const p = f.properties;
      expect(Number.isFinite(p?.h)).toBe(true);
      expect(Number.isFinite(p?.d)).toBe(true);
      expect(Number.isInteger(p?.a)).toBe(true);
      expect(["d", "e"]).toContain(p?.l ?? "");
    }
  }
);
