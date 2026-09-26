import { expect, test } from "bun:test";
import { DRESDEN } from "../../sites/dresden";
import {
  wallSourceFile,
  cityMeshSourceFiles,
  type DataManifest,
  dgmSourceFiles,
  DRESSING_KINDS,
  manifestUrl,
  OSM_KINDS,
  pickFiles,
  SMALL_RASTER_PX,
  SOUND_KINDS,
  tileArtifacts,
  tileIds,
} from "./tile";

const PRIMARY_TILE = "33412_5656_2_sn";

test("the artifact map reproduces the served file names", () => {
  const a = tileArtifacts(PRIMARY_TILE);
  expect(wallSourceFile(PRIMARY_TILE)).toBe(
    "data/dlm/walls_33412_5656_2_sn.geojson"
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
    "landcoverLow",
    "landcoverSmall",
    "vegrows",
  ]);
});

test("the minimap and the soundscape read a 512² class raster baked from the 4096² one", () => {
  const { landcover, landcoverSmall } = tileArtifacts(PRIMARY_TILE);
  expect(landcoverSmall.bakedFrom).toEqual({
    file: landcover.file,
    raster: SMALL_RASTER_PX,
  });
  expect(SMALL_RASTER_PX).toBe(512);
});

test("the dressing, sound and OSM columns name only kinds of the table", () => {
  const kinds = Object.keys(tileArtifacts(PRIMARY_TILE));
  for (const list of [DRESSING_KINDS, SOUND_KINDS, OSM_KINDS]) {
    expect(list.length).toBeGreaterThan(0);
    for (const kind of list) {
      expect(kinds).toContain(kind);
    }
  }
  expect([...SOUND_KINDS].sort()).toEqual([
    "monuments",
    "soundmarks",
    "surface",
    "svf",
    "tram",
  ]);
  expect(DRESSING_KINDS).toContain("vegrows");
  expect(DRESSING_KINDS).not.toContain("landcover");
});

test("pickFiles keeps only the named kinds a tile has", () => {
  expect(
    pickFiles({ tram: "t.geojson", svf: "", lamps: "l.geojson" }, SOUND_KINDS)
  ).toEqual({ tram: "t.geojson" });
});

test("the site's tiles, the spawn tile first", () => {
  expect(tileIds(DRESDEN)).toEqual([
    PRIMARY_TILE,
    "33410_5656_2_sn",
    "33410_5658_2_sn",
    "33412_5658_2_sn",
    "33410_5654_2_sn",
    "33412_5654_2_sn",
    "33414_5654_2_sn",
    "33414_5656_2_sn",
    "33414_5658_2_sn",
    "33416_5656_2_sn",
    "33416_5654_2_sn",
    "33416_5658_2_sn",
    "33408_5654_2_sn",
    "33408_5656_2_sn",
    "33408_5658_2_sn",
  ]);
  expect(dgmSourceFiles(PRIMARY_TILE).tif).toBe(
    "data/dgm/dgm1_33412_5656_2_sn_tiff/dgm1_33412_5656_2_sn.tif"
  );
  expect(cityMeshSourceFiles(PRIMARY_TILE).city).toBe(
    "data/cityjson/lod2_33412_5656_2_sn.city.json"
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
