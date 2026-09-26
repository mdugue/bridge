import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyExtraFeature,
  CanopyFeature,
  CultivatedFeature,
  FeatureCollection,
  FurnitureFeature,
  LampFeature,
  LowVegFeature,
  MonumentFeature,
  RailFeature,
  RiversideFeature,
  SoundmarkFeature,
  SmallBuildingFeature,
  StairFeature,
  TerraceFeature,
  TramFeature,
  TreeFeature,
  VegRowFeature,
  WallFileFeature,
  KerbFeature,
} from "./features";
import { SITES } from "../../sites";
import { type Site, tileExtentOf, tileIdOf } from "./site";
import { TREE_GENERA } from "./tree-season";
import {
  cityMeshSourceFiles,
  sideFileSource,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  tileIds,
  wallSourceFile,
  kerbSourceFile,
} from "./tile";

// The bakes under data/<site>/dlm, checked against the shapes the layers
// read. Every site whose bakes are all on disk (Dresden's are committed;
// another site's once `bun run bake` has finished — a half-baked one is
// skipped, `bun run site` reports it), every tile, every kind — a renamed
// property or a geometry type the bake starts writing shows up here, not as
// a silently empty layer.
const ROOT = join(import.meta.dir, "..", "..");

interface Source {
  path: string;
  required: boolean;
}

function load<F>({ path, required }: Source): F[] {
  if (!existsSync(path)) {
    // An optional artifact may be absent (the loader treats it as "off"); a
    // required one must be there, or prepare-data fails at build time.
    expect(required).toBe(false);
    return [];
  }
  const doc = JSON.parse(readFileSync(path, "utf8")) as FeatureCollection<F>;
  expect(Array.isArray(doc.features)).toBe(true);
  return doc.features ?? [];
}

