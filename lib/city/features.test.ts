import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyFeature,
  FeatureCollection,
  FurnitureFeature,
  LampFeature,
  MonumentFeature,
  RailFeature,
  StairFeature,
  TerraceFeature,
  VegRowFeature,
  WallFeature,
  KerbFeature,
} from "./features";
import { DRESDEN } from "../../sites/dresden";
import {
  stairSourceFile,
  type TileArtifact,
  terraceSourceFile,
  tileArtifacts,
  tileIds,
  wallSourceFile,
  kerbSourceFile,
} from "./tile";

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

/** A terrain-bake input under data/dlm (never served), or none. */
function loadSource<F>(file: string): F[] {
  const path = join(DATA, "..", "..", file);
  if (!existsSync(path)) {
    return [];
  }
  return (
    (JSON.parse(readFileSync(path, "utf8")) as FeatureCollection<F>).features ??
    []
  );
}

const isPoint2 = (p: unknown): boolean =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every((v) => typeof v === "number" && Number.isFinite(v));

const isLine = (coords: unknown): boolean =>
  Array.isArray(coords) && coords.length >= 2 && coords.every(isPoint2);

const isRing = (ring: unknown): boolean =>
  Array.isArray(ring) && ring.length >= 4 && ring.every(isPoint2);

const cases = tileIds(DRESDEN).map(
  (tile) => [tile, tileArtifacts(tile)] as const
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
  "%s: street furniture is kinded points, playgrounds and sandpits outlines",
  (_, a) => {
    const kinds = [
      "bench",
      "bike",
      "bin",
      "bollard",
      "picnic",
      "postbox",
      "shelter",
      "playground",
      "swing",
      "slide",
      "sandpit",
      "climb",
      "springy",
      "seesaw",
      "roundabout",
      "playhouse",
    ];
    const features = load<FurnitureFeature>(a.furniture);
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) {
      const kind = f.properties?.k ?? "";
      expect(kinds).toContain(kind);
      const g = f.geometry;
      if (g.type === "Polygon") {
        expect(["playground", "sandpit"]).toContain(kind);
        expect(g.coordinates.every(isRing)).toBe(true);
      } else {
        expect(g.type).toBe("Point");
        expect(isPoint2(g.coordinates)).toBe(true);
        expect(kind).not.toBe("playground");
      }
      const bearing = f.properties?.a;
      if (bearing !== undefined) {
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThanOrEqual(360);
      }
      if (kind === "bike") {
        expect(f.properties?.n).toBeGreaterThanOrEqual(1);
      }
      if (f.properties?.h !== undefined) {
        expect(kind).toBe("bollard");
        expect(f.properties.h).toBeGreaterThan(0);
      }
    }
  }
);

test.each(cases)("%s: lamps are points", (_, a) => {
  for (const f of load<LampFeature>(a.lamps)) {
    expect(f.geometry.type).toBe("Point");
    expect(isPoint2(f.geometry.coordinates)).toBe(true);
  }
});

test.each(tileIds(DRESDEN))("%s: kerbs are LineStrings", (tile) => {
  for (const f of loadSource<KerbFeature>(kerbSourceFile(tile))) {
    expect(f.geometry.type).toBe("LineString");
    expect(isLine(f.geometry.coordinates)).toBe(true);
  }
});

test.each(tileIds(DRESDEN))(
  "%s: walls are LineStrings with a kind and a height",
  (tile) => {
    for (const f of loadSource<WallFeature>(wallSourceFile(tile))) {
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
  "%s: monuments are kinded points, fountains may be basin rings",
  (_, a) => {
    for (const f of load<MonumentFeature>(a.monuments)) {
      const kind = f.properties?.kind;
      expect(["column", "fountain", "statue", "stone"]).toContain(kind ?? "");
      const g = f.geometry;
      if (g.type === "Polygon") {
        // Only a fountain has an outline: the rim, its hole the water.
        expect(kind).toBe("fountain");
        expect(g.coordinates.length).toBeLessThanOrEqual(2);
        expect(g.coordinates.every(isRing)).toBe(true);
      } else {
        expect(g.type).toBe("Point");
        expect(isPoint2(g.coordinates)).toBe(true);
      }
      if (kind === "fountain") {
        expect(["basin", "pool", "splash"]).toContain(
          f.properties?.style ?? ""
        );
      }
    }
  }
);

test.each(tileIds(DRESDEN))(
  "%s: stairs run bottom → top with a width, steps and landings",
  (tile) => {
    for (const f of loadSource<StairFeature>(stairSourceFile(tile))) {
      expect(f.geometry.type).toBe("LineString");
      expect(isLine(f.geometry.coordinates)).toBe(true);
      expect(f.properties?.w).toBeGreaterThan(0);
      expect(Number.isInteger(f.properties?.n)).toBe(true);
      const [lo, hi] = f.properties?.z ?? [Number.NaN, Number.NaN];
      expect(hi).toBeGreaterThan(lo);
    }
  }
);

test.each(tileIds(DRESDEN))(
  "%s: terraces are polygons with a level above the ground",
  (tile) => {
    for (const f of loadSource<TerraceFeature>(terraceSourceFile(tile))) {
      expect(["Polygon", "MultiPolygon"]).toContain(f.geometry?.type ?? "");
      expect(f.properties?.z).toBeGreaterThan(50);
    }
  }
);
