import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TinIndex, tinSurface } from "../lib/city/terrain-tin";
import { dgmSourceFiles } from "../lib/city/tile";
import { tinFromGrid } from "./bake-terrain-tin";
import { readDgm, tinTerrainMesh } from "./bake-tiles";

const SPAWN_TILE = "33412_5656_2_sn";

function arrayBufferOf(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer;
}

// 65×65 cells of 1 m: a gentle slope with an 8 m retaining wall across it,
// ramped over one cell — the shape the native DGM1 gives a wall.
const N = 65;
function wallGrid(): Float64Array {
  const g = new Float64Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const wall = col < 30 ? 0 : col > 31 ? 8 : (col - 30) * 4;
      g[row * N + col] = 100 + row * 0.02 + wall;
    }
  }
  return g;
}

test("every grid point lies within the tolerance of the TIN", () => {
  const grid = wallGrid();
  const tin = tinFromGrid(grid, N, [0, 0, N, N], 0.1);
  // A plane and one wall need a few dozen triangles, not 2 × 64².
  expect(tin.triangles.length / 3).toBeLessThan(500);
  const index = new TinIndex(tinSurface(tin));
  let worst = 0;
  // Interior pixel centres (the border ring is snapped to the tile edge).
  for (let row = 1; row < N - 1; row++) {
    for (let col = 1; col < N - 1; col++) {
      const h = index.heightAt(col + 0.5, N - row - 0.5);
      expect(h).not.toBeNull();
      worst = Math.max(worst, Math.abs((h as number) - grid[row * N + col]));
    }
  }
  expect(worst).toBeLessThanOrEqual(0.1 + 1e-6);
});

test("a grid with holes is refused (that tile keeps the grid)", () => {
  const grid = wallGrid();
  grid[100] = Number.NaN;
  expect(() => tinFromGrid(grid, N, [0, 0, N, N], 0.1)).toThrow();
  const dgm = {
    bounds: [0, 0, N, N] as [number, number, number, number],
    elevations: Float32Array.from(grid),
    n: N,
  };
  expect(tinTerrainMesh(dgm, [], { cx: 0, cy: 0 }, {}, 0.1)).toBeNull();
});

test("the fine level meshes the committed spawn DGM at its native resolution", async () => {
  const src = dgmSourceFiles(SPAWN_TILE);
  const dgm = await readDgm(
    arrayBufferOf(readFileSync(src.tif)),
    readFileSync(src.tfw, "utf8"),
    "native"
  );
  expect(dgm.n).toBe(2000);
  expect(dgm.bounds[2] - dgm.bounds[0]).toBe(2000);
  // A coarse tolerance keeps the test fast; the bake runs at 0.15 m.
  const mesh = tinTerrainMesh(dgm, [], { cx: 0, cy: 0 }, {}, 2);
  expect(mesh?.tin?.triangles).toBeGreaterThan(0);
  // The Elbe crosses the tile: its surface (~104–105 m) is the lowest ground.
  expect(mesh?.minElevation).toBeGreaterThan(100);
  expect(mesh?.minElevation).toBeLessThan(110);
  const [minX, minY] = dgm.bounds;
  expect(mesh?.heightAt(minX + 1000, minY + 1000)).not.toBeNull();
  expect(mesh?.heightAt(minX - 1, minY)).toBeNull();
}, 60_000);
