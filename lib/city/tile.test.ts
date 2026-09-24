import { expect, test } from "bun:test";
import {
  cityMeshSourceFiles,
  type DataManifest,
  dgmSourceFiles,
  PRIMARY_TILE,
  TILE_BLOCK,
  tileArtifacts,
  tileUrlsFrom,
} from "./tile";

const primary = { tile: PRIMARY_TILE, n: 1024, raster: 4096 };

test("the artifact map reproduces the served file names", () => {
  const a = tileArtifacts(primary);
  expect(a.cityMeshMeta.file).toBe("city_33412_5656_2_sn.mesh.json");
  expect(a.cityMeshData.file).toBe("city_33412_5656_2_sn.mesh.bin.gz");
  expect(a.heightfieldHeader.file).toBe(
    "dgm1_33412_5656_2_sn.heightfield-1024.json"
  );
  expect(a.heightfieldData.file).toBe(
    "dgm1_33412_5656_2_sn.heightfield-1024.u16.gz"
  );
  expect(a.walls.file).toBe("walls_33412_5656_2_sn.geojson");
  expect(a.ndvi.file).toBe("ndvi_33412_5656_2_sn.png");
  expect("landcoverRgb" in a).toBe(false);
});

test("exactly eight artifacts are required", () => {
  const required = Object.values(tileArtifacts(primary)).filter(
    (a) => a.required
  );
  expect(required).toHaveLength(8);
});

test("land-cover rasters: the primary serves the bake, phones a 2048² variant", () => {
  const a = tileArtifacts(primary);
  expect(a.landcover).toEqual({
    file: "landcover_33412_5656_2_sn.png",
    required: true,
    source: "dlm",
  });
  expect(a.landcoverLow.file).toBe("landcover_33412_5656_2_sn.r2048.png");
  expect(a.landcoverLow.bakedFrom).toEqual({
    file: "landcover_33412_5656_2_sn.png",
    source: "dlm",
  });
  expect(a.landcoverLow.raster).toBe(2048);
  // A neighbour is already served at 2048²: the low variant IS its raster.
  const neighbour = tileArtifacts({
    tile: "33410_5656_2_sn",
    n: 512,
    raster: 2048,
  });
  expect(neighbour.landcover.file).toBe("landcover_33410_5656_2_sn.r2048.png");
  expect(neighbour.landcoverLow).toEqual(neighbour.landcover);
});

test("tileUrlsFrom prefixes the /data route and serves phones the low rasters", () => {
  const desktop = tileUrlsFrom(primary, null, false);
  expect(desktop.canopy).toBe("/data/canopy_33412_5656_2_sn.geojson");
  expect(desktop.landcover).toBe("/data/landcover_33412_5656_2_sn.png");
  expect("landcoverLow" in desktop).toBe(false);
  // The data blob is reached through the header's sibling name.
  expect("heightfieldData" in desktop).toBe(false);
  expect(tileUrlsFrom(primary, null, false, "/x").cityMeshMeta).toBe(
    "/x/city_33412_5656_2_sn.mesh.json"
  );
  const phone = tileUrlsFrom(primary, null, true);
  expect(phone.landcover).toBe("/data/landcover_33412_5656_2_sn.r2048.png");
  expect(phone.ndvi).toBe(desktop.ndvi);
});

test("the tile block lists the primary first", () => {
  expect(TILE_BLOCK[0].tile).toBe(PRIMARY_TILE);
  expect(dgmSourceFiles(PRIMARY_TILE).tif).toBe(
    "data/dgm/dgm1_33412_5656_2_sn_tiff/dgm1_33412_5656_2_sn.tif"
  );
  expect(cityMeshSourceFiles(PRIMARY_TILE).city).toBe(
    "data/cityjson/lod2_33412_5656_2_sn.city.json"
  );
});

test("tileUrlsFrom resolves hashed names through the manifest", () => {
  const manifest: DataManifest = {
    version: 1,
    files: {
      "canopy_33412_5656_2_sn.geojson": "canopy_33412_5656_2_sn.abc123.geojson",
    },
  };
  const u = tileUrlsFrom(primary, manifest, false);
  expect(u.canopy).toBe("/data/canopy_33412_5656_2_sn.abc123.geojson");
  // Unknown names pass through unchanged (and so does a missing manifest).
  expect(u.cityMeshMeta).toBe("/data/city_33412_5656_2_sn.mesh.json");
  expect(tileUrlsFrom(primary, null, false).cityMeshMeta).toBe(
    "/data/city_33412_5656_2_sn.mesh.json"
  );
});
