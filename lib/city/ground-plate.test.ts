import { expect, test } from "bun:test";
import {
  decodePlate,
  encodePlate,
  PLATE_N,
  PLATE_SINK_M,
  plateClasses,
  plateHeightIndex,
  plateHeights,
  plateIndex,
  plateNormals,
  plateOf,
  plateGround,
  platePositions,
  plateVertex,
  shrinkClassRaster,
} from "./ground-plate";
import type { TerrainBounds } from "./terrain-geometry";

const WEST: TerrainBounds = [410_000, 5_656_000, 412_000, 5_658_000];
const EAST: TerrainBounds = [412_000, 5_656_000, 414_000, 5_658_000];

test("the vertex grid includes the tile's edges, rows from the north", () => {
  expect(plateVertex(WEST, PLATE_N, 0, 0)).toEqual([410_000, 5_658_000]);
  expect(plateVertex(WEST, PLATE_N, PLATE_N - 1, PLATE_N - 1)).toEqual([
    412_000, 5_656_000,
  ]);
  expect(plateVertex(WEST, PLATE_N, 1, 0)[0] - 410_000).toBe(62.5);
});

test("neighbours share their edge heights, so the plate has no seam", () => {
  const ground = (x: number, y: number) => 100 + x * 0.001 + y * 0.0001;
  const w = plateHeights(WEST, ground, 0);
  const e = plateHeights(EAST, ground, 0);
  for (let j = 0; j < PLATE_N; j++) {
    expect(w[j * PLATE_N + PLATE_N - 1]).toBe(e[j * PLATE_N]);
  }
});

test("a vertex without ground takes the fallback", () => {
  const h = plateHeights(WEST, () => null, 112.34);
  expect(h.every((v) => v === 1123)).toBe(true);
});

test("a class is the commonest around its vertex, not the nearest texel", () => {
  const width = 64;
  const data = new Uint8Array(width * width).fill(1);
  // a road one texel wide through the middle column
  for (let y = 0; y < width; y++) {
    data[y * width + 32] = 7;
  }
  const raster = { bounds: WEST, data, height: width, width };
  expect([...plateClasses(WEST, [raster], 3)]).toEqual(
    Array.from({ length: 9 }, () => 1)
  );
  // a park filling the north-west quarter
  for (let y = 0; y < 32; y++) {
    data.fill(3, y * width, y * width + 32);
  }
  expect(plateClasses(WEST, [raster], 3)[0]).toBe(3);
});

test("a vertex on a shared edge takes the same class in both tiles", () => {
  const width = 64;
  // the west tile is park but for a road strip along its east edge; the
  // east tile is road
  const west = new Uint8Array(width * width).fill(3);
  for (let y = 0; y < width; y++) {
    west.fill(7, y * width + 56, y * width + 64);
  }
  const east = new Uint8Array(width * width).fill(7);
  const rasters = [
    { bounds: WEST, data: west, height: width, width },
    { bounds: EAST, data: east, height: width, width },
  ];
  const w = plateClasses(WEST, rasters, 3);
  const e = plateClasses(EAST, rasters, 3);
  for (let j = 0; j < 3; j++) {
    expect(w[j * 3 + 2]).toBe(e[j * 3]);
  }
  // read from its own raster alone, the west tile's edge was park
  expect(plateClasses(WEST, rasters.slice(0, 1), 3)[2]).toBe(3);
  expect(w[2]).toBe(7);
});

test("a shrunk class raster keeps ids, never a blend", () => {
  const data = Uint8Array.from({ length: 16 }, (_, v) => v);
  const r = shrinkClassRaster({ bounds: WEST, data, height: 4, width: 4 }, 2);
  expect([r.width, r.height]).toEqual([2, 2]);
  expect([...r.data]).toEqual([5, 7, 13, 15]);
});

test("the file reads back as it was written", () => {
  const tile = (seed: number) => ({
    heights: Int16Array.from({ length: PLATE_N ** 2 }, (_, v) => seed + v),
    classes: Uint8Array.from(
      { length: PLATE_N ** 2 },
      (_, v) => (seed + v) % 12
    ),
  });
  const a = tile(1000);
  const b = tile(-200);
  const bytes = encodePlate([a, b]);
  expect(bytes.length).toBe(2 * PLATE_N ** 2 * 3);
  const tiles = [
    { id: "w", bounds: WEST },
    { id: "e", bounds: EAST },
  ];
  const [ra, rb] = decodePlate(bytes, tiles, PLATE_N);
  expect(ra.id).toBe("w");
  expect(ra.bounds).toBe(WEST);
  expect(ra.heights[5]).toBeCloseTo(100.5, 5);
  expect(rb.heights[0]).toBeCloseTo(-20, 5);
  expect([...ra.classes]).toEqual([...a.classes]);
  expect([...rb.classes]).toEqual([...b.classes]);
  expect(() => decodePlate(bytes, tiles.slice(1), PLATE_N)).toThrow();
  expect(() => encodePlate([{ ...a, classes: new Uint8Array(3) }])).toThrow();
});

