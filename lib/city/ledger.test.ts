import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  bytesLedger,
  datedLedger,
  distinctExtensions,
  extensionOf,
  glbFigures,
  LEDGER_SETS,
  ledgerDiff,
  ledgerTiles,
  publishedLedger,
  SITE_FILES,
  setFigures,
  UNCOMPARED,
  unservedNames,
  tileSet,
  weigh,
  wireBytes,
} from "./ledger";
import type { Ledger, PublishedName, RasterReads } from "./ledger";
import { SORT_OF } from "./ledger-rasters";
import { buildTileset } from "./tileset";
import type { BakedTile, TerrainFiles } from "./tileset";

const json = new TextEncoder().encode(
  JSON.stringify({ features: Array.from({ length: 50 }, () => ({ a: 1 })) })
);

test("packed files count at face value, text gzipped at level 6", () => {
  expect(wireBytes("crowns_t.crw.gz", json)).toBe(json.length);
  expect(wireBytes("landcover_t.png", json)).toBe(json.length);
  expect(wireBytes("walk.webp", json)).toBe(json.length);
  const level6 = gzipSync(json, { level: 6 }).length;
  expect(level6).toBeLessThan(json.length);
  expect(wireBytes("trees_t.1a2b.geojson", json)).toBe(level6);
  expect(wireBytes("manifest.json", json)).toBe(level6);
  // the level is part of the rule: level 1 and 9 give other bytes here
  const mixed = new TextEncoder().encode(
    Array.from({ length: 4000 }, (_, i) => `${(i * 7919) % 613},`).join("")
  );
  expect(wireBytes("a.json", mixed)).toBe(gzipSync(mixed, { level: 6 }).length);
  expect(wireBytes("a.json", mixed)).not.toBe(
    gzipSync(mixed, { level: 1 }).length
  );
  expect(wireBytes("a.json", mixed)).not.toBe(
    gzipSync(mixed, { level: 9 }).length
  );
});

test("an extension the wire rule does not know is an error", () => {
  // a raw glTF is not what a host compresses: no guess
  expect(() => wireBytes("city_t.glb", json)).toThrow(/glb/u);
  expect(() => wireBytes("README", json)).toThrow();
  expect(() => wireBytes("notes.json.txt", json)).toThrow();
});

