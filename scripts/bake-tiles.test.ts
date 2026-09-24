import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { writeArrayBuffer } from "geotiff";
import { TriangleIndex } from "../lib/city/terrain-tin";
import { dgmSourceFiles } from "../lib/city/tile";
import {
  type Dgm,
  hasNoData,
  readDgm,
  terrainMesh,
  tinTerrainMesh,
} from "./bake-tiles";

const PRIMARY_TILE = "33412_5656_2_sn";

function arrayBufferOf(buf: Buffer<ArrayBuffer>): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

test("the committed spawn-tile DGM resamples to a grid on the Elbe", async () => {
  const src = dgmSourceFiles(PRIMARY_TILE);
  const dgm = await readDgm(
    arrayBufferOf(readFileSync(src.tif)),
    readFileSync(src.tfw, "utf8"),
    64
  );
  expect(dgm.bounds[2] - dgm.bounds[0]).toBe(2000);
  expect(dgm.bounds[3] - dgm.bounds[1]).toBe(2000);
  expect(dgm.elevations).toHaveLength(64 * 64);
  // The Elbe crosses this tile: its lowest sample is the river (~104 m).
  const min = Math.min(...dgm.elevations);
  expect(min).toBeGreaterThan(100);
  expect(min).toBeLessThan(110);
  // The mesh: the grid first (row 0 = north, the elevations as z), then the
  // skirt; an interior normal points up.
  const mesh = terrainMesh(dgm, [], { cx: 413_000, cy: 5_657_000 });
  expect(mesh.input.positions.length).toBeGreaterThan(64 * 64 * 3);
  const inner = 32 * 64 + 32;
  expect(mesh.input.positions[inner * 3 + 2]).toBe(dgm.elevations[inner]);
  expect(mesh.minElevation).toBeCloseTo(min, 3);
  expect(mesh.input.normals[inner * 3 + 2]).toBeGreaterThan(0.5);
});

test("a raster without georeferencing is placed by its .tfw, or refused", async () => {
  // A 4×4 TIFF whose transform is pixel space — what an untagged tile reads
  // as. (geotiff's writer invents a whole-globe transform unless a projection
  // key is given, hence the EPSG tag.)
  const bare = writeArrayBuffer(
    Array.from({ length: 16 }, (_, i) => 100 + i),
    {
      width: 4,
      height: 4,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 0, 4, 0],
      ProjectedCSTypeGeoKey: 25_833,
    }
  );
  // bun-types declare the `rejects` matchers as void, but bun resolves them
  // asynchronously — dropping the await would end the test before it runs.
  // oxlint-disable-next-line typescript/await-thenable
  await expect(readDgm(bare, null, 4)).rejects.toThrow(/\.tfw/);
  // The world file references the CENTRE of the top-left pixel; the bounds
  // are the pixel edges.
  const dgm = await readDgm(bare, "1\n0\n0\n-1\n412000.5\n5657999.5\n", 4);
  expect(dgm.bounds).toEqual([412_000, 5_657_996, 412_004, 5_658_000]);
});

// 65×65 cells of 1 m: a gentle slope with an 8 m retaining wall across it,
// ramped over one cell — the shape the native DGM1 gives a wall.
const N = 65;
function wallDgm(): Dgm {
  const elevations = new Float32Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const wall = col < 30 ? 0 : col > 31 ? 8 : (col - 30) * 4;
      elevations[row * N + col] = 100 + row * 0.02 + wall;
    }
  }
  return { bounds: [0, 0, N, N], elevations, n: N };
}

/** The index over a baked mesh, as the viewer builds it (skirt included). */
function indexOf(
  mesh: ReturnType<typeof tinTerrainMesh>,
  bounds: Dgm["bounds"]
) {
  const p = mesh.input.positions;
  const count = p.length / 3;
  const xy = new Float64Array(count * 2);
  const z = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    xy[2 * i] = p[3 * i];
    xy[2 * i + 1] = p[3 * i + 1];
    z[i] = p[3 * i + 2];
  }
  return new TriangleIndex(xy, z, mesh.input.indices ?? [], bounds);
}

test("every grid point lies within the tolerance of the TIN", () => {
  const dgm = wallDgm();
  const mesh = tinTerrainMesh(dgm, 0.1, { cx: 0, cy: 0 });
  // A plane and one wall need a few dozen triangles, not 2 × 64².
  expect(mesh.triangleCount).toBeLessThan(500);
  expect(mesh.input.weld).toBe(true);
  const index = indexOf(mesh, dgm.bounds);
  let worst = 0;
  // Interior pixel centres (the border ring is snapped to the tile edge).
  for (let row = 1; row < N - 1; row++) {
    for (let col = 1; col < N - 1; col++) {
      const h = index.heightAt(col + 0.5, N - row - 0.5);
      expect(h).not.toBeNull();
      worst = Math.max(
        worst,
        Math.abs((h as number) - dgm.elevations[row * N + col])
      );
    }
  }
  // tolerance + float32 rounding
  expect(worst).toBeLessThanOrEqual(0.1 + 1e-4);
});

test("a DGM with holes is flagged and refused by the TIN", () => {
  const dgm = wallDgm();
  expect(hasNoData(dgm)).toBe(false);
  dgm.elevations[100] = Number.NaN;
  expect(hasNoData(dgm)).toBe(true);
  expect(() => tinTerrainMesh(dgm, 0.1, { cx: 0, cy: 0 })).toThrow();
});

test("meshes the committed spawn-tile DGM at its native resolution", async () => {
  const src = dgmSourceFiles(PRIMARY_TILE);
  const dgm = await readDgm(
    arrayBufferOf(readFileSync(src.tif)),
    readFileSync(src.tfw, "utf8")
  );
  expect(dgm.n).toBe(2000);
  const mesh = tinTerrainMesh(dgm, 2, { cx: 413_000, cy: 5_657_000 });
  // The Elbe crosses the tile: its surface (~104–105 m) is the lowest ground.
  expect(mesh.minElevation).toBeGreaterThan(100);
  expect(mesh.minElevation).toBeLessThan(110);
  expect(mesh.triangleCount).toBeGreaterThan(100);
});
