import { describe, expect, test } from "bun:test";
import {
  NICHE_CELL_M,
  NICHE_STRIDE,
  cellNiches,
  HOUSE_STRIDE,
  houseBoxes,
  jitterHash,
  nicheCellKey,
  packNiches,
  unpackNiche,
  tileNiches,
  wallColumns,
  wallRows,
} from "./window-niches";
import type { NicheObject } from "./window-niches";
import { FACADE_SCALE_M, packStyle } from "./windows";

const house: NicheObject = {
  axis: 2.5,
  w: 1.1,
  h: 1.5,
  style: packStyle({ depth: 0.15, sill: 0.8 }),
  storey: 3.2,
  eave: 12.5,
  seed: 0.3,
};
const code = (m: number) => Math.round((m / FACADE_SCALE_M) * 32_767);

describe("window niches", () => {
  test("a jitter hash lies in 0…1", () => {
    for (let j = 0; j < 20; j += 1) {
      const h = jitterHash(j, -0.7 + j * 0.07);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  test("columns fill a wall from its middle, the outer ones in from its ends", () => {
    const { centres, w } = wallColumns(house, code(12));
    expect(w).toBeCloseTo(1.1);
    // 12 − 1.4 − 1.1 = 9.5 → 3 spacings + 1 = 4 axes
    expect(centres.length).toBe(4);
    expect(centres[0]).toBeCloseTo(-3.75);
    expect(centres.at(-1)).toBeCloseTo(3.75);
  });

  test("rows stand one a storey, the top one under the eave", () => {
    const rows = wallRows(house, 32_767, 12.5);
    expect(rows.length).toBe(4);
    expect(rows[1].v0).toBeCloseTo(3.2 + 0.8);
    for (const r of rows) {
      expect(r.v1).toBeLessThanOrEqual(12.5 - 0.5 + 1e-6);
    }
  });

  test("a rectangular wall gets a niche per opening on its plane", () => {
    // a 12 m wall 12.5 m tall facing +z (scene), base at y = 100
    const positions = [
      -6, 100, 0, 6, 100, 0, 6, 112.5, 0, -6, 100, 0, 6, 112.5, 0, -6, 112.5, 0,
    ];
    const facade: number[] = [];
    for (let v = 0; v < 6; v += 1) {
      // s runs along t = (−n.z, n.x): −x on a wall facing +z
      facade.push(code(-positions[3 * v]), code(12), 32_767, 32_767);
    }
    const niches = tileNiches(
      { positions, facade, objectIds: [0, 0, 0, 0, 0, 0] },
      () => house,
      () => 100
    );
    expect(niches.length / NICHE_STRIDE).toBe(16);
    // on the plane z = 0, facing +z, inside the wall
    for (let i = 0; i < niches.length; i += NICHE_STRIDE) {
      expect(niches[i + 2]).toBeCloseTo(0);
      expect(niches[i + 4]).toBeCloseTo(1);
      expect(Math.abs(niches[i])).toBeLessThan(6);
    }
  });

  test("niches sorted by cell keep every niche, each cell one run", () => {
    const xs = [5, 70, 6, -40, 71];
    const raw = new Float32Array(xs.length * NICHE_STRIDE);
    for (const [i, x] of xs.entries()) {
      raw[i * NICHE_STRIDE] = x;
      raw[i * NICHE_STRIDE + 2] = 3;
      raw[i * NICHE_STRIDE + 8] = i;
    }
    const { niches, cells } = cellNiches(raw);
    expect(niches.length).toBe(raw.length);
    expect(cells.length / 3).toBe(3);
    for (let c = 0; c < cells.length; c += 3) {
      for (let i = cells[c + 1]; i < cells[c + 2]; i += 1) {
        const x = niches[i * NICHE_STRIDE];
        expect(nicheCellKey(Math.floor(x / NICHE_CELL_M), 0)).toBe(cells[c]);
      }
    }
    const objects = [...xs.keys()].map((i) => niches[i * NICHE_STRIDE + 8]);
    expect(objects.toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  test("a packed niche comes back within a centimetre, never smaller", () => {
    const f = new Float32Array(NICHE_STRIDE);
    f.set([
      -1234.567, 123.45, 987.654, 0.6, -0.8, 0.55, 0.8, 0.15, 70_123, 3, 4,
    ]);
    const baseZ = new Float32Array(70_124);
    baseZ[70_123] = 110.2;
    const p = packNiches(f, baseZ);
    const cx = Math.floor(f[0] / NICHE_CELL_M);
    const cz = Math.floor(f[2] / NICHE_CELL_M);
    const back = unpackNiche(
      p,
      0,
      cx,
      cz,
      baseZ,
      new Float32Array(NICHE_STRIDE)
    );
    for (const k of [0, 1, 2]) {
      expect(Math.abs(back[k] - f[k])).toBeLessThan(0.006);
    }
    for (const k of [3, 4]) {
      expect(Math.abs(back[k] - f[k])).toBeLessThan(0.0002);
    }
    for (const k of [5, 6]) {
      expect(back[k]).toBeGreaterThanOrEqual(f[k] - 1e-6);
      expect(back[k] - f[k]).toBeLessThan(0.02);
    }
    expect(Math.abs(back[7] - f[7])).toBeLessThan(0.0006);
    expect([back[8], back[9], back[10]]).toEqual([70_123, 3, 4]);
  });
  test("each house's windows' extent, its parts together", () => {
    // objects 0, 1 of house 0; object 2 its own house
    const raw = new Float32Array(3 * NICHE_STRIDE);
    for (const [i, [x, z]] of [
      [1, 5],
      [-4, 9],
      [30, 30],
    ].entries()) {
      raw[i * NICHE_STRIDE] = x;
      raw[i * NICHE_STRIDE + 2] = z;
      raw[i * NICHE_STRIDE + 8] = i;
    }
    const boxes = houseBoxes(raw, new Uint32Array([0, 0, 2]));
    expect(boxes.length).toBe(2 * HOUSE_STRIDE);
    expect([...boxes]).toEqual([0, -4, 1, 5, 9, 2, 30, 30, 30, 30]);
  });
});
