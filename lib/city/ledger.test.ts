import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  bytesLedger,
  datedLedger,
  distinctExtensions,
  extensionOf,
  functionLines,
  gatedWire,
  glbFigures,
  layerModules,
  ledgerDiff,
  ledgerTiles,
  lineCount,
  seamModules,
  setFigures,
  tileSet,
  upstreamWorkarounds,
  wireBytes,
} from "./ledger";
import type { Ledger, RasterReads, Recorded } from "./ledger";
import { SORT_OF } from "./ledger-rasters";
import { buildTileset } from "./tileset";
import type { BakedTile, TerrainFiles } from "./tileset";

const json = new TextEncoder().encode(
  JSON.stringify({ features: Array.from({ length: 50 }, () => ({ a: 1 })) })
);

test("packed files count at face value, the rest gzipped at level 6", () => {
  expect(wireBytes("crowns_t.crw.gz", json)).toBe(json.length);
  expect(wireBytes("landcover_t.png", json)).toBe(json.length);
  expect(wireBytes("walk.webp", json)).toBe(json.length);
  const geojson = wireBytes("trees_t.1a2b.geojson", json);
  expect(geojson).toBe(gzipSync(json, { level: 6 }).length);
  expect(geojson).toBeLessThan(json.length);
});

test("an extension keeps the one before .gz and drops a twin's edge", () => {
  expect(extensionOf("city_33412_5656_2_sn.glb.gz")).toBe(".glb.gz");
  expect(extensionOf("plate.bin.gz")).toBe(".bin.gz");
  expect(extensionOf("landcover_33412_5656_2_sn.r2048.png")).toBe(".png");
  expect(extensionOf("trams.json")).toBe(".json");
  expect(extensionOf("README")).toBe("");
  expect(
    distinctExtensions(["a.png", "b.r1024.png", "c.glb.gz", "d.json"])
  ).toEqual([".glb.gz", ".json", ".png"]);
});

/** A terrain level's extras with a phone twin for the class raster. */
const level = (t: string, n: 0 | 1): TerrainFiles => ({
  landcover: `landcover_${t}_${n}.png`,
  landcoverLow: n === 0 ? `landcover_${t}.r2048.png` : `landcover_${t}_1.png`,
  svf: `svf_${t}.png`,
  ...(n === 0
    ? {
        surfaceFar: `surface_${t}.r1024.png`,
        dressing: { lamps: `lamps_${t}.geojson`, trees: `trees_${t}.geojson` },
      }
    : { coarse: { crowns: `crowns_${t}.crw.gz` } }),
});

const baked = (t: string, x: number): BakedTile => ({
  id: t,
  bounds: [x, 0, x + 2000, 2000],
  zRange: [100, 150],
  city: `city_${t}.glb.gz`,
  cityFar: `city_${t}_far.glb.gz`,
  terrain: { 0: `terrain_${t}_l0.glb.gz`, 1: `terrain_${t}_l1.glb.gz` },
  files: {
    city: { svf: `svf_${t}.png`, facades: `facades_${t}.json` },
    terrain: { 0: level(t, 0), 1: level(t, 1) },
  },
});

const TILESET = buildTileset([baked("a", 0), baked("b", 2000)], {
  epsg: 25_833,
  offset: { cx: 2000, cy: 1000 },
  site: "test",
  tiles: ["a", "b"].map((id, i) => ({
    id,
    bounds: [i * 2000, 0, i * 2000 + 2000, 2000],
    footprints: `footprints_${id}.fpr.gz`,
    ...(id === "a" ? { ask: { treeFacts: "treefacts_a.json" } } : {}),
  })),
});

/** The viewer's rule in small: the class raster or its phone twin, and
 *  the sky view; a far twin is never read near the camera. */
const reads: RasterReads = (extras, _level, phone) =>
  [phone ? extras.landcoverLow : extras.landcover, extras.svf].filter(
    (f): f is string => typeof f === "string"
  );

test("a level's file set from a two-tile tileset", () => {
  const [a, b] = ledgerTiles(TILESET);
  expect(a?.id).toBe("a");
  expect(b?.id).toBe("b");
  if (!a) {
    throw new Error("no tile");
  }
  expect(tileSet(a, "far", reads, false)).toEqual([
    "city_a_far.glb.gz",
    "crowns_a.crw.gz",
    "facades_a.json",
    "landcover_a_1.png",
    "svf_a.png",
    "terrain_a_l1.glb.gz",
  ]);
  expect(tileSet(a, "fine", reads, false)).toEqual([
    "lamps_a.geojson",
    "landcover_a_0.png",
    "svf_a.png",
    "terrain_a_l0.glb.gz",
    "trees_a.geojson",
  ]);
  expect(tileSet(a, "fine", reads, true)).toContain("landcover_a.r2048.png");
  expect(tileSet(a, "fine", reads, true)).not.toContain("landcover_a_0.png");
  expect(tileSet(a, "near", reads, false)).toEqual(["city_a.glb.gz"]);
  expect(tileSet(a, "ask", reads, false)).toEqual(["treefacts_a.json"]);
  expect(b && tileSet(b, "ask", reads, false)).toEqual([]);
  // everything the tile names, every twin with it, each file once
  const all = tileSet(a, "all", reads, false);
  expect(all).toContain("surface_a.r1024.png");
  expect(all).toContain("footprints_a.fpr.gz");
  expect(all.filter((f) => f === "svf_a.png")).toHaveLength(1);
  expect(all).toHaveLength(15);
});