test("an extension keeps the one before .gz and drops a twin's edge", () => {
  expect(extensionOf("city_33412_5656_2_sn.glb.gz")).toBe(".glb.gz");
  expect(extensionOf("plate.bin.gz")).toBe(".bin.gz");
  expect(extensionOf("landcover_33412_5656_2_sn.r2048.png")).toBe(".png");
  expect(extensionOf("trams.json")).toBe(".json");
  expect(extensionOf("README")).toBe("");
  expect(extensionOf("some.dir/README")).toBe("");
  expect(extensionOf("dir/.gz")).toBe(".gz");
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
        surface: `surface_${t}.png`,
        surfaceFar: `surface_${t}.r1024.png`,
        ndvi: `ndvi_${t}.png`,
        sportTable: `sport_${t}.json`,
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

/** The viewer's rule in small: the class raster or its phone twin, the
 *  sky view, and the paving — its far twin beyond the reach, on a desktop
 *  the full raster within it (a phone keeps the twin). */
const reads: RasterReads = (extras, _level, phone, reach) =>
  [
    phone ? extras.landcoverLow : extras.landcover,
    extras.svf,
    reach === "beyond" || phone ? extras.surfaceFar : extras.surface,
  ].filter((f): f is string => typeof f === "string");

const tileA = () => {
  const [a] = ledgerTiles(TILESET);
  if (!a) {
    throw new Error("no tile");
  }
  return a;
};

test("the tiles in the tileset's order, the spawn first", () => {
  expect(ledgerTiles(TILESET).map((t) => t.id)).toEqual(["a", "b"]);
});

test("a far tile: far buildings, their side files, the coarse level", () => {
  expect(tileSet(tileA(), "far", reads, false)).toEqual([
    "city_a_far.glb.gz",
    "crowns_a.crw.gz",
    "facades_a.json",
    "landcover_a_1.png",
    "svf_a.png",
    "terrain_a_l1.glb.gz",
  ]);
});

test("a fine level beyond the reach reads the twins, approached both", () => {
  const a = tileA();
  const beyond = [
    "lamps_a.geojson",
    "landcover_a_0.png",
    "ndvi_a.png",
    "sport_a.json",
    "surface_a.r1024.png",
    "svf_a.png",
    "terrain_a_l0.glb.gz",
    "trees_a.geojson",
  ];
  expect(tileSet(a, "fine", reads, false)).toEqual(beyond);
  // approached: the full raster on top of the twin, nothing dropped
  expect(tileSet(a, "approached", reads, false)).toEqual(
    [...beyond, "surface_a.png"].toSorted()
  );
});

test("a phone's sets are built from a phone's files", () => {
  const a = tileA();
  const fine = tileSet(a, "fine", reads, true);
  expect(fine).toContain("landcover_a.r2048.png");
  expect(fine).not.toContain("landcover_a_0.png");
  // a phone keeps the twin within the reach: nothing more to fetch
  expect(tileSet(a, "approached", reads, true)).toEqual(fine);
  expect(tileSet(a, "approached", reads, true)).not.toContain("surface_a.png");
});

test("the near buildings, the card's files, and every file a tile names", () => {
  const [a, b] = ledgerTiles(TILESET);
  if (!(a && b)) {
    throw new Error("no tiles");
  }
  expect(tileSet(a, "near", reads, false)).toEqual(["city_a.glb.gz"]);
  expect(tileSet(a, "ask", reads, false)).toEqual(["treefacts_a.json"]);
  expect(tileSet(b, "ask", reads, false)).toEqual([]);
  // everything the tile names, every twin with it, each file once, sorted
  expect(tileSet(a, "all", reads, false)).toEqual(
    [
      "city_a.glb.gz",
      "city_a_far.glb.gz",
      "crowns_a.crw.gz",
      "facades_a.json",
      "footprints_a.fpr.gz",
      "lamps_a.geojson",
      "landcover_a.r2048.png",
      "landcover_a_0.png",
      "landcover_a_1.png",
      "ndvi_a.png",
      "sport_a.json",
      "surface_a.png",
      "surface_a.r1024.png",
      "svf_a.png",
      "terrain_a_l0.glb.gz",
      "terrain_a_l1.glb.gz",
      "treefacts_a.json",
      "trees_a.geojson",
    ].toSorted()
  );
  // whatever a set reads, `all` holds it
  for (const set of LEDGER_SETS) {
    for (const phone of [false, true]) {
      const all = new Set(tileSet(a, "all", reads, phone));
      expect(tileSet(a, set, reads, phone).filter((f) => !all.has(f))).toEqual(
        []
      );
    }
  }
  expect(() => tileSet(a, "none" as "far", reads, false)).toThrow();
});

test("the reads are asked for by level, tier and reach", () => {
  const asked: string[] = [];
  const spy: RasterReads = (_extras, tier, phone, reach) => {
    asked.push(`${tier} ${phone ? "phone" : "desktop"} ${reach}`);
    return [];
  };
  const a = tileA();
  const ask = (set: "far" | "fine" | "approached", phone: boolean) => {
    asked.length = 0;
    tileSet(a, set, spy, phone);
    return [...asked];
  };
  // a far tile is beyond the reach by what it is
  expect(ask("far", false)).toEqual(["1 desktop beyond"]);
  expect(ask("far", true)).toEqual(["1 phone beyond"]);
  expect(ask("fine", false)).toEqual(["0 desktop beyond"]);
  expect(ask("fine", true)).toEqual(["0 phone beyond"]);
  expect(ask("approached", true)).toEqual(["0 phone beyond", "0 phone within"]);
  // each level's reads come from its own extras
  const seen: unknown[] = [];
  tileSet(
    a,
    "far",
    (extras) => {
      seen.push(extras);
      return [];
    },
    false
  );
  tileSet(
    a,
    "fine",
    (extras) => {
      seen.push(extras);
      return [];
    },
    false
  );
  expect(seen).toEqual([a.terrain[1].extras, a.terrain[0].extras]);
});

test("a set is its files once, sorted, an empty name left out", () => {
  const tile = {
    ...tileA(),
    city: "",
    ask: { z: "b.json", y: "a.json", x: "", w: "b.json" },
  };
  expect(tileSet(tile, "near", reads, false)).toEqual([]);
  expect(tileSet(tile, "ask", reads, false)).toEqual(["a.json", "b.json"]);
});

test("a phone's row as soon as one tile reads other files", () => {
  const tiles = ledgerTiles(TILESET);
  const [a, b] = tiles;
  if (!(a && b)) {
    throw new Error("no tiles");
  }
  // tile a without a twin of its own: the phone reads what a desktop does
  const same = {
    ...a,
    terrain: {
      ...a.terrain,
      0: {
        ...a.terrain[0],
        extras: {
          ...a.terrain[0].extras,
          landcoverLow: a.terrain[0].extras.landcover,
          surface: undefined,
          surfaceFar: undefined,
        },
      },
    },
  };
  const some = bytesLedger([same, b], reads, () => 1);
  expect(some.fine.phone).toBeDefined();
  expect(some.fine.phone?.spawn).toEqual(some.fine.spawn);
  const none = bytesLedger([same], reads, () => 1);
  expect(none.fine.phone).toBeUndefined();
  expect(none.approached.phone).toBeUndefined();
});

test("the minimap's bridges count with a tile that has them", () => {
  const withBridges = structuredClone(TILESET) as {
    extras: { tiles: { bridges?: string }[] };
  };
  const [first] = withBridges.extras.tiles;
  if (first) {
    first.bridges = "bridges_a.json";
  }
  const [a] = ledgerTiles(withBridges);
  expect(a && tileSet(a, "all", reads, false)).toContain("bridges_a.json");
});

test("a tileset whose tiles and children differ is refused", () => {
  const broken = structuredClone(TILESET) as { root: { children: unknown[] } };
  broken.root.children.pop();
  expect(() => ledgerTiles(broken)).toThrow(/differ/u);
  expect(() => ledgerTiles({ extras: { tiles: [] }, root: {} })).toThrow();
  // a tile whose level has no content
  const hollow = structuredClone(TILESET) as {
    root: { children: { children: { content?: unknown }[] }[] };
  };
  const coarse = hollow.root.children[0]?.children[1];
  if (coarse) {
    coarse.content = undefined;
  }
  expect(() => ledgerTiles(hollow)).toThrow(/coarse terrain/u);
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
  expect(figures.median).toEqual({ tile: "mid", bytes: 4, files: 2 });
  expect(figures.largest).toEqual({ tile: "big", bytes: 10, files: 2 });
  expect(figures.site).toEqual({ bytes: 19, files: 5 });
  expect(() => setFigures([], fixtureWire)).toThrow();
});

test("the median of an odd count is the middle tile", () => {
  const figures = setFigures(
    [
      { tile: "c", files: ["c:30"] },
      { tile: "a", files: ["a:10"] },
      { tile: "b", files: ["b:20"] },
    ],
    fixtureWire
  );
  expect(figures.spawn.tile).toBe("c");
  expect(figures.median.tile).toBe("b");
  expect(figures.largest.tile).toBe("c");
});

test("tiles of the same weight are told apart by their id, in any order", () => {
  // all four weigh the same: largest is the last id, the median the second
  for (const order of [
    ["d", "b", "a", "c"],
    ["a", "b", "c", "d"],
    ["c", "d", "b", "a"],
  ]) {
    const figures = setFigures(
      order.map((tile) => ({ tile, files: [`${tile}:7`] })),
      fixtureWire
    );
    expect(figures.largest.tile).toBe("d");
    expect(figures.median.tile).toBe("b");
    expect(figures.spawn.tile).toBe(order[0] ?? "");
  }
  // bytes before ids: the heaviest tile, whatever its name
  const heavy = setFigures(
    [
      { tile: "z", files: ["z:1"] },
      { tile: "a", files: ["a:9"] },
      { tile: "m", files: ["m:1"] },
    ],
    fixtureWire
  );
  expect(heavy.largest.tile).toBe("a");
  expect(heavy.median.tile).toBe("z");
});

test("a weight is the files' bytes and their count", () => {
  expect(weigh(["a:2", "b:3"], fixtureWire)).toEqual({ bytes: 5, files: 2 });
  expect(weigh([], fixtureWire)).toEqual({ bytes: 0, files: 0 });
});

/** A file's bytes by its kind of name, so that a row's sum tells which
 *  files it was built from. */
const wireByName = (file: string) => {
  if (file.includes(".r1024.") || file.includes(".r2048.")) {
    return 100;
  }
  return file.endsWith(".png") ? 10_000 : 1;
};

test("every set on a desktop; a phone's row only where it reads other files", () => {
  const ledger = bytesLedger(ledgerTiles(TILESET), reads, wireByName);
  expect(Object.keys(ledger)).toEqual([...LEDGER_SETS]);
  for (const set of ["far", "near", "ask", "all"] as const) {
    expect(ledger[set].phone).toBeUndefined();
  }
  // desktop, beyond: the class raster, sky view and NDVI full, the paving's
  // twin, four small files
  expect(ledger.fine.spawn).toEqual({ tile: "a", bytes: 30_104, files: 8 });
  expect(ledger.fine.site).toEqual({ bytes: 60_208, files: 16 });
  // approached: the full paving on top
  expect(ledger.approached.spawn).toEqual({
    tile: "a",
    bytes: 40_104,
    files: 9,
  });
  // a phone: the class raster's twin too, and nothing more when approached
  expect(ledger.fine.phone?.spawn).toEqual({
    tile: "a",
    bytes: 20_204,
    files: 8,
  });
  expect(ledger.approached.phone?.spawn).toEqual(ledger.fine.phone?.spawn);
  expect(ledger.fine.phone?.site).toEqual({ bytes: 40_408, files: 16 });
  // the far set: one glTF pair, the class raster, the sky view, two files
  expect(ledger.far.largest).toEqual({ tile: "b", bytes: 20_004, files: 6 });
  expect(ledger.near.site).toEqual({ bytes: 2, files: 2 });
  expect(ledger.ask.site).toEqual({ bytes: 1, files: 1 });
});

/* ------------------------------------------------------------- published */

const publishedOf = (logical: string[]): PublishedName[] =>
  logical.map((name) => ({ logical: name, served: `${name}#` }));

const SITE_WIDE = [
  "manifest.json",
  "tileset.json",
  "tileset-spawn.json",
  "plate.bin.gz",
  "provenance.json",
  "landmark-facts.json",
  "trams.json",
  "murals.json",
  "mural-n59.lines.webp",
  "mural-w10.wash.webp",
  "walks.json",
  "walk-photo_elbhang--blaues-wunder.webp",
  "minimap.webp",
  "site-map.webp",
  "stadtwissen.json",
  "stadtwissen_33412_5656_2_sn.json",
  "site-stats.json",
];

test("every published file is in exactly one class", () => {
  const tiles = ["city_a.glb.gz", "trees_a.geojson"];
  const ledger = publishedLedger(
    publishedOf([...tiles, ...SITE_WIDE]),
    new Set(tiles.map((t) => `${t}#`)),
    () => 10,
    () => 1000
  );
  expect(ledger.files).toBe(19);
  expect(ledger.tiles).toEqual({ bytes: 20, files: 2 });
  // the boot: the manifest, the tileset and the ground plate
  expect(ledger.boot).toEqual({ bytes: 30, files: 3 });
  expect(ledger.kinds.plate?.class).toBe("boot");
  expect(ledger.site).toEqual({ bytes: 110, files: 11 });
  // the server's files in bytes on disk: they never travel
  expect(ledger.server).toEqual({ bytes: 3000, files: 3 });
  expect(
    ledger.boot.files +
      ledger.tiles.files +
      ledger.site.files +
      ledger.server.files
  ).toBe(ledger.files);
  expect(ledger.kinds.manifest).toEqual({ class: "boot", bytes: 10, files: 1 });
  expect(ledger.kinds["mural-drawings"]).toEqual({
    class: "site",
    bytes: 20,
    files: 2,
  });
  expect(ledger.kinds.stadtwissen).toEqual({
    class: "server",
    bytes: 2000,
    files: 2,
  });
  expect(Object.keys(ledger.kinds)).toEqual(
    Object.keys(ledger.kinds).toSorted()
  );
  // every row has a file here: none is dead in this test
  expect(Object.keys(ledger.kinds).toSorted()).toEqual(
    SITE_FILES.map((r) => r.kind).toSorted()
  );
});

const classesOf = (names: string[], tiles: string[] = []) =>
  publishedLedger(
    publishedOf(names),
    new Set(tiles.map((t) => `${t}#`)),
    () => 1,
    () => 1
  );

test("a published file no tile and no row names is an error", () => {
  // beside the manifest, under its own name
  expect(() => classesOf(["manifest.json", "extra.bin.gz"])).toThrow(
    /1 published files are in no class.*extra\.bin\.gz/u
  );
  // a tile's file the tileset stopped naming is no longer free either
  expect(() => classesOf(["manifest.json", "trees_a.geojson"])).toThrow(
    /trees_a\.geojson/u
  );
  expect(() =>
    classesOf(["manifest.json", "trees_a.geojson"], ["trees_a.geojson"])
  ).not.toThrow();
  // a row covers its own names, not what merely starts or ends like one
  for (const name of [
    "manifest.json.bak",
    "old-manifest.json",
    "tileset.json5",
    "walk-photo.webp",
    "walk-photo_.webp",
    "walk-photo_elbhang.webp.bak",
    "walk-photo_elbhang.png",
    "mural-n59.lines.webp.bak",
    "plate.bin.gz.old",
    "stadtwissen.geojson",
  ]) {
    expect(() => classesOf([name])).toThrow(/in no class/u);
  }
});

test("a file a tile names that is not published is an error", () => {
  expect(() =>
    publishedLedger(
      publishedOf(["manifest.json"]),
      new Set(["city_a.glb.gz#"]),
      () => 1,
      () => 1
    )
  ).toThrow(/not published.*city_a/u);
  // each of them, in one order
  expect(() =>
    publishedLedger(
      publishedOf(["manifest.json"]),
      new Set(["z.png#", "a.png#"]),
      () => 1,
      () => 1
    )
  ).toThrow("2 files that are not published: a.png#, z.png#");
  expect(() => classesOf(["zz.png", "manifest.json", "aa.png"])).toThrow(
    "does: aa.png, zz.png"
  );
});

test("a file published under two names is weighed once", () => {
  const ledger = publishedLedger(
    [
      { logical: "walks.json", served: "same" },
      { logical: "trams.json", served: "same" },
    ],
    new Set(),
    () => 5,
    () => 5
  );
  expect(ledger.site).toEqual({ bytes: 5, files: 1 });
  expect(ledger.files).toBe(1);
});

/** A binary glTF: `json`, padded, then a binary chunk that is no JSON. */
const glb = (gltf: object): Uint8Array => {
  const text = new TextEncoder().encode(JSON.stringify(gltf));
  const padded = Math.ceil(text.length / 4) * 4;
  const out = new Uint8Array(20 + padded + 12).fill(0x20, 20, 20 + padded);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e_4f_53_4a, true);
  out.set(text, 20);
  view.setUint32(20 + padded, 4, true);
  view.setUint32(24 + padded, 0x00_4e_49_42, true);
  out.fill(0x7d, 28 + padded);
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
        { componentType: 5123, count: 7, type: "SCALAR" },
      ],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0, COLOR_0: 2 }, indices: 1 },
            // the same positions again: counted once as vertices
            { attributes: { POSITION: 0 }, indices: 1 },
          ],
        },
        // no indices: a triangle of its positions; lines and strips count
        // none, a stated triangle list does; seven indices are two
        { primitives: [{ attributes: { POSITION: 3 } }] },
        { primitives: [{ attributes: { POSITION: 3 }, mode: 1 }] },
        { primitives: [{ attributes: { POSITION: 3 }, mode: 5 }] },
        { primitives: [{ attributes: { POSITION: 3 }, mode: 4, indices: 4 }] },
        // an index that names no accessor counts nothing
        { primitives: [{ attributes: { POSITION: 9 }, indices: 9 }] },
      ],
    })
  );
  expect(figures).toEqual({
    vertices: 7,
    triangles: 2 + 2 + 1 + 2,
    accessorBytes: 48 + 24 + 16 + 36 + 14,
  });
  expect(() => glbFigures(new Uint8Array(24))).toThrow(/not a binary glTF/u);
  expect(() => glbFigures(glb({}).subarray(0, 16))).toThrow(
    /not a binary glTF/u
  );
  expect(glbFigures(glb({}))).toEqual({
    vertices: 0,
    triangles: 0,
    accessorBytes: 0,
  });
});

