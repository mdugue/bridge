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
  wallOpenings,
  wallRows,
} from "./window-niches";
import type { NicheObject } from "./window-niches";
import { doorSlot, FACADE_SCALE_M, packStyle, WINDOW_DEPTH } from "./windows";

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

  test("one wall stays one when quantising tilts its triangles", () => {
    // the same 12 m wall, one corner of its second triangle 1.5 cm out
    const positions = [
      -6, 100, 0, 6, 100, 0, 6, 112.5, 0, -6, 100, 0, 6, 112.5, 0.015, -6,
      112.5, 0,
    ];
    const facade: number[] = [];
    for (let v = 0; v < 6; v += 1) {
      facade.push(code(-positions[3 * v]), code(12), 32_767, 32_767);
    }
    const niches = tileNiches(
      { positions, facade, objectIds: [0, 0, 0, 0, 0, 0] },
      () => house,
      () => 100
    );
    // one niche an opening, not two a little apart
    expect(niches.length / NICHE_STRIDE).toBe(16);
  });

  test("a wall without ground-floor windows gets no niche there", () => {
    const positions = [
      -6, 100, 0, 6, 100, 0, 6, 112.5, 0, -6, 100, 0, 6, 112.5, 0, -6, 112.5, 0,
    ];
    const facade: number[] = [];
    for (let v = 0; v < 6; v += 1) {
      // signed: a shopfront's ground floor, its windows real holes
      facade.push(code(-positions[3 * v]), -code(12), 32_767, 32_767);
    }
    const niches = tileNiches(
      { positions, facade, objectIds: [0, 0, 0, 0, 0, 0] },
      () => house,
      () => 100
    );
    expect(niches.length / NICHE_STRIDE).toBe(12);
    for (let i = 0; i < niches.length; i += NICHE_STRIDE) {
      expect(niches[i + 10]).toBeGreaterThan(0);
    }
  });

  test("two walls of one object facing one way are two walls", () => {
    // a U's wing ends: the same 12 m wall at z = 0 and, 20 m along x and
    // 8 m back, at z = −8, same codes
    const one = [
      -6, 100, 0, 6, 100, 0, 6, 112.5, 0, -6, 100, 0, 6, 112.5, 0, -6, 112.5, 0,
    ];
    // x + 20, y as it is, z = −8
    const moved = [(x: number) => x + 20, (y: number) => y, () => -8];
    const two = one.map((v, k) => moved[k % 3](v));
    const positions = [...one, ...two];
    const facade: number[] = [];
    for (let v = 0; v < 12; v += 1) {
      const x = positions[3 * v] - (v < 6 ? 0 : 20);
      facade.push(code(-x), code(12), 32_767, 32_767);
    }
    const niches = tileNiches(
      { positions, facade, objectIds: Array.from({ length: 12 }, () => 0) },
      () => house,
      () => 100
    );
    expect(niches.length / NICHE_STRIDE).toBe(32);
    const zs = new Set<number>();
    for (let i = 0; i < niches.length; i += NICHE_STRIDE) {
      zs.add(Math.round(niches[i + 2]));
      // each on its own wall, within its own 12 m
      const centre = niches[i + 2] > -4 ? 0 : 20;
      expect(Math.abs(niches[i] - centre)).toBeLessThan(6);
    }
    expect([...zs].toSorted((a, b) => a - b)).toEqual([-8, 0]);
  });

  test("two walls of one object in one plane are two walls", () => {
    // wings either side of a risalit: the same 12 m wall at z = 0, once
    // around x = 0 and once 20 m along, each with its own s, same codes
    const one = [
      -6, 100, 0, 6, 100, 0, 6, 112.5, 0, -6, 100, 0, 6, 112.5, 0, -6, 112.5, 0,
    ];
    const two = one.map((v, k) => (k % 3 === 0 ? v + 20 : v));
    const positions = [...one, ...two];
    const facade: number[] = [];
    for (let v = 0; v < 12; v += 1) {
      const x = positions[3 * v] - (v < 6 ? 0 : 20);
      facade.push(code(-x), code(12), 32_767, 32_767);
    }
    const niches = tileNiches(
      { positions, facade, objectIds: Array.from({ length: 12 }, () => 0) },
      () => house,
      () => 100
    );
    // each wing its own 16, none doubled on the other
    let near = 0;
    for (let i = 0; i < niches.length; i += NICHE_STRIDE) {
      near += Math.abs(niches[i]) < 6 ? 1 : 0;
    }
    expect(niches.length / NICHE_STRIDE).toBe(32);
    expect(near).toBe(16);
  });

  test("one wall stays one 1 km from the origin", () => {
    // the quantised wall of the test above, 1 km along x
    const positions = [
      -6, 100, 0, 6, 100, 0, 6, 112.5, 0, -6, 100, 0, 6, 112.5, 0.015, -6,
      112.5, 0,
    ].map((v, k) => (k % 3 === 0 ? v + 1000 : v));
    const facade: number[] = [];
    for (let v = 0; v < 6; v += 1) {
      facade.push(code(1000 - positions[3 * v]), code(12), 32_767, 32_767);
    }
    const niches = tileNiches(
      { positions, facade, objectIds: [0, 0, 0, 0, 0, 0] },
      () => house,
      () => 100
    );
    expect(niches.length / NICHE_STRIDE).toBe(16);
  });

  test("a long quantised wall far out stays one wall, no niche twice", () => {
    // 60 m of wall in 3 m quads 1.5 km out, every coordinate off by up to
    // half a quantum (±1.7 cm)
    let seed = 1;
    const noise = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return (seed / 2_147_483_647 - 0.5) * 0.034;
    };
    for (let trial = 0; trial < 30; trial += 1) {
      const positions: number[] = [];
      const facade: number[] = [];
      for (let k = 0; k < 20; k += 1) {
        const [x0, x1] = [-30 + 3 * k, -27 + 3 * k];
        const at = (x: number, y: number) => [
          x + 1500 + noise(),
          y + noise(),
          noise(),
        ];
        for (const v of [
          at(x0, 100),
          at(x1, 100),
          at(x1, 112.5),
          at(x0, 100),
          at(x1, 112.5),
          at(x0, 112.5),
        ]) {
          positions.push(...v);
          facade.push(code(1500 - v[0]), code(60), 32_767, 32_767);
        }
      }
      const niches = tileNiches(
        {
          positions,
          facade,
          objectIds: Array.from({ length: positions.length / 3 }, () => 0),
        },
        () => house,
        () => 100
      );
      const seen = new Set<string>();
      for (let i = 0; i < niches.length; i += NICHE_STRIDE) {
        seen.add(
          `${Math.round(niches[i] * 2)}:${Math.round(niches[i + 1] * 2)}`
        );
      }
      expect(seen.size).toBe(niches.length / NICHE_STRIDE);
    }
  });

  test("a wall's niches stand on its mean plane, not one vertex's", () => {
    // quantising put one triangle's corners 2 cm out, the anchor among them
    const positions = [
      -6, 100, 0.02, 6, 100, 0.02, 6, 112.5, 0.02, -6, 100, 0, 6, 112.5, 0, -6,
      112.5, 0,
    ];
    const facade: number[] = [];
    for (let v = 0; v < 6; v += 1) {
      facade.push(code(-positions[3 * v]), code(12), 32_767, 32_767);
    }
    const niches = tileNiches(
      { positions, facade, objectIds: [0, 0, 0, 0, 0, 0] },
      () => house,
      () => 100
    );
    for (let i = 0; i < niches.length; i += NICHE_STRIDE) {
      expect(niches[i + 2]).toBeCloseTo(0.01, 4);
    }
  });

  test("no ground-floor opening beside a door or a passage's portal", () => {
    const free = wallOpenings(house, code(12), 32_767, 12.5);
    // a 3.5 m portal in the wall's middle: the two middle columns' ground
    // floor (±1.25 m) go, the outer ones (±3.75 m) and the storeys stay
    const portal = wallOpenings(house, code(12), 32_767, 12.5, [
      doorSlot(0, 3.5),
      32_767,
    ]);
    expect(free.length - portal.length).toBe(2);
    expect(portal.filter((o) => o.k === 0).map((o) => o.s)).toEqual([
      -3.75, 3.75,
    ]);
  });

  test("an object without numbers gets no rows (and the count ends)", () => {
    expect(wallRows({ ...house, storey: Number.NaN }, 32_767, 12.5)).toEqual(
      []
    );
    expect(wallRows(house, 32_767, Number.POSITIVE_INFINITY)).toEqual([]);
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
    expect(Math.abs(back[7] - f[7])).toBeLessThan(0.0011);
    expect([back[8], back[9], back[10]]).toEqual([70_123, 3, 4]);
    // the deepest reveal comes back as deep
    const deepest = WINDOW_DEPTH.base + WINDOW_DEPTH.step * 7;
    f[7] = deepest;
    const deep = unpackNiche(
      packNiches(f, baseZ),
      0,
      cx,
      cz,
      baseZ,
      new Float32Array(NICHE_STRIDE)
    );
    expect(Math.abs(deep[7] - deepest)).toBeLessThan(0.0011);
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
