import { expect, test } from "bun:test";
import { epsgToMapPx, mapPxToEpsg } from "./minimap";
import type { TerrainBounds } from "./terrain-geometry";

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