const accessorBytesOf = (componentType: number, type: string) =>
  glbFigures(glb({ accessors: [{ componentType, count: 1, type }] }))
    .accessorBytes;

test("an accessor's bytes by its component and its type", () => {
  expect(
    [5120, 5121, 5122, 5123, 5125, 5126].map((c) =>
      accessorBytesOf(c, "SCALAR")
    )
  ).toEqual([1, 1, 2, 2, 4, 4]);
  expect(
    ["SCALAR", "VEC2", "VEC3", "VEC4", "MAT2", "MAT3", "MAT4"].map((t) =>
      accessorBytesOf(5121, t)
    )
  ).toEqual([1, 2, 3, 4, 4, 9, 16]);
  // a component or a type the table does not know weighs nothing
  expect(accessorBytesOf(9999, "VEC3")).toBe(0);
  expect(accessorBytesOf(5126, "TENSOR")).toBe(0);
});

const MESH = { vertices: 3, triangles: 1, accessorBytes: 36 };

const WEIGHT = { bytes: 10, files: 2 };
const FIGURES = {
  spawn: { tile: "a", ...WEIGHT },
  median: { tile: "a", ...WEIGHT },
  largest: { tile: "a", ...WEIGHT },
  site: WEIGHT,
};

const LEDGER = {
  version: 2,
  site: "test",
  dated: "2026-11-16",
  wire: "rule",
  tiles: 2,
  published: {
    files: 8,
    boot: WEIGHT,
    tiles: WEIGHT,
    site: WEIGHT,
    server: WEIGHT,
    kinds: { manifest: { class: "boot", ...WEIGHT } },
  },
  bytes: {
    far: FIGURES,
    fine: { ...FIGURES, phone: FIGURES },
    approached: { ...FIGURES, phone: FIGURES },
    near: FIGURES,
    ask: FIGURES,
    all: FIGURES,
    unvisited: FIGURES,
  },
  buildings: { near: { a: MESH }, far: { a: MESH } },
  counters: {
    askKinds: 1,
    bakeSeamModules: {
      matching: 2,
      of: 3,
      ways: {
        osmMargin: 1,
        readMargin: 0,
        owns: 1,
        neighbourRasters: 0,
        neighbourFiles: 0,
        siteMemo: 0,
      },
    },
    coarseDressingKinds: 3,
    dressingKinds: 17,
    layerModules: { files: 2, codeLines: 3 },
    longestFunction: { lines: 6, name: "bootApp", path: "app/create-app.ts" },
    publishedExtensions: [".png"],
    upstreamWorkarounds: { entries: 2, sites: 2 },
  },
  rasters: { rule: "rasters", cpuDecodes: [], sites: {}, sorts: SORT_OF },
  dressing: { tiles: {} },
} satisfies Ledger;

