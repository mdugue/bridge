import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AreaFeature,
  BridgeFeature,
  CanopyExtraFeature,
  CanopyFeature,
  CultivatedFeature,
  DoorFeature,
  FeatureCollection,
  FurnitureFeature,
  LampFeature,
  LowVegFeature,
  MapillaryFeature,
  MonumentFeature,
  RailFeature,
  RiversideFeature,
  SoundmarkFeature,
  MeasuredRoofFeature,
  SmallBuildingFeature,
  StructureFeature,
  StairFeature,
  TerraceFeature,
  TrafficFeature,
  TramFeature,
  TreeFactsFile,
  TreeFeature,
  VegRowFeature,
  WallFileFeature,
  KerbFeature,
} from "./features";
import { SITES } from "../../sites";
import { STRUCTURE_KINDS } from "./features";
import { type Site, tileExtentOf, tileIdOf } from "./site";
import { TREE_GENERA } from "./tree-season";
import { axisFrame, BRIDGE_STEP } from "./bridge";
import {
  cityMeshSourceFiles,
  OSM_KINDS,
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
  const doc = JSON.parse(readFileSync(path, "utf8")) as FeatureCollection<F> & {
    type?: string;
  };
  expect(doc.type).toBe("FeatureCollection");
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

// An empty canopy file is a bake that found no DOM1 and wrote nothing —
// the tile would stand treeless. (Tree rows may be empty: Grimma's and
// Munich's outer tiles have none mapped.)
test.each(cases)("%s: a baked canopy has trees", (_, a) => {
  if (existsSync(a.canopy.path)) {
    expect(load<CanopyFeature>(a.canopy).length).toBeGreaterThan(0);
  }
});

test.each(tiles)("%s: the roof colours are { meta, roofs }", (tile, site) => {
  const path = join(ROOT, cityMeshSourceFiles(site, tile).roofColor);
  if (!existsSync(path)) {
    return;
  }
  const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  expect(typeof doc.meta).toBe("object");
  expect(doc.roofs !== null && typeof doc.roofs === "object").toBe(true);
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
    const wire = f.properties?.wire;
    if (wire) {
      expect(wire).toHaveLength(2);
      expect(wire.every(isPoint2)).toBe(true);
      expect(f.properties?.h).toBeGreaterThan(0);
      expect(f.properties?.masts ?? [false, false]).toHaveLength(2);
    } else {
      expect(f.properties?.masts).toBeUndefined();
    }
  }
});

test.each(cases)("%s: Mapillary's objects are lamp and bin points", (_, a) => {
  for (const f of load<MapillaryFeature>(a.mly)) {
    expect(f.geometry.type).toBe("Point");
    expect(isPoint2(f.geometry.coordinates)).toBe(true);
    expect(["lamp", "bin"]).toContain(f.properties?.k ?? "");
  }
});

test.each(tiles)(
  "%s: doors are points on a wall with a size and a ground",
  (tile, site) => {
    const src = cityMeshSourceFiles(site, tile).doors;
    for (const f of loadSource<DoorFeature>(src)) {
      expect(f.geometry.type).toBe("Point");
      expect(isPoint2(f.geometry.coordinates)).toBe(true);
      const p = f.properties;
      expect(p?.of.length ?? 0).toBeGreaterThan(0);
      expect(Math.hypot(p?.nx ?? 0, p?.ny ?? 0)).toBeCloseTo(1, 3);
      expect(p?.w ?? 0).toBeGreaterThanOrEqual(0.7);
      expect(p?.w ?? 99).toBeLessThanOrEqual(6);
      expect(p?.h ?? 0).toBeGreaterThanOrEqual(1.8);
      expect(p?.h ?? 99).toBeLessThanOrEqual(5);
      expect(Number.isFinite(p?.z)).toBe(true);
    }
  }
);

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

