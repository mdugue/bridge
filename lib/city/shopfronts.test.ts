import { describe, expect, test } from "bun:test";
import type { DoorFeature, ShopfrontWall } from "./features";
import {
  bayRuns,
  CANOPY,
  doorSpans,
  FASCIA_MAX_M,
  fasciaSpans,
  MIN_BAY_M,
  MIN_OPENING_M,
  MIN_WALL_M,
  paneTop,
  QUANTUM_M,
  SHOPFRONT,
  ROW_SILL_M,
  SHOPFRONT_TOP_M,
  shopfrontMesh,
  shopWindowSpans,
  spanSegments,
  STOREY_CLEAR_M,
  wallBays,
  wallShiftAt,
} from "./shopfronts";
import type { ShopfrontMesh } from "./shopfronts";

const OFFSET = { cx: 1000, cy: 2000 };

/** A 12 m wall along +x at y = 2000 (mesh y 0), facing −y (out of a
 *  footprint north of it), the ground at 100 m. `reversed` runs it the
 *  other way (b → a), facing the same side. */
function wall(
  over: Partial<ShopfrontWall> = {},
  reversed = false
): ShopfrontWall {
  const a: [number, number] = [1000, 2000];
  const b: [number, number] = [1012, 2000];
  return {
    oid: "A",
    wi: 0,
    a: reversed ? b : a,
    b: reversed ? a : b,
    L: 12,
    n: [0, -1],
    z: [100, 100],
    src: "photo",
    bays: [
      [1, 3],
      [4, 6],
    ],
    ...over,
  };
}

/** Each triangle's normal (unnormalised) and centroid. */
function triangles(p: number[]): { c: number[]; n: number[] }[] {
  const out = [];
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.slice(i, i + 9);
    const u = [bx - ax, by - ay, bz - az];
    const v = [cx - ax, cy - ay, cz - az];
    out.push({
      n: [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      c: [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3],
    });
  }
  return out;
}

const door = (x: number, y: number, of = "A"): DoorFeature => ({
  geometry: { type: "Point", coordinates: [x, y] },
  properties: { of, w: 1, h: 2.2, kind: "yes", nx: 0, ny: -1, z: 100 },
});

describe("the bays", () => {
  test("only measured bays, clipped inside the wall's end piers", () => {
    expect(wallBays(wall({ bays: [[0, 12]] }), [])).toEqual([
      [SHOPFRONT.pier, 12 - SHOPFRONT.pier],
    ]);
    expect(wallBays(wall({ bays: undefined }), [])).toEqual([]);
  });

  test("a door is cut out of a bay; a sliver left over is dropped", () => {
    const w = wall({ bays: [[1, 6]] });
    expect(wallBays(w, [[2, 3]])).toEqual([[3, 6]]);
    // 1–1.5 m and 5–6 m are left: both narrower than MIN_BAY_M
    expect(MIN_BAY_M).toBeGreaterThan(1);
    expect(wallBays(w, [[1.5, 5]])).toEqual([]);
  });

  test("doors on the wall's building and line only", () => {
    const spans = doorSpans(
      wall(),
      [door(1004, 2000.1), door(1008, 2003), door(1010, 2000, "B")],
      (of) => of === "A"
    );
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBeLessThan(4 - 0.5);
    expect(spans[0][1]).toBeGreaterThan(4 + 0.5);
  });

  test("bays close together keep a pier between them", () => {
    const runs = bayRuns(
      [
        [1, 3],
        [3.05, 5],
        [5.4, 6.5],
        [8, 9],
      ],
      12
    );
    // the first three run together, the last stands apart
    expect(runs.map((r) => r.bays.length)).toEqual([3, 1]);
    const [first, second] = runs;
    // a gap narrower than minPier is widened around its middle
    expect(first.bays[1][0] - first.bays[0][1]).toBeCloseTo(SHOPFRONT.minPier);
    expect((first.bays[1][0] + first.bays[0][1]) / 2).toBeCloseTo(3.025);
    expect(first.span).toEqual([1 - SHOPFRONT.pier, 6.5 + SHOPFRONT.pier]);
    // and two runs keep MIN_WALL_M of wall between them
    expect(second.span[0] - first.span[1]).toBeGreaterThanOrEqual(MIN_WALL_M);
  });
});

const sign = (z0: number) => ({
  at: [[0, 6]] as [number, number][],
  z: [z0, z0 + 0.6] as [number, number],
});

