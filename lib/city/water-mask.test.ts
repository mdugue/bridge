import { describe, expect, test } from "bun:test";
import {
  dilate,
  reach,
  trianglesOver,
  type WaterMask,
  waterMaskOf,
} from "./water-mask";

const WATER = 8;

/** A `size`² class raster of meadow (3) with water in columns [x0, x1). */
function river(size: number, x0: number, x1: number): Uint8Array {
  const data = new Uint8Array(size * size).fill(3);
  for (let y = 0; y < size; y++) {
    data.fill(WATER, y * size + x0, y * size + x1);
  }
  return data;
}

const setCells = (mask: WaterMask) => mask.water.reduce((n, v) => n + v, 0);

describe("water mask", () => {
  test("has no cells for a raster without water", () => {
    expect(waterMaskOf(river(64, 0, 0), 64, 64, WATER, 16)).toBeNull();
  });

  test("marks the cells a river runs through, row 0 north", () => {
    // 64 texels on 16 cells: columns 20–27 are cells 5 and 6
    const mask = waterMaskOf(river(64, 20, 28), 64, 64, WATER, 16);
    expect(mask).not.toBeNull();
    const row = [...(mask?.water.slice(0, 16) ?? [])];
    expect(row).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(setCells(mask as WaterMask)).toBe(32);
  });

  test("sees a ditch one texel wide on a large raster", () => {
    const mask = waterMaskOf(river(4096, 2002, 2003), 4096, 4096, WATER);
    expect(mask).not.toBeNull();
    expect(setCells(mask as WaterMask)).toBe(256);
  });

  test("widens every way by its reach", () => {
    const one: WaterMask = { cells: 9, water: new Uint8Array(81) };
    one.water[4 * 9 + 4] = 1;
    const wide = dilate(one, 2);
    expect(setCells(wide)).toBe(25);
    expect(wide.water[2 * 9 + 2]).toBe(1);
    expect(wide.water[1 * 9 + 4]).toBe(0);
    // the reach in metres, on a 900 m tile of 100 m cells: 150 m is 2 cells
    expect(setCells(reach(one, 150, 900))).toBe(25);
  });
});

describe("triangles over water", () => {
  // A 4×4 vertex grid over 3×3 cells, two triangles a cell.
  const cellX: number[] = [];
  const cellY: number[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      cellX.push(Math.min(x, 2));
      cellY.push(Math.min(y, 2));
    }
  }
  const index: number[] = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const a = y * 4 + x;
      index.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
    }
  }

  test("keeps only the triangles whose box touches a set cell", () => {
    const mask: WaterMask = { cells: 3, water: new Uint8Array(9) };
    mask.water[0] = 1; // the north-west cell
    const kept = trianglesOver(new Uint16Array(index), cellX, cellY, mask);
    expect(kept).toBeInstanceOf(Uint16Array);
    // the triangles spanning cells (0..1, 0..1) touch cell 0
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(index.length);
    for (let t = 0; t < kept.length; t += 3) {
      const xs = [kept[t], kept[t + 1], kept[t + 2]].map((i) => cellX[i]);
      const ys = [kept[t], kept[t + 1], kept[t + 2]].map((i) => cellY[i]);
      expect(Math.min(...xs)).toBe(0);
      expect(Math.min(...ys)).toBe(0);
    }
  });

  test("keeps a long triangle that spans the water", () => {
    const mask: WaterMask = { cells: 3, water: new Uint8Array(9) };
    mask.water[4] = 1; // the middle cell
    // one triangle from the north-west corner to the south-east one
    const kept = trianglesOver(new Uint32Array([0, 3, 15]), cellX, cellY, mask);
    expect([...kept]).toEqual([0, 3, 15]);
  });

  test("keeps none without water", () => {
    const mask: WaterMask = { cells: 3, water: new Uint8Array(9) };
    expect(
      trianglesOver(new Uint16Array(index), cellX, cellY, mask).length
    ).toBe(0);
  });
});
