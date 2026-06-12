import { expect, test } from "bun:test";
import { buildingFootprints, epsgToMapPx, mapPxToEpsg } from "./minimap";
import type { TerrainBounds } from "./terrain-geometry";
import type { CityJsonDocument } from "./types";

const bounds: TerrainBounds = [412_000, 5_656_000, 414_000, 5_658_000];
const SIZE = 200;

test("epsgToMapPx maps the corners north-up", () => {
  // North-west corner of the tile -> top-left pixel.
  expect(epsgToMapPx(412_000, 5_658_000, bounds, SIZE)).toEqual({
    px: 0,
    py: 0,
  });
  // South-east corner -> bottom-right pixel.
  expect(epsgToMapPx(414_000, 5_656_000, bounds, SIZE)).toEqual({
    px: SIZE,
    py: SIZE,
  });
  // Tile center -> canvas center.
  expect(epsgToMapPx(413_000, 5_657_000, bounds, SIZE)).toEqual({
    px: SIZE / 2,
    py: SIZE / 2,
  });
});

test("mapPxToEpsg is the inverse of epsgToMapPx", () => {
  const { px, py } = epsgToMapPx(412_345, 5_657_654, bounds, SIZE);
  const { x, y } = mapPxToEpsg(px, py, bounds, SIZE);
  expect(x).toBeCloseTo(412_345);
  expect(y).toBeCloseTo(5_657_654);
});

test("buildingFootprints extracts Building extents and skips parts", () => {
  const doc = {
    type: "CityJSON",
    version: "2.0",
    vertices: [],
    CityObjects: {
      b1: {
        type: "Building",
        geographicalExtent: [412_100, 5_656_100, 110, 412_120, 5_656_130, 125],
      },
      part: {
        type: "BuildingPart",
        parents: ["b1"],
        geographicalExtent: [412_100, 5_656_100, 110, 412_110, 5_656_115, 125],
      },
      noExtent: { type: "Building" },
    },
  } as unknown as CityJsonDocument;

  expect(buildingFootprints(doc)).toEqual([
    { minX: 412_100, minY: 5_656_100, maxX: 412_120, maxY: 5_656_130 },
  ]);
});
