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

// Index/vertex budgets: an n*n surface grid plus a 4*n vertical skirt ring
// (one bottom vertex per border vertex). Top = (n-1)^2 quads; skirt = 4 borders
// of (n-1) segments, each a 2-triangle quad.
const topIndices = (n: number) => (n - 1) * (n - 1) * 2 * 3;
const skirtIndices = (n: number) => 4 * (n - 1) * 2 * 3;

test("buildTerrainGeometryData returns grid + skirt positions and triangulation", () => {
  const { positions, indices } = buildTerrainGeometryData({
    ...flat3x3,
    offset: { cx: 0, cy: 0 },
  });
  // n*n grid vertices + a 4*n skirt ring.
  expect(positions.length).toBe((3 * 3 + 4 * 3) * 3);
  expect(indices.length).toBe(topIndices(3) + skirtIndices(3));
});

test("buildTerrainGeometryData keeps interior vertices at pixel centers, snaps borders to the tile edge", () => {
  const { positions } = buildTerrainGeometryData({
    ...flat3x3,
    offset: { cx: 1.5, cy: 1.5 },
  });
  // Interior center vertex (row 1, col 1): true pixel center (1.5, 1.5).
  expect(positions[4 * 3]).toBeCloseTo(1.5 - 1.5);
  expect(positions[4 * 3 + 1]).toBeCloseTo(1.5 - 1.5);
  expect(positions[4 * 3 + 2]).toBe(100);
  // Vertex 0 = NW corner: snapped out to the true edge (minX, maxY) so
  // neighbouring tiles meet with no sky gap.
  expect(positions[0]).toBeCloseTo(0 - 1.5);
  expect(positions[1]).toBeCloseTo(3 - 1.5);
  // Last grid vertex (row 2, col 2) = SE corner: snapped to (maxX, minY).
  expect(positions[8 * 3]).toBeCloseTo(3 - 1.5);
  expect(positions[8 * 3 + 1]).toBeCloseTo(0 - 1.5);
});

test("buildTerrainGeometryData omits quads touching a NoData vertex", () => {
  const elevations = new Float32Array(9).fill(100);
  elevations[0] = -9999; // north-west corner -> kills its top quad + 2 skirt segs
  const { indices } = buildTerrainGeometryData({
    ...flat3x3,
    elevations,
    offset: { cx: 0, cy: 0 },
  });
  // One top quad gone, and the two skirt segments touching vertex 0 (north[0],
  // west[0]) dropped: 2 quads * 6 indices.
  expect(indices.length).toBe(topIndices(3) + skirtIndices(3) - 2 * 6 - 6);
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