type Tree = Record<string, unknown>;

/** `node` with the value at `keys` replaced, or taken out (`undefined`). */
const replaced = (node: Tree, keys: string[], value: unknown): Tree => {
  const [key = "", ...rest] = keys;
  if (rest.length > 0) {
    return { ...node, [key]: replaced(node[key] as Tree, rest, value) };
  }
  return value === undefined
    ? Object.fromEntries(Object.entries(node).filter(([k]) => k !== key))
    : { ...node, [key]: value };
};

/** `LEDGER` with the value at `path` replaced. */
const withValue = (path: string, value: unknown): Tree =>
  replaced(LEDGER, path.split("."), value);

test("the check names each figure that moved, never the date", () => {
  expect(ledgerDiff(LEDGER, structuredClone(LEDGER))).toEqual([]);
  expect(ledgerDiff(LEDGER, { ...LEDGER, dated: "2027-01-01" })).toEqual([]);
  const moved = {
    ...LEDGER,
    published: { ...LEDGER.published, boot: { bytes: 12, files: 2 } },
    buildings: {
      ...LEDGER.buildings,
      // one vertex more at a weld: what another machine's bake gave
      near: { a: { ...MESH, vertices: 4, accessorBytes: 48 } },
    },
    counters: { ...LEDGER.counters, publishedExtensions: [".png", ".json"] },
  };
  expect(ledgerDiff(LEDGER, moved)).toEqual([
    "buildings.near.a.accessorBytes: 36 → 48",
    "buildings.near.a.vertices: 3 → 4",
    'counters.publishedExtensions: [".png"] → [".png",".json"]',
    "published.boot.bytes: 10 → 12",
  ]);
  // only a top-level `dated` is the date: a figure of that name is gated
  expect(
    ledgerDiff(
      { ...LEDGER, counters: { dated: 1 } },
      { ...LEDGER, counters: { dated: 2 } }
    )
  ).toEqual(["counters.dated: 1 → 2"]);
});

