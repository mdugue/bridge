import { expect, test } from "bun:test";
import {
  buildingFootprintPolys,
  buildingFootprints,
  epsgToMapPx,
  mapPxToEpsg,
} from "./minimap";
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

test("buildingFootprintPolys uses child GroundSurface polys, not the parent bbox", () => {
  // A parent Building (empty geometry + children) whose BuildingPart carries the
  // real ground ring. The parent's bbox must NOT be drawn on top of it.
  const doc = {
    type: "CityJSON",
    version: "2.0",
    transform: { scale: [1, 1, 1], translate: [0, 0, 0] },
    vertices: [
      [412_100, 5_656_100, 110],
      [412_110, 5_656_100, 110],
      [412_110, 5_656_115, 110],
      [412_100, 5_656_115, 110],
    ],
    CityObjects: {
      b1: {
        type: "Building",
        children: ["part"],
        geographicalExtent: [412_100, 5_656_100, 110, 412_120, 5_656_130, 125],
      },
      part: {
        type: "BuildingPart",
        parents: ["b1"],
        geometry: [
          {
            type: "Solid",
            boundaries: [[[[0, 1, 2, 3]]]],
            semantics: {
              surfaces: [{ type: "GroundSurface" }],
              values: [[0]],
            },
          },
        ],
      },
    },
  } as unknown as CityJsonDocument;

  // Exactly one poly (the part's ground ring); no extra parent-bbox rectangle.
  expect(buildingFootprintPolys(doc)).toEqual([
    {
      pts: [
        [412_100, 5_656_100],
        [412_110, 5_656_100],
        [412_110, 5_656_115],
        [412_100, 5_656_115],
      ],
    },
  ]);
});

test("buildingFootprintPolys falls back to bbox for a leaf Building with no geometry", () => {
  const doc = {
    type: "CityJSON",
    version: "2.0",
    vertices: [],
    CityObjects: {
      b1: {
        type: "Building",
        geographicalExtent: [412_100, 5_656_100, 110, 412_120, 5_656_130, 125],
      },
    },
  } as unknown as CityJsonDocument;

  expect(buildingFootprintPolys(doc)).toEqual([
    {
      pts: [
        [412_100, 5_656_100],
        [412_120, 5_656_100],
        [412_120, 5_656_130],
        [412_100, 5_656_130],
      ],
    },
  ]);
});
