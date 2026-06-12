import { expect, test } from "bun:test";
import {
  buildTerrainGeometryData,
  sampleHeightfield,
} from "./terrain-geometry";

const flat3x3 = {
  // 3x3 grid, all at 100 m, covering a 3x3 m tile at (0,0)..(3,3).
  elevations: new Float32Array(9).fill(100),
  n: 3,
  bounds: [0, 0, 3, 3] as [number, number, number, number],
  nodata: -9999,
};

test("buildTerrainGeometryData returns n*n*3 positions and full triangulation", () => {
  const { positions, indices } = buildTerrainGeometryData({
    ...flat3x3,
    offset: { cx: 0, cy: 0 },
  });
  expect(positions.length).toBe(3 * 3 * 3);
  // (n-1)^2 quads * 2 triangles * 3 indices
  expect(indices.length).toBe(2 * 2 * 2 * 3);
});

test("buildTerrainGeometryData places a known cell at pixel center minus offset", () => {
  const { positions } = buildTerrainGeometryData({
    ...flat3x3,
    offset: { cx: 1.5, cy: 1.5 },
  });
  // Vertex 0 = row 0 (north), col 0 (west): pixel center (0.5, 2.5), z kept.
  expect(positions[0]).toBeCloseTo(0.5 - 1.5);
  expect(positions[1]).toBeCloseTo(2.5 - 1.5);
  expect(positions[2]).toBe(100);
  // Last vertex = row 2 (south), col 2 (east): pixel center (2.5, 0.5).
  expect(positions[24]).toBeCloseTo(2.5 - 1.5);
  expect(positions[25]).toBeCloseTo(0.5 - 1.5);
});

test("buildTerrainGeometryData omits quads touching a NoData vertex", () => {
  const elevations = new Float32Array(9).fill(100);
  elevations[0] = -9999; // north-west corner -> kills exactly one quad
  const { indices } = buildTerrainGeometryData({
    ...flat3x3,
    elevations,
    offset: { cx: 0, cy: 0 },
  });
  expect(indices.length).toBe((4 - 1) * 2 * 3);
  // The NoData vertex must not be referenced at all.
  expect(indices).not.toContain(0);
});

test("buildTerrainGeometryData rejects degenerate bounds", () => {
  expect(() =>
    buildTerrainGeometryData({
      ...flat3x3,
      bounds: [10, 0, 10, 3],
      offset: { cx: 0, cy: 0 },
    })
  ).toThrow(/Degenerate/);
});

test("sampleHeightfield interpolates bilinearly and respects NoData", () => {
  // 2x2 grid over (0,0)..(2,2): north row = 100/200, south row = 300/400.
  const input = {
    elevations: new Float32Array([100, 200, 300, 400]),
    n: 2,
    bounds: [0, 0, 2, 2] as [number, number, number, number],
    nodata: -9999,
  };
  // Center of the tile = average of all four samples.
  expect(sampleHeightfield(input, 1, 1)).toBeCloseTo(250);
  // Exactly on the north-west pixel center.
  expect(sampleHeightfield(input, 0.5, 1.5)).toBeCloseTo(100);
  // Outside the raster.
  expect(sampleHeightfield(input, -5, 1)).toBeNull();
  // NoData contributes -> null, not a spike.
  const withHole = {
    ...input,
    elevations: new Float32Array([-9999, 200, 300, 400]),
  };
  expect(sampleHeightfield(withHole, 1, 1)).toBeNull();
});