describe("the pane's top", () => {
  test("the measured top, under the first storey line", () => {
    expect(paneTop(wall({ gf_top: 3.4 }), 4)).toBe(3.4);
    expect(paneTop(wall({ gf_top: 3.9 }), 3.8)).toBeCloseTo(
      3.8 - STOREY_CLEAR_M
    );
    expect(paneTop(wall(), 4)).toBe(SHOPFRONT_TOP_M);
  });

  test("under a sign, unless the sign hangs too low for a window", () => {
    expect(paneTop(wall({ sign: sign(2.9) }), 4)).toBeCloseTo(
      2.9 - SHOPFRONT.head
    );
    expect(paneTop(wall({ sign: sign(1.7) }), 4)).toBe(SHOPFRONT_TOP_M);
  });

  test("under a canopy's slab, its head included", () => {
    const w = wall({ canopy: [{ at: [0, 12], d: 4, h: 3.3 }] });
    expect(paneTop(w, 5)).toBeCloseTo(3.3 - CANOPY.slab - SHOPFRONT.head);
  });
});

/** Every triangle of a mesh's parts, each with its part's name. */
function parts(mesh: ShopfrontMesh): { part: string; p: number[] }[] {
  const out: { part: string; p: number[] }[] = [];
  const add = (part: string, positions: number[]) => {
    for (let i = 0; i < positions.length; i += 9) {
      out.push({ part, p: positions.slice(i, i + 9) });
    }
  };
  add("canopy", mesh.canopy.positions);
  return out;
}

const unit = (v: number[]) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

/** The triangles of `tris` that lie on one another: coplanar (within
 *  5 mm) and overlapping in more than an edge. */
function overlaps(tris: { p: number[] }[]): [number, number][] {
  const geo = tris.map(({ p }) => {
    const [n] = triangles(p);
    return { n: unit(n.n), c: n.c, p };
  });
  const out: [number, number][] = [];
  for (let i = 0; i < geo.length; i += 1) {
    for (let j = i + 1; j < geo.length; j += 1) {
      const a = geo[i];
      const b = geo[j];
      const d = a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2];
      if (Math.abs(d) < 0.999) {
        continue;
      }
      const off = (k: number) =>
        Math.abs(
          a.n[0] * (b.p[k] - a.p[0]) +
            a.n[1] * (b.p[k + 1] - a.p[1]) +
            a.n[2] * (b.p[k + 2] - a.p[2])
        );
      if (off(0) > 0.005 || off(3) > 0.005 || off(6) > 0.005) {
        continue;
      }
      if (overlap2d(a, b)) {
        out.push([i, j]);
      }
    }
  }
  return out;
}

/** Whether two coplanar triangles overlap in more than an edge (SAT in
 *  their plane). */
function overlap2d(
  a: { n: number[]; p: number[] },
  b: { p: number[] }
): boolean {
  const u = unit(
    Math.abs(a.n[2]) < 0.9
      ? [a.n[1], -a.n[0], 0]
      : [1, 0, 0].map((x, k) => x - a.n[0] * a.n[k])
  );
  const v = [
    a.n[1] * u[2] - a.n[2] * u[1],
    a.n[2] * u[0] - a.n[0] * u[2],
    a.n[0] * u[1] - a.n[1] * u[0],
  ];
  const flat = (p: number[]) =>
    [0, 3, 6].map((k) => [
      p[k] * u[0] + p[k + 1] * u[1] + p[k + 2] * u[2],
      p[k] * v[0] + p[k + 1] * v[1] + p[k + 2] * v[2],
    ]);
  const ta = flat(a.p);
  const tb = flat(b.p);
  for (const t of [ta, tb]) {
    for (let k = 0; k < 3; k += 1) {
      const [x0, y0] = t[k];
      const [x1, y1] = t[(k + 1) % 3];
      const ax = [y1 - y0, x0 - x1];
      const proj = (q: number[][]) => q.map(([x, y]) => x * ax[0] + y * ax[1]);
      const pa = proj(ta);
      const pb = proj(tb);
      const eps = 1e-6 * Math.hypot(...ax);
      if (
        Math.max(...pa) <= Math.min(...pb) + eps ||
        Math.max(...pb) <= Math.min(...pa) + eps
      ) {
        return false;
      }
    }
  }
  return true;
}

/** A wall with everything on it: bays close together and apart, a sign. */
const busy = (reversed = false) =>
  wall(
    {
      bays: [
        [1, 3],
        [3.05, 5],
        [6.2, 8],
      ],
      sign: { at: [[0.5, 9]], z: [3.2, 3.8] },
    },
    reversed
  );
/** A glazed row under a canopy. */
const sheltered = (reversed = false) =>
  wall(
    { bays: [[0, 12]], row: true, canopy: [{ at: [0, 12], d: 4, h: 4.3 }] },
    reversed
  );

const flat = (p: number[]) => [p[0], 0, p[2], p[3], 0, p[5], p[6], 0, p[8]];

