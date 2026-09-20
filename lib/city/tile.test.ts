import { expect, test } from "bun:test";
import {
  dgmSourceFiles,
  PRIMARY_TILE,
  TILE_BLOCK,
  tileArtifacts,
  tileUrls,
} from "./tile";

const primary = { tile: PRIMARY_TILE, n: 1024 };

test("the artifact map reproduces the served file names", () => {
  const a = tileArtifacts(primary);
  expect(a.city.file).toBe("lod2_33412_5656_2_sn.city.json");
  expect(a.heightfieldHeader.file).toBe(
    "dgm1_33412_5656_2_sn.heightfield-1024.json"
  );
  expect(a.heightfieldData.file).toBe(
    "dgm1_33412_5656_2_sn.heightfield-1024.f32"
  );
  expect(a.walls.file).toBe("walls_33412_5656_2_sn.geojson");
  expect(a.roofColor.file).toBe("roofcolor_33412_5656_2_sn.json");
  expect(a.ndvi.file).toBe("ndvi_33412_5656_2_sn.png");
  expect(a.landcoverRgb.file).toBe("landcover_rgb_33412_5656_2_sn.png");
});

test("exactly seven artifacts are required", () => {
  const required = Object.values(tileArtifacts(primary)).filter(
    (a) => a.required
  );
  expect(required).toHaveLength(7);
});

test("tileUrls prefixes the /data route", () => {
  expect(tileUrls(primary).canopy).toBe("/data/canopy_33412_5656_2_sn.geojson");
  expect(tileUrls(primary, "/x").city).toBe(
    "/x/lod2_33412_5656_2_sn.city.json"
  );
});

test("the tile block lists the primary first", () => {
  expect(TILE_BLOCK[0].tile).toBe(PRIMARY_TILE);
  expect(dgmSourceFiles(PRIMARY_TILE).tif).toBe(
    "data/dgm/dgm1_33412_5656_2_sn_tiff/dgm1_33412_5656_2_sn.tif"
  );
});
