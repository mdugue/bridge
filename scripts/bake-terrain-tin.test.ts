import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  decodeTerrainTin,
  parseTerrainTinHeader,
  TinIndex,
} from "../lib/city/terrain-tin";
import { dgmSourceFiles, PRIMARY_TILE } from "../lib/city/tile";
import { bakeTerrainTin, tinFromGrid } from "./bake-terrain-tin";

function arrayBufferOf(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer;
}

function decode(baked: ReturnType<typeof tinFromGrid>) {
  const header = parseTerrainTinHeader({ ...baked.header, data: "x.bin.gz" });
  return decodeTerrainTin(arrayBufferOf(gunzipSync(baked.data)), header);
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
  const baked = tinFromGrid(grid, N, [0, 0, N, N], 0.1);
  const tin = decode(baked);
  // A plane and one wall need a few dozen triangles, not 2 × 64².
  expect(baked.header.triangleCount).toBeLessThan(500);
  const index = new TinIndex(tin);
  let worst = 0;
  // Interior pixel centres (the border ring is snapped to the tile edge).
  for (let row = 1; row < N - 1; row++) {
    for (let col = 1; col < N - 1; col++) {
      const h = index.heightAt(col + 0.5, N - row - 0.5);
      expect(h).not.toBeNull();
      worst = Math.max(worst, Math.abs((h as number) - grid[row * N + col]));
    }
  }
  // tolerance + half a centimetre of quantisation
  expect(worst).toBeLessThanOrEqual(0.1 + 0.005);
});

test("a grid with holes is refused (that tile keeps its heightfield)", () => {
  const grid = wallGrid();
  grid[100] = Number.NaN;
  expect(() => tinFromGrid(grid, N, [0, 0, N, N], 0.1)).toThrow();
});

test("bakes the committed primary DGM at its native resolution", async () => {
  const src = dgmSourceFiles(PRIMARY_TILE);
  const baked = await bakeTerrainTin(
    arrayBufferOf(readFileSync(src.tif)),
    readFileSync(src.tfw, "utf8"),
    2
  );
  expect(baked.header.n).toBe(2000);
  expect(baked.header.bounds[2] - baked.header.bounds[0]).toBe(2000);
  const tin = decode(baked);
  // The Elbe crosses the tile: its surface (~104–105 m) is the lowest ground.
  const min = Math.min(...tin.z);
  expect(min).toBeGreaterThan(100);
  expect(min).toBeLessThan(110);
});