test("the triangles face up in the Y-up frame", () => {
  const n = 3;
  const tile = {
    id: "w",
    bounds: WEST,
    classes: new Uint8Array(n * n),
    heights: new Float32Array(n * n).fill(120),
  };
  const pos = platePositions(tile, n, { cx: 411_000, cy: 5_657_000 });
  // the edge rows keep their heights, the inner vertices sink
  expect(pos[1]).toBe(120);
  expect(pos[4 * 3 + 1]).toBe(120 - PLATE_SINK_M);
  // north-west corner: west of the centre, north is −z
  expect(pos[0]).toBe(-1000);
  expect(pos[2]).toBe(-1000);
  const index = plateIndex(n);
  expect(index.length).toBe((n - 1) ** 2 * 6);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]].map((v) => [
      pos[v * 3],
      pos[v * 3 + 1],
      pos[v * 3 + 2],
    ]);
    const e1 = [b[0] - a[0], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[2] - a[2]];
    // y of (b − a) × (c − a)
    expect(e1[1] * e2[0] - e1[0] * e2[1]).toBeGreaterThan(0);
  }
});

test("the normals agree along a shared edge and tilt down the slope", () => {
  const n = 3;
  // the ground rises 1 m per 100 m eastwards
  const tile = (id: string, bounds: typeof WEST) => {
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        heights[j * n + i] = plateVertex(bounds, n, i, j)[0] / 100;
      }
    }
    return { id, bounds, classes: new Uint8Array(n * n), heights };
  };
  const tiles = [tile("w", WEST), tile("e", EAST)];
  const at = plateHeightIndex(tiles, n);
  const w = plateNormals(tiles[0], n, at);
  const e = plateNormals(tiles[1], n, at);
  for (let j = 0; j < n; j++) {
    const a = (j * n + n - 1) * 3;
    const b = j * n * 3;
    expect(w.slice(a, a + 3)).toEqual(e.slice(b, b + 3));
  }
  // facing west, up the slope's other side
  expect(w[0]).toBeCloseTo(-0.01 / Math.hypot(0.01, 1), 6);
  expect(w[1]).toBeGreaterThan(0.99);
  expect(w[2]).toBeCloseTo(0, 9);
});

test("the extras' plate is read only when well-formed", () => {
  const plate = {
    file: "plate.bin.0.gz",
    n: PLATE_N,
    tiles: [{ id: "w", bounds: WEST }],
  };
  expect(plateOf({ plate })).toBe(plate);
  expect(plateOf({})).toBeUndefined();
  expect(plateOf(null)).toBeUndefined();
  expect(plateOf({ plate: { file: 3 } })).toBeUndefined();
});

test("the plate's ground reads its drawn heights back, bilinear, null off it", () => {
  const n = 5;
  // two tiles side by side; a ramp rising 1 m per metre east and 0.5 m
  // per metre north
  const tiles = [
    [1000, 2000, 1400, 2400],
    [1400, 2000, 1800, 2400],
  ].map((b) => {
    const bounds = b as TerrainBounds;
    const heights = new Float32Array(n * n).map((_, v) => {
      const [x, y] = plateVertex(bounds, n, v % n, Math.floor(v / n));
      return x - 900 + (y - 2000) / 2;
    });
    const tile = { id: "t", bounds, classes: new Uint8Array(n * n), heights };
    return {
      bounds,
      positions: platePositions(tile, n, { cx: 1000, cy: 2000 }),
    };
  });
  const at = plateGround(tiles, n);
  const ramp = (x: number, y: number) => x - 900 + (y - 2000) / 2;
  // corners, inner vertices (their sink undone), between them, both tiles
  for (const [x, y] of [
    [1000, 2400],
    [1200, 2200],
    [1250, 2130],
    [1400, 2000],
    [1650, 2370],
    [1800, 2400],
  ]) {
    expect(at(x, y)).toBeCloseTo(ramp(x, y), 4);
  }
  expect(at(999, 2200)).toBeNull();
  expect(at(1200, 2401)).toBeNull();
});