test("every section is compared, each figure in both directions", () => {
  const paths = [
    "version",
    "site",
    "tiles",
    "published.files",
    "published.boot.bytes",
    "published.tiles.files",
    "published.site.bytes",
    "published.server.bytes",
    "published.kinds.manifest.bytes",
    "bytes.far.spawn.bytes",
    "bytes.fine.median.bytes",
    "bytes.fine.phone.spawn.bytes",
    "bytes.fine.phone.site.files",
    "bytes.approached.largest.files",
    "bytes.approached.phone.largest.bytes",
    "bytes.near.site.bytes",
    "bytes.ask.spawn.files",
    "bytes.all.site.files",
    "buildings.far.a.triangles",
    "counters.dressingKinds",
    "counters.layerModules.codeLines",
    "counters.longestFunction.lines",
    "counters.bakeSeamModules.ways.owns",
    "counters.upstreamWorkarounds.entries",
  ];
  for (const path of paths) {
    // a figure that grew, and one that shrank: a saving is committed too
    expect(ledgerDiff(LEDGER, withValue(path, 99))).toHaveLength(1);
    expect(ledgerDiff(LEDGER, withValue(path, -1))).toHaveLength(1);
    expect(ledgerDiff(LEDGER, withValue(path, 99))[0]).toStartWith(`${path}: `);
    // a figure that is gone, and one that is new
    const gone = ledgerDiff(LEDGER, withValue(path, undefined));
    expect(gone).toHaveLength(1);
    expect(gone[0]).toEndWith(" → (none)");
    const added = ledgerDiff(withValue(path, undefined), LEDGER);
    expect(added).toHaveLength(1);
    expect(added[0]).toStartWith(`${path}: (none) → `);
  }
  expect(ledgerDiff(LEDGER, withValue("wire", "another rule"))).toEqual([
    'wire: "rule" → "another rule"',
  ]);
  // a tile's name is a figure: the largest tile changing hands shows
  expect(ledgerDiff(LEDGER, withValue("bytes.near.largest.tile", "b"))).toEqual(
    ['bytes.near.largest.tile: "a" → "b"']
  );
  // a whole section gone, a phone's row gone
  expect(
    ledgerDiff(LEDGER, withValue("bytes", undefined)).length
  ).toBeGreaterThan(40);
  expect(
    ledgerDiff(LEDGER, withValue("bytes.fine.phone", undefined))
  ).toHaveLength(11);
  expect(ledgerDiff({}, LEDGER)).toContain("tiles: (none) → 2");
  expect(ledgerDiff(LEDGER, {})).toContain("tiles: 2 → (none)");
  // a list that changed its order is a list that changed
  expect(
    ledgerDiff(
      withValue("counters.publishedExtensions", [".a", ".b"]),
      withValue("counters.publishedExtensions", [".b", ".a"])
    )
  ).toHaveLength(1);
});

