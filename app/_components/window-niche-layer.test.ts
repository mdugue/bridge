import { describe, expect, test } from "bun:test";
import { NICHE_STRIDE, cellNiches } from "@/lib/city/window-niches";
import type { CityLayer } from "./city-layer";
import { nearNiches, nicheGeometry } from "./window-niche-layer";

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
      expect(face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2]).toBeGreaterThan(0);
      // … which points into the box (its middle at z = −0.5) or out of its front
      const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const toCentre = [-mid[0], -mid[1], -0.5 - mid[2]];
      expect(
        toCentre[0] * normal[0] + toCentre[1] * normal[1] + toCentre[2] * normal[2]
      ).toBeGreaterThan(0);
    }
  });

  test("the niches near the eye: within the radius, standing, nearest first past capacity", () => {
    const xs = [0, 10, 20, 30, 200];
    const raw = new Float32Array(xs.length * NICHE_STRIDE);
    xs.forEach((x, i) => {
      raw[i * NICHE_STRIDE] = x;
      raw[i * NICHE_STRIDE + 8] = i;
    });
    const { niches, cells } = cellNiches(raw);
    const cellMap = new Map<number, [number, number]>();
    for (let i = 0; i < cells.length; i += 3) {
      cellMap.set(cells[i], [cells[i + 1], cells[i + 2]]);
    }
    // object 1 demolished
    const city = { stands: (i: number) => i !== 1 } as unknown as CityLayer;
    const tile = { city, niches, cells: cellMap };
    const all = nearNiches([tile], 0, 0, 80, 10);
    expect(all.covered).toBe(80);
    expect(all.picked.map((c) => niches[c.i * NICHE_STRIDE + 8]).toSorted()).toEqual([0, 2, 3]);
    const two = nearNiches([tile], 0, 0, 80, 2);
    expect(two.picked.map((c) => c.dist)).toEqual([0, 20]);
    // what it covers ends at the first niche left out
    expect(two.covered).toBe(30);
  });
});