test.each(tiles)(
  "%s: structures beyond LoD2 are columns (points), buildings (outlines) or relief height fields of a measured height",
  (tile, site) => {
    const src = cityMeshSourceFiles(site, tile).structures;
    for (const f of loadSource<StructureFeature>(src)) {
      const p = f.properties;
      expect(STRUCTURE_KINDS as readonly string[]).toContain(p?.kind ?? "none");
      expect(Number.isFinite(p?.z)).toBe(true);
      expect(p?.h ?? 0).toBeGreaterThanOrEqual(p?.kind === "relief" ? 1 : 2);
      expect(p?.h ?? 999).toBeLessThan(400);
      if (p?.kind === "relief") {
        // a slab of a landmark's roof: on the LoD2 object it sits on
        expect(p.of ?? "").not.toBe("");
        const g = p.grid;
        expect(g?.z.length).toBe((g?.rows ?? 0) * (g?.cols ?? 0));
      }
      if (p?.kind === "building" || p?.kind === "relief") {
        expect(f.geometry.type).toBe("Polygon");
        if (f.geometry.type === "Polygon") {
          expect(isRing(f.geometry.coordinates[0])).toBe(true);
        }
      } else {
        expect(f.geometry.type).toBe("Point");
        expect(p?.r ?? 0).toBeGreaterThan(0);
        expect(p?.rt ?? 0).toBeGreaterThan(0);
      }
    }
  }
);