/** A bake input under data/<site>/ (never served), or none. */
function loadSource<F>(file: string): F[] {
  const path = join(ROOT, file);
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

const baked = (site: Site) =>
  tileIds(site).every((tile) =>
    Object.values(tileArtifacts(tile))
      .filter((a) => a.required && !a.bakedFrom)
      .every((a) => existsSync(join(ROOT, sideFileSource(site, a.file))))
  );

const SITES_BAKED: Site[] = Object.values(SITES).filter(baked);

const cases = SITES_BAKED.flatMap((site) =>
  tileIds(site).map((tile) => {
    const sources = Object.fromEntries(
      Object.entries(tileArtifacts(tile)).map(([kind, a]) => [
        kind,
        {
          path: join(ROOT, sideFileSource(site, a.file)),
          required: a.required,
        },
      ])
    ) as Record<keyof ReturnType<typeof tileArtifacts>, Source>;
    return [tile, sources] as const;
  })
);

/** Every tile of every baked site, for the bake inputs (never served). */
const tiles = SITES_BAKED.flatMap((site) =>
  tileIds(site).map((tile) => [tile, site] as const)
);

test("Dresden's committed data is among the checked sites", () => {
  expect(cases.some(([tile]) => tile === "33412_5656_2_sn")).toBe(true);
});

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
      "column",
      "signal",
      "hydrant",
      "hydrantsign",
      "clock",
      "wallclock",
      "water",
      "stop",
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
      if (f.properties?.lit !== undefined) {
        expect(kind).toBe("column");
      }
      // what has a front faces somewhere; round things do not
      if (["column", "hydrant", "bin", "bollard"].includes(kind)) {
        expect(bearing).toBeUndefined();
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

test.each(tiles)(
  "%s: small structures are rectangles with a ground and a top in range",
  (tile, site) => {
    const src = cityMeshSourceFiles(site, tile).smallBuild;
    for (const f of loadSource<SmallBuildingFeature>(src)) {
      expect(f.geometry.type).toBe("Polygon");
      const ring = f.geometry.coordinates[0];
      expect(isRing(ring)).toBe(true);
      expect(ring.length).toBe(5);
      const p = f.properties;
      expect(Number.isFinite(p?.z)).toBe(true);
      // the bake's band: 2–6.5 m above ground (a pent corner may dip)
      expect(p?.h ?? 0).toBeGreaterThan(1.5);
      expect(p?.h ?? 99).toBeLessThan(8);
      if (p?.hc !== undefined) {
        expect(p.hc.length).toBe(4);
        expect(p.hc.every((h) => h > 1 && h < 12)).toBe(true);
      }
    }
  }
);

test.each(tiles)("%s: kerbs are LineStrings", (tile, site) => {
  for (const f of loadSource<KerbFeature>(kerbSourceFile(site, tile))) {
    expect(f.geometry.type).toBe("LineString");
    expect(isLine(f.geometry.coordinates)).toBe(true);
  }
});

test.each(tiles)(
  "%s: walls and fences are LineStrings with a kind and a height, gates points with a width",
  (tile, site) => {
    const kinds: string[] = [];
    for (const f of loadSource<WallFileFeature>(wallSourceFile(site, tile))) {
      const kind = f.properties?.kind ?? "";
      kinds.push(kind);
      if (f.geometry.type === "Point") {
        expect(kind).toBe("gate");
        expect(isPoint2(f.geometry.coordinates)).toBe(true);
        const gate = f.properties as { on?: string; w?: number } | null;
        expect(["fence", "wall"]).toContain(gate?.on ?? "");
        expect(gate?.w ?? 0).toBeGreaterThan(0);
        continue;
      }
      expect(f.geometry.type).toBe("LineString");
      expect(isLine(f.geometry.coordinates)).toBe(true);
      expect(typeof kind).toBe("string");
      expect(Number.isFinite((f.properties as { h?: number } | null)?.h)).toBe(
        true
      );
      if (kind === "fence") {
        const type = (f.properties as { type?: string } | null)?.type ?? "";
        expect(["railing", "mesh", "picket", "rail"]).toContain(type);
      }
    }
    // The walls first (the terrain study addresses them by index), then the
    // fences, then the gates.
    const rank = (k: string) => (k === "gate" ? 2 : k === "fence" ? 1 : 0);
    const ranks = kinds.map(rank);
    expect(ranks).toEqual(ranks.toSorted((a, b) => a - b));
  }
);

test.each(
  SITES_BAKED.flatMap((site) =>
    site.tiles.map((cell) => [tileIdOf(site, cell), cell, site] as const)
  )
)("%s: no wall or fence runs along the tile's edge", (tile, cell, site) => {
  // An area clipped as a polygon closes its ring along the tile edge: a
  // wall or fence on the seam that stands nowhere (walls.py clips rings).
  const [x0, y0, x1, y1] = tileExtentOf(cell);
  const onEdge = (a: number[], b: number[]) =>
    [
      [0, x0],
      [0, x1],
      [1, y0],
      [1, y1],
    ].some(
      ([axis, v]) =>
        Math.abs(a[axis] - v) < 0.005 && Math.abs(b[axis] - v) < 0.005
    );
  let metres = 0;
  for (const f of loadSource<WallFileFeature>(wallSourceFile(site, tile))) {
    if (f.geometry.type !== "LineString") {
      continue;
    }
    const c = f.geometry.coordinates;
    for (let i = 1; i < c.length; i++) {
      if (onEdge(c[i - 1], c[i])) {
        metres += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
      }
    }
  }
  expect(metres).toBe(0);
});

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

test.each(tiles)(
  "%s: stairs run bottom → top with a width, steps and landings",
  (tile, site) => {
    for (const f of loadSource<StairFeature>(stairSourceFile(site, tile))) {
      expect(f.geometry.type).toBe("LineString");
      expect(isLine(f.geometry.coordinates)).toBe(true);
      expect(f.properties?.w).toBeGreaterThan(0);
      expect(Number.isInteger(f.properties?.n)).toBe(true);
      const [lo, hi] = f.properties?.z ?? [Number.NaN, Number.NaN];
      expect(hi).toBeGreaterThan(lo);
    }
  }
);

test.each(tiles)(
  "%s: terraces are polygons with a level above the ground",
  (tile, site) => {
    for (const f of loadSource<TerraceFeature>(terraceSourceFile(site, tile))) {
      expect(["Polygon", "MultiPolygon"]).toContain(f.geometry?.type ?? "");
      // an absolute level (NHN), not a height: Hamburg's lie near 0 m,
      // Germany's lowest ground at −3.5 m
      expect(f.properties?.z).toBeGreaterThan(-5);
    }
  }
);

test.each(cases)(
  "%s: hedges are OSM lines (h, w); extra trees are points (h, r)",
  (_, a) => {
    for (const f of load<LowVegFeature>(a.lowveg)) {
      const p = f.properties;
      // Only what renders is shipped: no laser-scan-only hedges, no shrubs.
      expect(["osm", "osm+lsc"]).toContain(p?.src ?? "");
      expect(p?.kind).toBe("hedge");
      expect(f.geometry.type).toBe("LineString");
      expect(isLine(f.geometry.coordinates)).toBe(true);
      expect(Number.isFinite(p?.h)).toBe(true);
      expect(Number.isFinite(p?.w)).toBe(true);
    }
    for (const f of load<CanopyExtraFeature>(a.canopyx)) {
      expect(f.geometry.type).toBe("Point");
      expect(isPoint2(f.geometry.coordinates)).toBe(true);
      expect(Number.isFinite(f.properties?.h)).toBe(true);
      expect(Number.isFinite(f.properties?.r)).toBe(true);
    }
  }
);

test.each(cases)(
  "%s: cultivated land: colonies, parcels, orchards and their trees, vine rows",
  (_, a) => {
    for (const f of load<CultivatedFeature>(a.cultivated)) {
      const k = f.properties?.k ?? "";
      expect([
        "colony",
        "parcel",
        "orchard",
        "tree",
        "vineyard",
        "row",
      ]).toContain(k);
      const type = f.geometry?.type ?? "";
      if (k === "tree") {
        expect(type).toBe("Point");
        expect(Number.isFinite(f.properties?.h)).toBe(true);
        expect(Number.isFinite(f.properties?.d)).toBe(true);
        expect(["grid", "osm"]).toContain(f.properties?.src ?? "");
      } else if (k === "row") {
        expect(type).toBe("LineString");
      } else {
        expect(["Polygon", "MultiPolygon"]).toContain(type);
      }
    }
  }
);

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
      // genus: an index into the season table; trunk: cm; source: OSM or
      // (absent) the cadastre
      const gn = p?.gn ?? 0;
      expect(Number.isInteger(gn) && gn >= 0).toBe(true);
      expect(gn).toBeLessThan(TREE_GENERA.length);
      if (p?.t !== undefined) {
        expect(p.t > 0 && p.t <= 400).toBe(true);
      }
      expect([undefined, "osm"]).toContain(p?.s);
    }
  }
);

