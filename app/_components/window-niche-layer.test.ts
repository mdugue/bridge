import { describe, expect, test } from "bun:test";
import { NICHE_STRIDE, cellNiches, packNiches } from "@/lib/city/window-niches";
import type { CityLayer } from "./city-layer";
import { Matrix4, Vector3 } from "three";
import {
  nearNiches,
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

  test("the niches near the eye: within the radius, standing, nearest first past capacity", () => {
    const xs = [0, 10, 20, 30, 200];
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
    // object 1 demolished
    const city = {
      stands: (i: number) => i !== 1,
      table: { baseZ },
    } as unknown as CityLayer;
    const tile = {
      city,
      niches,
      cells: cellMap,
      box: [0, 0, 0, 0] as [number, number, number, number],
      cutting: false,
    };
    const all = nearNiches([tile], 0, 0, 80, 10);
    expect(all.covered).toBe(80);
    expect(
      all.picked
        .map((c) => sorted.niches[c.i * NICHE_STRIDE + 8])
        .toSorted((a, b) => a - b)
    ).toEqual([0, 2, 3]);
    const two = nearNiches([tile], 0, 0, 80, 2);
    expect(two.picked.map((c) => c.dist)).toEqual([0, 20]);
    // what it covers ends at the first niche left out
    expect(two.covered).toBe(30);
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