test("a tileset whose tiles and children differ is refused", () => {
  const broken = structuredClone(TILESET) as { root: { children: unknown[] } };
  broken.root.children.pop();
  expect(() => ledgerTiles(broken)).toThrow();
});

/** A fixture file's bytes, written after its name (`s:5`). */
const fixtureWire = (file: string) => Number(file.split(":")[1]);

test("spawn, median and largest by bytes; the site counts a file once", () => {
  const figures = setFigures(
    [
      { tile: "spawn", files: ["s:5", "shared:1"] },
      { tile: "big", files: ["b:9", "shared:1"] },
      { tile: "mid", files: ["m:3", "shared:1"] },
      { tile: "small", files: ["x:1"] },
    ],
    fixtureWire
  );
  expect(figures.spawn).toEqual({ tile: "spawn", bytes: 6, files: 2 });
  // the lower median of four: small 1, mid 4, spawn 6, big 10
  expect(figures.median.tile).toBe("mid");
  expect(figures.largest).toEqual({ tile: "big", bytes: 10, files: 2 });
  expect(figures.site).toEqual({ bytes: 19, files: 5 });
});

test("a phone's figures only where a set has a low twin", () => {
  const ledger = bytesLedger(ledgerTiles(TILESET), reads, () => 1);
  expect(ledger.fine.phone).toBeDefined();
  expect(ledger.near.phone).toBeUndefined();
  // the coarse level's twin is its own file: no phone row
  expect(ledger.far.phone).toBeUndefined();
});

test("lines as wc -l counts them", () => {
  expect(lineCount("")).toBe(0);
  expect(lineCount("a\nb\n")).toBe(2);
  expect(lineCount("a\nb")).toBe(2);
});

test("the layer modules, tests left out", () => {
  expect(
    layerModules([
      { path: "app/_components/tree-layer.ts", text: "a\nb\n" },
      { path: "app/_components/tree-layer.test.ts", text: "a\n" },
      { path: "app/_components/tile-stream.ts", text: "a\n" },
      { path: "app/_components/rail-layer.ts", text: "a\n" },
    ])
  ).toEqual({ files: 2, lines: 3 });
});

test("a function's lines run to the first brace at a line's start", () => {
  const text = [
    "const x = 1;",
    "async function bootApp(",
    "  a: number",
    ") {",
    "  if (a) {",
    "  }",
    "}",
    "function after() {}",
  ].join("\n");
  expect(functionLines(text, "bootApp")).toBe(6);
  expect(() => functionLines(text, "missing")).toThrow();
});

test("the bake modules that handle a seam, one level deep", () => {
  expect(
    seamModules([
      { path: "pipeline/bake/a.py", text: "# reads the Neighbour tile" },
      { path: "pipeline/bake/b.py", text: "MARGIN = 20" },
      { path: "pipeline/bake/c.py", text: "def bake(): pass" },
      { path: "pipeline/bake/providers/d.py", text: "seam" },
    ])
  ).toEqual({ matching: 2, of: 3 });
});

test("the comments that name a workaround for upstream", () => {
  expect(
    upstreamWorkarounds([
      {
        path: "app/a.ts",
        text: [
          "// An upstream workaround (docs/rendering.md)",
          " * three's dispose — Upstream workaround",
          'const s = "upstream workaround";',
          "// nothing here",
        ].join("\n"),
      },
    ])
  ).toBe(2);
});

test("the machine-bound files are no bytes in the gate, but files", () => {
  const wire = gatedWire(() => 7);
  expect(wire("city_33412_5656_2_sn.fa5c0c5f.glb.gz")).toBe(0);
  expect(wire("city_33412_5656_2_sn_far.c85037b5.glb.gz")).toBe(0);
  // the tileset JSONs name the buildings by their content hash
  expect(wire("tileset.804b2f60.json")).toBe(0);
  expect(wire("tileset-spawn.6a2504c0.json")).toBe(0);
  expect(wire("terrain_33412_5656_2_sn_l0.12c82968.glb.gz")).toBe(7);
  expect(wire("facades_33412_5656_2_sn.4c9c5f53.json")).toBe(7);
});