test("the date holds while the figures do", () => {
  const { dated: _, ...fresh } = LEDGER;
  const today = "2027-01-01";
  expect(datedLedger(fresh, LEDGER, today).dated).toBe("2026-11-16");
  expect(datedLedger({ ...fresh, tiles: 3 }, LEDGER, today).dated).toBe(today);
  // a committed ledger with a section the fresh one lacks
  expect(
    datedLedger(fresh, { ...LEDGER, recorded: { machine: "a" } }, today).dated
  ).toBe(today);
  expect(datedLedger(fresh, null, today).dated).toBe(today);
  expect(datedLedger(fresh, { ...LEDGER, dated: 5 }, today).dated).toBe(today);
  expect(datedLedger(fresh, { ...LEDGER, dated: "" }, today).dated).toBe(today);
});

test("the written ledger is the fresh figures, the heading first", () => {
  const { dated: _, ...fresh } = LEDGER;
  const written = datedLedger(fresh, null, "2027-01-01");
  expect(written).toEqual({ ...LEDGER, dated: "2027-01-01" });
  expect(Object.keys(written)).toEqual([
    "version",
    "site",
    "dated",
    "wire",
    "tiles",
    "published",
    "bytes",
    "buildings",
    "counters",
    "rasters",
    "dressing",
  ]);
  // a further section is written where it was measured, and gated
  const more = { ...fresh, browser: BROWSER };
  expect(Object.keys(datedLedger(more, null, "x")).at(-1)).toBe("browser");
  expect(datedLedger(more, null, "x").browser).toEqual(BROWSER);
  expect(ledgerDiff(LEDGER, more)).toContain(
    "browser.firstLoad.files: (none) → 2"
  );
});