describe("the mesh", () => {
  for (const reversed of [false, true]) {
    test(`every face looks out of the wall, wound as it is shaded (${reversed ? "b → a" : "a → b"})`, () => {
      for (const w of [busy(reversed), sheltered(reversed)]) {
        const mesh = shopfrontMesh(w, wallBays(w, []), 5, OFFSET);
        expect(mesh.openings.length).toBeGreaterThan(0);
        for (const { part, p } of parts(mesh)) {
          const [{ n, c }] = triangles(p);
          // nothing lies behind the wall, nothing faces into it (+y) — but
          // the canopy fascia's inner face, under the slab's edge
          expect(c[1]).toBeLessThanOrEqual(SHOPFRONT.back + 1e-9);
          if (part !== "canopy" || c[1] > -(4 - CANOPY.fasciaD) + 1e-6) {
            expect(n[1]).toBeLessThanOrEqual(1e-9);
          }
        }
        // the per-vertex normals agree with the winding
        for (const s of [mesh.canopy]) {
          expect(s.normals).toHaveLength(s.positions.length);
          for (const [t, { n }] of triangles(s.positions).entries()) {
            const m = [0, 1, 2].map(
              (k) =>
                s.normals[9 * t + k] +
                s.normals[9 * t + 3 + k] +
                s.normals[9 * t + 6 + k]
            );
            expect(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]).toBeGreaterThan(0);
          }
        }
      }
    });
  }

  test("a window per bay, from the sill to the pane's top", () => {
    const w = wall({
      gf_top: 3.2,
      bays: [
        [1, 3],
        [3.6, 6],
      ],
    });
    const mesh = shopfrontMesh(w, wallBays(w, []), 4, OFFSET, () => 0.1);
    expect(mesh.openings).toEqual([
      {
        rect: { s0: 1, s1: 3, z0: 100 + SHOPFRONT.sill, z1: 103.2 },
        shift: 0.1,
      },
      {
        rect: { s0: 3.6, s1: 6, z0: 100 + SHOPFRONT.sill, z1: 103.2 },
        shift: 0.1,
      },
    ]);
    // no surround, and no sign measured here: nothing on the wall
    expect(mesh.signs).toEqual([]);
  });

  test("the plinth breaks where a window is cut, nowhere else", () => {
    const w = wall({
      bays: [
        [1, 3],
        [5, 6],
      ],
      gf_top: 3,
    });
    // the second bay is narrower than MIN_BAY_M: no window, no break
    const spans = shopWindowSpans(w, wallBays(w, []), 4);
    expect(spans).toEqual([[1, 3]]);
    expect(spanSegments(w, spans)).toEqual([
      [
        [1001, 2000],
        [1003, 2000],
      ],
    ]);
    // a ground floor too low for a window: none
    const low = wall({ gf_top: 1.6 });
    expect(shopWindowSpans(low, wallBays(low, []), 4)).toEqual([]);
    expect(MIN_OPENING_M).toBeGreaterThan(1);
  });

  test("under a canopy the window ends under its slab, a head below it", () => {
    const w = wall({ canopy: [{ at: [0, 12], d: 4, h: 4.3 }], gf_top: 4 });
    const mesh = shopfrontMesh(w, wallBays(w, []), 5, OFFSET);
    for (const o of mesh.openings) {
      expect(o.rect.z1).toBeCloseTo(104.3 - CANOPY.slab - SHOPFRONT.head);
    }
  });

  test("nothing lies along the wall closer than two quanta to it", () => {
    for (const w of [
      busy(),
      sheltered(),
      wall({ bays: [], sign: { at: [[2, 8]], z: [3, 3.6] } }),
    ]) {
      for (const { p } of parts(shopfrontMesh(w, wallBays(w, []), 5, OFFSET))) {
        const [{ n, c }] = triangles(p);
        if (Math.abs(unit(n)[1]) > 0.99) {
          // a face along the wall stands clear of it (out is −y)
          expect(-c[1]).toBeGreaterThan(1.7 * QUANTUM_M);
        }
      }
    }
  });

  test("no two faces lie on one another; faces along the wall overlap only two quanta apart", () => {
    for (const w of [busy(), busy(true), sheltered()]) {
      const tris = parts(shopfrontMesh(w, wallBays(w, []), 5, OFFSET));
      const ov = overlaps(tris);
      expect(ov).toEqual([]);
      // where faces along the wall cover one another, they stand apart by
      // more than the glTF's quantisation can move them
      const along = tris
        .map(({ p }) => ({ p, t: triangles(p)[0] }))
        .filter(({ t }) => Math.abs(unit(t.n)[1]) > 0.99);
      for (let i = 0; i < along.length; i += 1) {
        for (let j = i + 1; j < along.length; j += 1) {
          const gap = Math.abs(along[i].t.c[1] - along[j].t.c[1]);
          if (gap < 0.005) {
            continue;
          }
          if (
            overlap2d(
              { n: [0, 1, 0], p: flat(along[i].p) },
              { p: flat(along[j].p) }
            )
          ) {
            expect(gap).toBeGreaterThan(1.4 * QUANTUM_M);
          }
        }
      }
    }
  });

  test("no window under a ground floor too low; a sign alone is painted", () => {
    const low = wall({ gf_top: 1.6 });
    const none = shopfrontMesh(low, wallBays(low, []), 4, OFFSET);
    expect(none.openings).toEqual([]);
    expect(none.signs).toEqual([]);
    const signed = wall({ bays: [], sign: { at: [[2, 8]], z: [3, 3.6] } });
    const mesh = shopfrontMesh(signed, [], 4, OFFSET);
    expect(mesh.openings).toEqual([]);
    // painted where it was seen, at its measured band
    expect(mesh.signs).toHaveLength(1);
    const [band] = mesh.signs;
    expect([band.rect.s0, band.rect.s1]).toEqual([2, 8]);
    expect(band.rect.z0).toBeCloseTo(103);
    expect(band.rect.z1).toBeCloseTo(103.6);
    // a sign band measured 2 m tall is a band no taller than FASCIA_MAX_M
    const tall = wall({ bays: [], sign: { at: [[2, 8]], z: [3, 5] } });
    const [high] = shopfrontMesh(tall, [], 4, OFFSET).signs;
    expect(high.rect.z1 - high.rect.z0).toBeLessThanOrEqual(
      FASCIA_MAX_M + 1e-9
    );
  });

  test("a glazed row sits on a lower riser, one wide window", () => {
    const w = wall({ bays: [[0, 12]], row: true });
    const mesh = shopfrontMesh(w, wallBays(w, []), 4, OFFSET);
    expect(mesh.openings).toHaveLength(1);
    expect(mesh.openings[0].rect.z0).toBeCloseTo(100 + ROW_SILL_M);
  });

  for (const reversed of [false, true]) {
    test(`a canopy: a slab out to its fascia, at the measured top (${reversed ? "b → a" : "a → b"})`, () => {
      const w = wall(
        {
          canopy: [{ at: [0, 12], d: 4, h: 4.3 }],
          sign: { at: [[1, 5]], z: [3.4, 4.2] },
        },
        reversed
      );
      // the canopy's fascia is the sign band: no band on the wall
      expect(fasciaSpans(w)).toEqual([]);
      const mesh = shopfrontMesh(w, wallBays(w, []), 5, OFFSET);
      const tris = triangles(mesh.canopy.positions);
      expect(tris.length).toBeGreaterThan(0);
      const ys = tris.map(({ c }) => c[1]);
      const zs = tris.map(({ c }) => c[2]);
      // out to its depth (−y), from inside the wall
      expect(Math.min(...ys)).toBeCloseTo(-4, 1);
      expect(Math.max(...ys)).toBeLessThanOrEqual(SHOPFRONT.back + 1e-9);
      // its top at the measured height, the fascia no deeper than fasciaH
      expect(Math.max(...zs)).toBeLessThanOrEqual(104.3 + 1e-9);
      expect(Math.max(...zs)).toBeGreaterThan(104.2);
      expect(Math.min(...zs)).toBeGreaterThanOrEqual(
        104.3 - CANOPY.fasciaH - 1e-9
      );
      // its outer edges rounded: normals between down/out and out/up
      const { normals } = mesh.canopy;
      let soft = 0;
      for (let i = 0; i < normals.length; i += 3) {
        const out = -normals[i + 1];
        if (out > 0.3 && out < 0.95 && Math.abs(normals[i + 2]) > 0.3) {
          soft += 1;
        }
      }
      expect(soft).toBeGreaterThan(0);
    });
  }

  test("a low canopy's fascia keeps the headroom", () => {
    const w = wall({ canopy: [{ at: [0, 12], d: 3, h: 3 }], gf_top: 2.2 });
    const zs = triangles(shopfrontMesh(w, [], 4, OFFSET).canopy.positions).map(
      ({ c }) => c[2]
    );
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(
      100 + CANOPY.headroom - 1e-9
    );
  });

  test("laid onto the wall where it stands off the footprint line", () => {
    // the LoD2 wall 0.1 m out of the line (y = −0.1), facing −y
    const positions = [0, -0.1, 90, 12, -0.1, 90, 0, -0.1, 110];
    const shift = wallShiftAt(wall(), [1, 3], OFFSET, positions, [0]);
    expect(shift).toBeCloseTo(0.1);
    // a triangle facing into the building is no wall
    const back = [0, -0.1, 90, 0, -0.1, 110, 12, -0.1, 90];
    expect(wallShiftAt(wall(), [1, 3], OFFSET, back, [0])).toBe(0);
  });
});