/** A binary glTF with `json` as its only chunk. */
const glb = (gltf: object): Uint8Array => {
  const text = new TextEncoder().encode(JSON.stringify(gltf));
  const padded = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(20 + padded).fill(0x20, 20);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e_4f_53_4a, true);
  out.set(text, 20);
  return out;
};

test("a glTF's vertices, triangles and accessor bytes from its JSON", () => {
  const figures = glbFigures(
    glb({
      accessors: [
        { componentType: 5126, count: 4, type: "VEC3" },
        { componentType: 5125, count: 6, type: "SCALAR" },
        { componentType: 5121, count: 4, type: "VEC4" },
        { componentType: 5126, count: 3, type: "VEC3" },
      ],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0, COLOR_0: 2 }, indices: 1 },
            // the same positions again: counted once as vertices
            { attributes: { POSITION: 0 }, indices: 1 },
          ],
        },
        // no indices: a triangle of its positions; lines count none
        { primitives: [{ attributes: { POSITION: 3 } }] },
        { primitives: [{ attributes: { POSITION: 3 }, mode: 1 }] },
      ],
    })
  );
  expect(figures).toEqual({
    vertices: 7,
    triangles: 2 + 2 + 1,
    accessorBytes: 48 + 24 + 16 + 36,
  });
  expect(() => glbFigures(new Uint8Array(24))).toThrow();
});

const RECORDED: Recorded = {
  note: "recorded",
  machine: "a machine",
  read: "2026-11-16",
  published: { bytes: 20, files: 2 },
  bytes: {} as Ledger["bytes"],
  buildings: {
    near: { a: { vertices: 3, triangles: 1, accessorBytes: 36 } },
    far: { a: { vertices: 3, triangles: 1, accessorBytes: 36 } },
  },
};

const LEDGER = {
  version: 1,
  site: "test",
  dated: "2026-11-16",
  wire: "rule",
  tiles: 2,
  published: { bytes: 10, files: 2 },
  bytes: {} as Ledger["bytes"],
  buildings: { near: { a: { triangles: 1 } }, far: { a: { triangles: 1 } } },
  counters: {
    askKinds: 1,
    bakeSeamModules: { matching: 2, of: 3 },
    bootAppLines: 6,
    coarseDressingKinds: 3,
    dressingKinds: 17,
    layerModules: { files: 2, lines: 3 },
    publishedExtensions: [".png"],
    upstreamWorkarounds: 2,
  },
  rasters: { rule: "rasters", cpuDecodes: [], sites: {}, sorts: SORT_OF },
  recorded: RECORDED,
} satisfies Ledger;

test("the check names each figure that moved, never the date or the record", () => {
  expect(
    ledgerDiff(LEDGER, {
      ...LEDGER,
      dated: "2027-01-01",
      recorded: {
        ...RECORDED,
        buildings: {
          ...RECORDED.buildings,
          near: { a: { vertices: 4, triangles: 1, accessorBytes: 48 } },
        },
      },
    })
  ).toEqual([]);
  const moved = {
    ...LEDGER,
    published: { bytes: 12, files: 2 },
    buildings: {
      ...LEDGER.buildings,
      near: { a: { triangles: 2 } },
    },
    counters: { ...LEDGER.counters, publishedExtensions: [".png", ".json"] },
  };
  expect(ledgerDiff(LEDGER, moved)).toEqual([
    "buildings.near.a.triangles: 1 → 2",
    'counters.publishedExtensions: [".png"] → [".png",".json"]',
    "published.bytes: 10 → 12",
  ]);
  expect(ledgerDiff({}, LEDGER)).toContain("tiles: (none) → 2");
});

test("the date holds while the gated figures do; the record while its own do", () => {
  const { dated: _, recorded: __, ...fresh } = LEDGER;
  const { machine: ___, read: ____, ...figures } = RECORDED;
  const today = "2027-01-01";
  const same = datedLedger(fresh, figures, LEDGER, today, "another");
  expect(same.dated).toBe("2026-11-16");
  expect(same.recorded).toEqual(RECORDED);
  const moved = datedLedger(
    { ...fresh, tiles: 3 },
    figures,
    LEDGER,
    today,
    "b"
  );
  expect(moved.dated).toBe(today);
  // another machine's bytes: a new record, the gated date kept
  const other = datedLedger(
    fresh,
    { ...figures, published: { bytes: 21, files: 2 } },
    LEDGER,
    today,
    "another"
  );
  expect(other.dated).toBe("2026-11-16");
  expect(other.recorded).toMatchObject({ machine: "another", read: today });
  expect(datedLedger(fresh, figures, null, today, "b").dated).toBe(today);
});