test("a tile that names a file no set counts is refused", () => {
  const withKey = structuredClone(TILESET) as {
    extras: { tiles: Record<string, unknown>[] };
    root: {
      children: {
        children: { children: unknown[]; extras: Record<string, unknown> }[];
      }[];
    };
  };
  const fine = withKey.root.children[0]?.children[1]?.children[0] as
    | { extras: Record<string, unknown> }
    | undefined;
  if (!fine) {
    throw new Error("no fine level");
  }
  // a new key on a level, naming a file outside the site's directory
  fine.extras.more = "../common/huge.png";
  expect(() => ledgerTiles(withKey)).toThrow(
    /tile a names 1 files that no set counts.*: \.\.\/common\/huge\.png /u
  );
  fine.extras.more = undefined;
  expect(() => ledgerTiles(withKey)).not.toThrow();
  // a third content beside the buildings and the terrain
  withKey.root.children[0]?.children.push({
    children: [],
    extras: { nested: { deep: ["extra_a.glb.gz", "city_a.glb.gz"] } },
  });
  expect(() => ledgerTiles(withKey)).toThrow(/tile a names 1 files.*extra_a/u);
  withKey.root.children[0]?.children.pop();
  // a key of the tile's entry in the site's list
  const [info] = withKey.extras.tiles;
  if (info) {
    info.preview = "preview_a.webp";
  }
  expect(() => ledgerTiles(withKey)).toThrow(/preview_a\.webp/u);
  // what has neither dot nor slash is no file: an id, a kind, a mode
  if (info) {
    info.preview = "none";
  }
  expect(() => ledgerTiles(withKey)).not.toThrow();
});

test("the files a tile names that no visit fetches", () => {
  const a = tileA();
  expect(tileSet(a, "unvisited", reads, false)).toEqual([
    "footprints_a.fpr.gz",
  ]);
  expect(tileSet(a, "unvisited", reads, true)).toEqual(["footprints_a.fpr.gz"]);
  // a raster the viewer stops reading on every tier is one more
  const noSky: RasterReads = (extras, tier, phone, reach) =>
    reads(extras, tier, phone, reach).filter((f) => !f.startsWith("svf_"));
  expect(tileSet(a, "unvisited", noSky, false)).toEqual([
    "footprints_a.fpr.gz",
  ]);
  const noTwin: RasterReads = (extras, tier, phone, reach) =>
    reads(extras, tier, phone, reach).filter((f) => !f.includes(".r2048."));
  expect(tileSet(a, "unvisited", noTwin, false)).toEqual([
    "footprints_a.fpr.gz",
    "landcover_a.r2048.png",
  ]);
  const ledger = bytesLedger(ledgerTiles(TILESET), reads, () => 1);
  expect(ledger.unvisited.site).toEqual({ bytes: 2, files: 2 });
  expect(ledger.unvisited.phone).toBeUndefined();
});

