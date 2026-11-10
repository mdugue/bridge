import { describe, expect, test } from "bun:test";
import { NICHE_STRIDE, cellNiches, packNiches } from "@/lib/city/window-niches";
import type { CityLayer } from "./city-layer";
import { Matrix4, Vector3 } from "three";
import {
  nearHouses,
  nicheGeometry,
  writeNicheMatrix,
} from "./window-niche-layer";

describe("window niche layer", () => {
  test("the niche's faces look into it, toward the open front", () => {
    const g = nicheGeometry();
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    expect(p.count).toBe(30);
    for (let t = 0; t < p.count; t += 3) {
      const a = [p.getX(t), p.getY(t), p.getZ(t)];
      const b = [p.getX(t + 1), p.getY(t + 1), p.getZ(t + 1)];
      const c = [p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2)];
      const e1 = b.map((v, i) => v - a[i]);
      const e2 = c.map((v, i) => v - a[i]);
      const face = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const normal = [n.getX(t), n.getY(t), n.getZ(t)];
      // wound counter-clockwise seen along its normal
      expect(
        face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2]
      ).toBeGreaterThan(0);
      // … which points into the box (its middle at z = −0.5) or out of its front
      const mid = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      const toCentre = [-mid[0], -mid[1], -0.5 - mid[2]];
      expect(
        toCentre[0] * normal[0] +
          toCentre[1] * normal[1] +
          toCentre[2] * normal[2]
      ).toBeGreaterThan(0);
    }
  });

  test("the houses near the eye: whole, within the radius, standing, nearest first past capacity, kept past the radius a while", () => {
    // objects 0…4; houses (roots): 0 = {0, 1}, 2 = {2}, 3 = {3, 4}
    const xs = [0, 90, 20, 30, 200];
    const roots = new Uint32Array([0, 0, 2, 3, 3]);
    const raw = new Float32Array(xs.length * NICHE_STRIDE);
    for (const [i, x] of xs.entries()) {
      raw[i * NICHE_STRIDE] = x;
      raw[i * NICHE_STRIDE + 8] = i;
    }
    const sorted = cellNiches(raw);
    const { cells } = sorted;
    const baseZ = new Float32Array(xs.length);
    const niches = packNiches(sorted.niches, baseZ);
    const cellMap = new Map<number, [number, number]>();
    for (let i = 0; i < cells.length; i += 3) {
      cellMap.set(cells[i], [cells[i + 1], cells[i + 2]]);
    }
    let demolished = -1;
    const city = {
      stands: (i: number) => i !== demolished,
      table: { baseZ, root: roots },
    } as unknown as CityLayer;
    const tile = {
      city,
      niches,
      cells: cellMap,
      box: [0, 0, 0, 0] as [number, number, number, number],
      cutting: false,
      houses: new Set<number>(),
      niched: new Set<number>(),
      boxes: new Map<number, [number, number, number, number]>([
        [0, [0, 90, 0, 0]],
        [2, [20, 20, 0, 0]],
        [3, [30, 200, 0, 0]],
      ]),
    };
    const objectsOf = (houses: ReturnType<typeof nearHouses>) =>
      houses
        .flatMap((h) =>
          h.niches.map((c) => sorted.niches[c.i * NICHE_STRIDE + 8])
        )
        .toSorted((a, b) => a - b);
    // whole houses: house 0 with its window at 90 m, house 3 by its 30 m
    // one with its 200 m one, past the cells searched
    expect(objectsOf(nearHouses([tile], 0, 0, 50, 10))).toEqual([
      0, 1, 2, 3, 4,
    ]);
    // three niches: houses 0 and 2 fit, 3 would not
    expect(nearHouses([tile], 0, 0, 50, 3).map((h) => h.root)).toEqual([0, 2]);
    // house 3 lies past the radius from x = −25 …
    expect(nearHouses([tile], -25, 0, 50, 10).map((h) => h.root)).toEqual([
      0, 2,
    ]);
    // … unless it already is one
    tile.houses.add(3);
    // (and ranks as if 20 m nearer: 35 m before house 2's 45 m)
    expect(nearHouses([tile], -25, 0, 50, 10).map((h) => h.root)).toEqual([
      0, 3, 2,
    ]);
    // a demolished object takes its niches with it
    demolished = 1;
    expect(objectsOf(nearHouses([tile], 0, 0, 50, 10))).toEqual([0, 2, 3, 4]);
  });

  test("a niche's frame is right-handed and stands behind its wall", () => {
    for (const [nx, nz] of [
      [1, 0],
      [0, -1],
      [Math.SQRT1_2, Math.SQRT1_2],
    ]) {
      const f = new Float32Array(NICHE_STRIDE);
      f.set([10, 5, -3, nx, nz, 0.6, 0.8, 0.15, 0, 2, 1]);
      const m = new Float32Array(16);
      writeNicheMatrix(m, 0, f, 0, 0.3);
      const cols = [0, 1, 2].map(
        (c) => new Vector3(m[4 * c], m[4 * c + 1], m[4 * c + 2])
      );
      const frame = new Matrix4().makeBasis(cols[0], cols[1], cols[2]);
      expect(frame.determinant()).toBeGreaterThan(0);
      // the box's back (z = −1) lies into the wall, against its normal
      const back = cols[2].clone().multiplyScalar(-1);
      expect(back.x * nx + back.z * nz).toBeLessThan(0);
      expect(m[3]).toBe(2);
      expect(m[7]).toBe(1);
      expect(m[11]).toBeCloseTo(0.3);
    }
  });
});
