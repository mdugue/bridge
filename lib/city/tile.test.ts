import { expect, test } from "bun:test";
import { DRESDEN } from "../../sites/dresden";
import {
  wallSourceFile,
  cityMeshSourceFiles,
  type DataManifest,
  dgmSourceFiles,
  manifestUrl,
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

test("exactly four artifacts are required", () => {
  const required = Object.entries(tileArtifacts(PRIMARY_TILE))
    .filter(([, a]) => a.required)
    .map(([kind]) => kind)
    .sort();
  expect(required).toEqual(["landcover", "landcoverLow", "vegrows"]);
});

test("the site's tiles, the spawn tile first", () => {
  expect(tileIds(DRESDEN)).toEqual([
    PRIMARY_TILE,
    "33410_5656_2_sn",
    "33410_5658_2_sn",
    "33412_5658_2_sn",
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