test("a path the check does not compare, with everything under it", () => {
  const was = { dated: "a", browser: { readWith: { v: 1 }, scripts: 1 } };
  const now = { dated: "b", browser: { readWith: { v: 2 }, scripts: 2 } };
  expect(ledgerDiff(was, now, ["dated"])).toEqual([
    "browser.readWith.v: 1 → 2",
    "browser.scripts: 1 → 2",
  ]);
  // the default: the browser it was read with is never compared
  expect(ledgerDiff(was, now)).toEqual(["browser.scripts: 1 → 2"]);
  // by its whole path: the same key elsewhere is compared
  expect(
    ledgerDiff({ a: { readWith: 1 } }, { a: { readWith: 2 } }, [
      "browser.readWith",
      "readWith",
    ])
  ).toEqual(["a.readWith: 1 → 2"]);
  expect(ledgerDiff(was, now, [])).toContain('dated: "a" → "b"');
  expect([...UNCOMPARED]).toEqual([
    "dated",
    "dressing.recorded",
    "timings",
    "browser.readWith",
  ]);
});

test("a name in a tileset that the site does not serve", () => {
  const served = new Set(["plate.bin.gz", "trams.json", "city_a.glb.gz"]);
  const tileset = {
    extras: {
      site: "test",
      plate: { file: "plate.bin.gz", tiles: [{ id: "a" }] },
      trams: "trams.json",
      landmarks: [{ name: "St. Michael" }, { name: "Haus Nr. 3" }],
      credits: ["CC BY-SA 4.0", "a/b"],
    },
    root: { content: { uri: "city_a.glb.gz" }, children: [] },
  };
  expect(unservedNames(tileset, served)).toEqual([]);
  // at the root, in the root's content, under the plate: each is found
  expect(
    unservedNames(
      {
        ...tileset,
        extras: { ...tileset.extras, heavy: "../common/huge.png" },
      },
      served
    )
  ).toEqual(["../common/huge.png"]);
  expect(
    unservedNames(
      { ...tileset, root: { content: { uri: "../common/huge.glb.gz" } } },
      served
    )
  ).toEqual(["../common/huge.glb.gz"]);
  expect(
    unservedNames(
      {
        ...tileset,
        extras: {
          ...tileset.extras,
          plate: { ...tileset.extras.plate, more: ["z.webp", "a.geojson"] },
        },
      },
      served
    )
  ).toEqual(["a.geojson", "z.webp"]);
  // a served name is one by its whole text
  expect(
    unservedNames({ a: "old-trams.json", b: "trams.json" }, served)
  ).toEqual(["old-trams.json"]);
  expect(unservedNames("x.json", served)).toEqual(["x.json"]);
  expect(unservedNames(null, served)).toEqual([]);
});

/** A browser section, as lib/city/ledger-browser.ts writes it. */
const BROWSER: NonNullable<Ledger["browser"]> = {
  readWith: "chromium 153, google / swiftshader",
  firstLoad: {
    note: "n",
    files: 2,
    gzip: 100_000,
    workerOnly: { files: 1, gzip: 40_000 },
  },
  phoneLiteSpawnCache: { note: "n", bytes: 300, contents: { t: 300 } },
};

test("the browser's figures are compared exactly; its browser and the timings never", () => {
  const was = { ...LEDGER, browser: BROWSER };
  const other = {
    ...was,
    browser: {
      ...BROWSER,
      readWith: "chromium 156, google / swiftshader",
      firstLoad: { ...BROWSER.firstLoad, gzip: 100_001 },
    },
    timings: { machine: "elsewhere" },
  };
  expect(ledgerDiff(was, other)).toEqual([
    "browser.firstLoad.gzip: 100000 → 100001",
  ]);
});

test("the browser's sections are written where they were measured", () => {
  const { dated: _, ...fresh } = LEDGER;
  const today = "2027-01-01";
  const kept = datedLedger(
    { ...fresh, browser: BROWSER },
    { ...LEDGER, browser: BROWSER },
    today
  );
  expect(kept.browser).toEqual(BROWSER);
  expect(kept.dated).toBe("2026-11-16");
  expect(datedLedger(fresh, LEDGER, today)).not.toHaveProperty("browser");
});