test.each(cases)(
  "%s: the trees' genus table is the season model's, in order",
  (_, a) => {
    const path = a.trees.path;
    if (!existsSync(path)) {
      return;
    }
    const doc = JSON.parse(readFileSync(path, "utf8")) as {
      genera?: string[];
    };
    expect(doc.genera).toEqual([...TREE_GENERA]);
  }
);

test.each(cases)(
  "%s: trams are bedded tracks, masts, support wires and stop signs",
  (_, a) => {
    for (const f of load<TramFeature>(a.tram)) {
      const p = f.properties;
      const g = f.geometry;
      expect(["arm", "mast", "rosette", "span", "stop", "track"]).toContain(
        p?.k ?? ""
      );
      if (p?.k === "mast" || p?.k === "stop") {
        expect(g.type).toBe("Point");
        expect(isPoint2(g.coordinates)).toBe(true);
        continue;
      }
      expect(g.type).toBe("LineString");
      expect(isLine(g.coordinates)).toBe(true);
      if (p?.k === "track") {
        expect(["ballast", "grass", "street"]).toContain(p.bed ?? "");
        const s = p.s ?? [];
        expect(s.every((d, i) => d >= 0 && (i === 0 || d > s[i - 1]))).toBe(
          true
        );
      } else {
        // Supports run between two anchors.
        expect(g.coordinates).toHaveLength(2);
        for (const x of p?.x ?? []) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
        }
      }
    }
  }
);

test.each(cases)("%s: bell towers are sized points", (_, a) => {
  for (const f of load<SoundmarkFeature>(a.soundmarks)) {
    const p = f.properties;
    expect(f.geometry.type).toBe("Point");
    expect(isPoint2(f.geometry.coordinates)).toBe(true);
    expect(p?.k).toBe("bell");
    expect(["large", "medium", "small"]).toContain(p?.size ?? "");
    expect(p?.h).toBeGreaterThan(0);
  }
});

test.each(cases)(
  "%s: the river's piers, pontoons, groynes and ferry lines",
  (_, a) => {
    for (const f of load<RiversideFeature>(a.riverside)) {
      const p = f.properties;
      const g = f.geometry;
      expect(["ferry", "groyne", "pier", "pontoon"]).toContain(p?.k ?? "");
      if (p?.k === "pier" || p?.k === "pontoon") {
        expect(g.type).toBe("Polygon");
        if (g.type === "Polygon") {
          expect(isRing(g.coordinates[0])).toBe(true);
        }
      } else {
        expect(g.type).toBe("LineString");
        expect(isLine(g.coordinates)).toBe(true);
      }
      if (p?.k === "pier") {
        expect(Number.isFinite(p.deck)).toBe(true);
      }
      if (p?.k === "pontoon") {
        expect(p.len).toBeGreaterThan(0);
        if (p.bank) {
          expect(isPoint2(p.bank)).toBe(true);
        }
      }
    }
  }
);
