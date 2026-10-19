import { describe, expect, test } from "bun:test";

import { creaseNormals } from "./crease-normals";

/** A vertical wall strip of `sides` facets round a ring of radius 10, the
 *  facets from angle 0 to `arc` (degrees), each two triangles, 5 m tall. */
function ring(sides: number, arc: number): Float32Array {
  const out: number[] = [];
  const at = (i: number) => {
    const a = ((arc / sides) * i * Math.PI) / 180;
    return [10 * Math.cos(a), 10 * Math.sin(a)];
  };
  for (let i = 0; i < sides; i++) {
    const [ax, ay] = at(i);
    const [bx, by] = at(i + 1);
    out.push(ax, ay, 0, bx, by, 0, bx, by, 5);
    out.push(ax, ay, 0, bx, by, 5, ax, ay, 5);
  }
  return Float32Array.from(out);
}

/** The normal of vertex `v` as an angle in the ground plane (degrees). */
const heading = (n: Float32Array, v: number) =>
  (Math.atan2(n[3 * v + 1], n[3 * v]) * 180) / Math.PI;

describe("creaseNormals", () => {
  test("rounds a curve drawn as facets: the shared edge's normal is the mean", () => {
    // two facets turned 20° apart; their shared edge lies at 20°
    const p = ring(2, 40);
    const n = creaseNormals(p, new Float64Array(p.length / 3));
    // vertex 1 is facet 0's corner on the shared edge, 6 facet 1's start
    expect(heading(n, 1)).toBeCloseTo(heading(n, 6), 4);
    expect(heading(n, 1)).toBeCloseTo(20, 1);
    // the strip's free ends keep their facet's own normal
    expect(heading(n, 0)).toBeCloseTo(10, 1);
  });

  test("keeps a corner crisp", () => {
    // two facets of an octagon turn 45° apart
    const p = ring(2, 90);
    const n = creaseNormals(p, new Float64Array(p.length / 3));
    expect(heading(n, 1)).toBeCloseTo(22.5, 1);
    expect(heading(n, 6)).toBeCloseTo(67.5, 1);
  });

  test("never blends two groups or a skipped triangle", () => {
    const p = ring(2, 40);
    const groups = new Float64Array(p.length / 3);
    groups.fill(1, 6);
    expect(heading(creaseNormals(p, groups), 1)).toBeCloseTo(10, 1);
    const skipped = creaseNormals(p, new Float64Array(p.length / 3), {
      skip: (t) => t >= 2,
    });
    expect(heading(skipped, 1)).toBeCloseTo(10, 1);
  });

  test("weighs a facet by its angle, not by how it was cut", () => {
    // facet 0 cut into three triangles, facet 1 into two
    const p = ring(2, 40);
    const [ax, ay] = [p[0], p[1]];
    const [bx, by] = [p[3], p[4]];
    const mid = [(ax + bx) / 2, (ay + by) / 2, 5];
    const cut = Float32Array.from([
      ax,
      ay,
      0,
      bx,
      by,
      0,
      ...mid,
      bx,
      by,
      0,
      bx,
      by,
      5,
      ...mid,
      ax,
      ay,
      0,
      ...mid,
      ax,
      ay,
      5,
      ...p.slice(18, 36),
    ]);
    const n = creaseNormals(cut, new Float64Array(cut.length / 3));
    // at the shared bottom corner both facets span 90°: the mean is 20°
    expect(heading(n, 1)).toBeCloseTo(20, 1);
    expect(heading(n, 9)).toBeCloseTo(20, 1);
  });

  test("keeps a plain wall's slight kink", () => {
    // the same 20° turn on a ring of radius 50: facets 17 m wide
    const p = ring(2, 40).map((c, i) => (i % 3 === 2 ? c : 5 * c));
    const n = creaseNormals(p, new Float64Array(p.length / 3));
    expect(heading(n, 1)).toBeCloseTo(10, 1);
  });

  test("keeps a low gable's ridge", () => {
    // two roof planes pitched 12° to either side of a ridge along y
    const s = Math.tan((12 * Math.PI) / 180) * 3;
    const p = Float32Array.from([
      -3,
      0,
      0,
      0,
      0,
      s,
      0,
      4,
      s,
      0,
      0,
      s,
      3,
      0,
      0,
      3,
      4,
      0,
    ]);
    const n = creaseNormals(p, new Float64Array(6));
    // vertex 1 (ridge, left plane) keeps the left plane's lean
    expect(n[3]).toBeLessThan(-0.2);
  });

  test("takes −0 and +0 for one point", () => {
    // the strip moved so the shared bottom corner lies on x = 0, signed apart
    const ring2 = ring(2, 40);
    const x0 = ring2[3];
    const p = ring2.map((c, i) => (i % 3 === 0 ? c - x0 : c));
    p[3] = 0;
    p[18] = -0;
    const n = creaseNormals(p, new Float64Array(p.length / 3));
    expect(heading(n, 1)).toBeCloseTo(20, 1);
    expect(heading(n, 6)).toBeCloseTo(20, 1);
  });
});