test.each(tiles)(
  "%s: measured roofs are polygons of a LoD2 object at a height in range",
  (tile, site) => {
    const src = cityMeshSourceFiles(site, tile).measuredRoofs;
    for (const f of loadSource<MeasuredRoofFeature>(src)) {
      expect(f.geometry.type).toBe("Polygon");
      expect(f.geometry.coordinates.every(isRing)).toBe(true);
      expect(typeof f.properties?.id).toBe("string");
      // absolute roof heights: Hamburg's harbour to Munich's towers
      expect(f.properties?.z ?? -999).toBeGreaterThan(-20);
      expect(f.properties?.z ?? 9999).toBeLessThan(1000);
      const s = f.properties?.surface;
      if (s) {
        // a face: its grid whole, and wider than the outline it covers
        expect(s.res).toBeGreaterThan(0);
        expect(s.dz).toHaveLength(s.cols * s.rows);
        expect(s.dz.every(Number.isInteger)).toBe(true);
        const ring = f.geometry.coordinates[0];
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(s.x);
          expect(x).toBeLessThanOrEqual(s.x + s.cols * s.res);
          expect(y).toBeLessThanOrEqual(s.y);
          expect(y).toBeGreaterThanOrEqual(s.y - s.rows * s.res);
        }
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
    const tracks = f.properties?.tracks;
    if (tracks !== undefined) {
      expect(Number.isFinite(tracks) && tracks >= 1).toBe(true);
    }
  }
  for (const f of load<BridgeFeature>(a.bridge)) {
    expect(f.geometry.type).toBe("Polygon");
    if (f.properties?.kind !== undefined) {
      expect(["rail", "road", "path", "other"]).toContain(f.properties.kind);
    }
    const outer = f.geometry.coordinates[0];
    expect(isRing(outer)).toBe(true);
    // One deck height per outer-ring vertex, when the bake measured any.
    const deck = f.properties?.deck;
    if (deck) {
      expect(deck).toHaveLength(outer.length);
      expect(deck.every((z) => Number.isFinite(z))).toBe(true);
    }
    // The measured extras (ADR 0033) share the axis's 2 m stations.
    const p = f.properties;
    if (p?.line) {
      // the centreline: a polyline of at least two points
      expect((p.axis ?? []).length).toBeGreaterThanOrEqual(2);
      const length = axisFrame(p.axis ?? [])?.length ?? 0;
      // (the axis is rounded to the centimetre: a station may tip over)
      const stations = Math.floor(length / BRIDGE_STEP) + 1;
      expect(Math.abs(p.line.length - stations)).toBeLessThanOrEqual(1);
      for (const rib of p.ribs ?? []) {
        expect(rib.rise).toHaveLength(p.line.length);
        expect(rib.rise.every((r) => r >= 0)).toBe(true);
      }
    }
    if (p?.depth !== undefined) {
      expect(p.depth).toBeGreaterThan(0);
      expect(p.fairway).toBeGreaterThanOrEqual(0);
      expect(p.fairway).toBeLessThanOrEqual(1);
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
      // planting year: a whole year, not in the future
      if (p?.y !== undefined) {
        expect(Number.isInteger(p.y)).toBe(true);
        expect(p.y >= 1500 && p.y <= new Date().getFullYear()).toBe(true);
      }
    }
  }
);

test.each(cases)(
  "%s: the tree facts follow the trees file, column by column",
  (_, a) => {
    const trees = load<TreeFeature>(a.trees);
    const path = a.treeFacts.path;
    // a site baked before the facts file has none yet (its trees step
    // writes it on the next run); where there is one, it follows its trees
    if (!existsSync(path)) {
      return;
    }
    const facts = JSON.parse(readFileSync(path, "utf8")) as TreeFactsFile;
    expect(facts.count).toBe(trees.length);
    expect(facts.attribution).toContain("Landeshauptstadt Dresden");
    const within = (column: number[], table: unknown[]) => {
      expect(column).toHaveLength(trees.length);
      for (const i of column) {
        expect(Number.isInteger(i) && i >= -1 && i < table.length).toBe(true);
      }
    };
    within(facts.name, facts.names);
    within(facts.place, facts.places);
    within(facts.date, facts.dates);
    for (const column of [facts.nr, facts.age, facts.known]) {
      expect(column).toHaveLength(trees.length);
      expect(column.every((v) => Number.isInteger(v) && v >= -1)).toBe(true);
    }
    expect(facts.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    // an OSM tree has no place in the register
    trees.forEach((f, i) => {
      if (f.properties?.s === "osm") {
        expect(facts.place[i]).toBe(-1);
      }
    });
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

// ODbL: every file derived from OpenStreetMap names its source (AGENTS.md,
// "Attribution is part of the data"). The served ones are the artifact
// table's `osm` column; the terrain-bake inputs and the building facts are
// OSM too, and so is the paving raster's legend.
test.each(tiles)(
  "%s: every OSM-derived file carries the ODbL credit",
  (tile, site) => {
    const artifacts = tileArtifacts(tile);
    const files = [
      ...OSM_KINDS.map((kind) => sideFileSource(site, artifacts[kind].file)),
      wallSourceFile(site, tile),
      stairSourceFile(site, tile),
      terraceSourceFile(site, tile),
      cityMeshSourceFiles(site, tile).osmBuild,
      cityMeshSourceFiles(site, tile).doors,
      sideFileSource(site, `surface_${tile}.json`),
    ];
    for (const file of files) {
      const path = join(ROOT, file);
      if (!existsSync(path)) {
        continue;
      }
      const { attribution } = JSON.parse(readFileSync(path, "utf8")) as {
        attribution?: unknown;
      };
      // The file name in the message says which one lost its credit.
      expect(`${file}: ${String(attribution)}`).toContain("OpenStreetMap");
    }
  }
);

test.each(cases)("%s: counted traffic is lines with their counts", (_, a) => {
  for (const f of load<TrafficFeature>(a.traffic)) {
    const p = f.properties;
    expect(f.geometry.type).toBe("LineString");
    expect(isLine(f.geometry.coordinates)).toBe(true);
    expect(p?.t).toBeGreaterThan(0);
    for (const count of [p?.f, p?.b]) {
      if (count !== undefined) {
        expect(count).toBeGreaterThan(0);
      }
    }
    expect((p?.f ?? 0) + (p?.b ?? 0) <= (p?.t ?? 0)).toBe(true);
    for (const share of [p?.hf, p?.hb]) {
      if (share !== undefined) {
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
      }
    }
    if (p?.m !== undefined) {
      expect(["census", "detector", "estimate", "loop", "man"]).toContain(p.m);
    }
  }
});
