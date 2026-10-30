import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DRESDEN } from "../../sites/dresden";
import {
  wallSourceFile,
  cityMeshSourceFiles,
  COARSE_RASTER_PX,
  type DataManifest,
  dgmSourceFiles,
  DRESSING_KINDS,
  kerbSourceFile,
  manifestUrl,
  OSM_KINDS,
  pickFiles,
  SMALL_RASTER_PX,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  tileIds,
} from "./tile";

const PRIMARY_TILE = "33412_5656_2_sn";

test("the artifact map reproduces the served file names", () => {
  const a = tileArtifacts(PRIMARY_TILE);
  expect(wallSourceFile(DRESDEN, PRIMARY_TILE)).toBe(
    "data/dresden/dlm/walls_33412_5656_2_sn.geojson"
  );
  expect(a.ndvi.file).toBe("ndvi_33412_5656_2_sn.png");
  expect(a.landcover.file).toBe("landcover_33412_5656_2_sn.png");
  expect(a.landcoverLow).toEqual({
    file: "landcover_33412_5656_2_sn.r2048.png",
    required: true,
    bakedFrom: { file: "landcover_33412_5656_2_sn.png", raster: 2048 },
  });
});

test("the cadastre, hedges and scan crowns are optional side files", () => {
  const a = tileArtifacts(PRIMARY_TILE);
  expect(a.trees).toEqual({
    file: "trees_33412_5656_2_sn.geojson",
    required: false,
  });
  expect(a.lowveg.file).toBe("lowveg_33412_5656_2_sn.geojson");
  // Only tiles with a laser scan have them; prepare-data names the file in
  // the dressing only when it is committed.
  expect(a.canopyx.required).toBe(false);
});

test("only the class rasters and the vegetation rows are required", () => {
  const required = Object.entries(tileArtifacts(PRIMARY_TILE))
    .filter(([, a]) => a.required)
    .map(([kind]) => kind)
    .sort();
  expect(required).toEqual([
    "landcover",
    "landcoverCoarse",
    "landcoverLow",
    "landcoverSmall",
    "vegrows",
  ]);
});

test("the coarse terrain reads a 1024² class raster baked from the 4096² one", () => {
  const { landcover, landcoverCoarse } = tileArtifacts(PRIMARY_TILE);
  expect(landcoverCoarse.bakedFrom).toEqual({
    file: landcover.file,
    raster: COARSE_RASTER_PX,
  });
  expect(COARSE_RASTER_PX).toBe(1024);
});

test("the minimap reads a 512² class raster baked from the 4096² one", () => {
  const { landcover, landcoverSmall } = tileArtifacts(PRIMARY_TILE);
  expect(landcoverSmall.bakedFrom).toEqual({
    file: landcover.file,
    raster: SMALL_RASTER_PX,
  });
  expect(SMALL_RASTER_PX).toBe(512);
});

test("the dressing and OSM columns name only kinds of the table", () => {
  const kinds = Object.keys(tileArtifacts(PRIMARY_TILE));
  for (const list of [DRESSING_KINDS, OSM_KINDS]) {
    expect(list.length).toBeGreaterThan(0);
    for (const kind of list) {
      expect(kinds).toContain(kind);
    }
  }
  expect(DRESSING_KINDS).toContain("vegrows");
  expect(DRESSING_KINDS).not.toContain("landcover");
});

test("pickFiles keeps only the named kinds a tile has", () => {
  expect(
    pickFiles({ tram: "t.geojson", lamps: "", svf: "s.png" }, DRESSING_KINDS)
  ).toEqual({ tram: "t.geojson" });
});

test("the site's tiles, the spawn tile first", () => {
  const ids = tileIds(DRESDEN);
  expect(ids[0]).toBe(PRIMARY_TILE);
  expect(ids.length).toBe(DRESDEN.tiles.length);
  for (const id of ids) {
    expect(id).toMatch(/^33\d{3}_\d{4}_2_sn$/u);
  }
  expect(dgmSourceFiles(DRESDEN, PRIMARY_TILE).tif).toBe(
    "data/dresden/dgm/dgm1_33412_5656_2_sn_tiff/dgm1_33412_5656_2_sn.tif"
  );
  expect(cityMeshSourceFiles(DRESDEN, PRIMARY_TILE).city).toBe(
    "data/dresden/cityjson/lod2_33412_5656_2_sn.city.json"
  );
});

test("manifestUrl resolves hashed names and falls back to the logical one", () => {
  const manifest: DataManifest = {
    version: 1,
    files: { "tileset.json": "tileset.0a1b2c3d.json" },
  };
  expect(manifestUrl(manifest, "tileset.json")).toBe(
    "/data/tileset.0a1b2c3d.json"
  );
  expect(manifestUrl(manifest, "other.json")).toBe("/data/other.json");
  expect(manifestUrl(null, "tileset.json", "/x")).toBe("/x/tileset.json");
});

/** Every per-tile file a bake step names (`f"<stem>_{tile.id}.<ext>"`)
 *  outside the raw downloads, as the TypeScript side would spell it. A
 *  stem built from a variable (`f"{name}_{tile.id}…"`) is not seen. */
function bakeNames(): Map<string, string> {
  const dir = join(import.meta.dir, "../../pipeline/bake");
  const names = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".py"))) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      // data/_raw/<provider>/ holds the downloads and the bakes' own
      // caches (Wikidata answers, the laser scan's research output)
      if (/\braw\b/u.test(line)) {
        return;
      }
      for (const m of line.matchAll(
        /f"([a-z0-9_]+)_\{tile\.id\}\.([a-z.]+)"/gu
      )) {
        names.set(`${m[1]}_${PRIMARY_TILE}.${m[2]}`, `${file}:${i + 1}`);
      }
    });
  }
  return names;
}

test("every file a bake step writes or reads is one the build knows", () => {
  // A step that spells a name the table does not know ships as "file
  // absent, layer off"; a rename on one side only passes every data check
  // while the stale committed files are still there.
  const known = new Set<string>();
  for (const a of Object.values(tileArtifacts(PRIMARY_TILE))) {
    known.add(a.file);
    if (a.bakedFrom) {
      known.add(a.bakedFrom.file);
    }
  }
  const sources = [
    ...Object.values(cityMeshSourceFiles(DRESDEN, PRIMARY_TILE)),
    wallSourceFile(DRESDEN, PRIMARY_TILE),
    kerbSourceFile(DRESDEN, PRIMARY_TILE),
    stairSourceFile(DRESDEN, PRIMARY_TILE),
    terraceSourceFile(DRESDEN, PRIMARY_TILE),
  ];
  for (const path of sources) {
    known.add(basename(path));
  }
  // the class raster's legends: the build reads landcover's and horizon's,
  // edges' and surface's document their rasters' channels for people
  for (const stem of ["landcover", "horizon", "edges", "surface"]) {
    known.add(`${stem}_${PRIMARY_TILE}.json`);
  }
  const names = bakeNames();
  expect(names.size).toBeGreaterThan(40);
  const unknown = [...names].filter(([name]) => !known.has(name));
  expect(unknown).toEqual([]);
});
