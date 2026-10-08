import { describe, expect, test } from "bun:test";
import type { DoorFeature, ShopfrontWall } from "./features";
import {
  CANOPY,
  doorSpans,
  FASCIA_MAX_M,
  fasciaSpans,
  MIN_BAY_M,
  MULLION,
  mullions,
  PANE_TUCK_M,
  PANEL_M,
  paneTop,
  piers,
  SHOPFRONT,
  SHOPFRONT_SINK,
  ROW_SILL_M,
  SHOPFRONT_TOP_M,
  shopfrontJoins,
  shopfrontMesh,
  STOREY_CLEAR_M,
  wallBays,
  wallShiftAt,
} from "./shopfronts";

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

describe("the bays", () => {
  test("only measured bays, clipped inside the wall's end piers", () => {
    expect(wallBays(wall({ bays: [[0, 12]] }), [])).toEqual([
      [SHOPFRONT.pier, 12 - SHOPFRONT.pier],
    ]);
    expect(wallBays(wall({ bays: undefined }), [])).toEqual([]);
  });

  test("mullions divide a bay into equal panels no wider than PANEL_M", () => {
    expect(mullions([1, 1 + PANEL_M])).toEqual([]);
    const ms = mullions([0, 5]);
    // three panels of 5/3 m
    expect(ms).toHaveLength(2);
    expect((ms[0][0] + ms[0][1]) / 2).toBeCloseTo(5 / 3);
    expect(ms[0][1] - ms[0][0]).toBeCloseTo(MULLION.w);
  });

  test("a door is cut out of a bay; a sliver left over is dropped", () => {
    const w = wall({ bays: [[1, 6]] });
    expect(wallBays(w, [[2, 3]])).toEqual([[3, 6]]);
    // 1–1.5 m and 5–6 m are left: both narrower than MIN_BAY_M
    expect(MIN_BAY_M).toBeGreaterThan(1);
    expect(wallBays(w, [[1.5, 5]])).toEqual([]);
  });

  test("doors on the wall's building and line only", () => {
    const door = (x: number, y: number, of = "A"): DoorFeature => ({
      geometry: { type: "Point", coordinates: [x, y] },
      properties: { of, w: 1, h: 2.2, kind: "yes", nx: 0, ny: -1, z: 100 },
    });
    const spans = doorSpans(
      wall(),
      [door(1004, 2000.1), door(1008, 2003), door(1010, 2000, "B")],
      (of) => of === "A"
    );
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBeLessThan(4 - 0.5);
    expect(spans[0][1]).toBeGreaterThan(4 + 0.5);
  });

  test("piers stand at the edges, one fills a narrow gap", () => {
    expect(
      piers(
        [
          [1, 3],
          [3.3, 5],
          [7, 9],
        ],
        12
      )
    ).toEqual([
      [0.75, 1],
      [3, 3.3],
      [5, 5.25],
      [6.75, 7],
      [9, 9.25],
    ]);
  });
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
    const sign = (z0: number) => ({
      at: [[0, 6]] as [number, number][],
      z: [z0, z0 + 0.6] as [number, number],
    });
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

describe("the mesh", () => {
  for (const reversed of [false, true]) {
    test(`every face looks out of the wall (${reversed ? "b → a" : "a → b"})`, () => {
      const w = wall({ sign: { at: [[0.5, 7]], z: [3.2, 3.8] } }, reversed);
      const bays = wallBays(w, []);
      const mesh = shopfrontMesh(w, bays, 4, OFFSET);
      expect(mesh.pane.length).toBeGreaterThan(0);
      for (const { n, c } of triangles([...mesh.pane, ...mesh.frame])) {
        // nothing faces into the wall (+y), nothing lies behind it
        expect(n[1]).toBeLessThanOrEqual(1e-9);
        expect(c[1]).toBeLessThanOrEqual(SHOPFRONT.back + 1e-9);
      }
    });
  }

  test("the pane stands barely proud, from the sill to its top", () => {
    // tucked a little behind the riser and the head, so no crack opens
    const w = wall({ gf_top: 3.2 });
    const mesh = shopfrontMesh(w, wallBays(w, []), 4, OFFSET);
    const ys = new Set<number>();
    const zs: number[] = [];
    for (let i = 0; i < mesh.pane.length; i += 3) {
      ys.add(Math.round(mesh.pane[i + 1] * 1000) / 1000);
      zs.push(mesh.pane[i + 2]);
    }
    expect([...ys]).toEqual([-SHOPFRONT.paneProud]);
    expect(Math.min(...zs)).toBeCloseTo(100 + SHOPFRONT.sill - PANE_TUCK_M);
    expect(Math.max(...zs)).toBeCloseTo(103.2 + PANE_TUCK_M);
    // the frame stands further out, so the glass reads recessed
    const frameYs = triangles(mesh.frame).map(({ c }) => c[1]);
    expect(Math.min(...frameYs)).toBeCloseTo(-SHOPFRONT.frameProud);
  });

  test("no window under a ground floor too low; a sign alone is a fascia", () => {
    const low = wall({ gf_top: 1.6 });
    expect(shopfrontMesh(low, wallBays(low, []), 4, OFFSET)).toEqual({
      canopy: [],
      frame: [],
      pane: [],
    });
    const signed = wall({ bays: [], sign: { at: [[2, 8]], z: [3, 3.6] } });
    const mesh = shopfrontMesh(signed, [], 4, OFFSET);
    expect(mesh.pane).toEqual([]);
    const zs = triangles(mesh.frame).map(({ c }) => c[2]);
    expect(Math.min(...zs)).toBeGreaterThan(102.9);
    // a sign band measured 2 m tall is a board no taller than FASCIA_MAX_M
    const tall = wall({ bays: [], sign: { at: [[2, 8]], z: [3, 5] } });
    const tops = triangles(shopfrontMesh(tall, [], 4, OFFSET).frame).map(
      ({ c }) => c[2]
    );
    expect(Math.max(...tops)).toBeLessThanOrEqual(103 + FASCIA_MAX_M);
  });

  test("a glazed row sits on a lower riser, its panes split by mullions", () => {
    const w = wall({ bays: [[0, 12]], row: true });
    const mesh = shopfrontMesh(w, wallBays(w, []), 4, OFFSET);
    const zs = mesh.pane.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(100 + ROW_SILL_M - PANE_TUCK_M);
    // 11.5 m of glass: six panels, five mullions standing out as far as
    // MULLION.proud, between the riser and the head
    const ys = triangles(mesh.frame).map(({ c }) => c[1]);
    expect(ys.some((y) => Math.abs(y + MULLION.proud) < 1e-6)).toBe(true);
    expect(mullions(wallBays(w, [])[0])).toHaveLength(5);
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
      // the canopy's fascia is the sign band: no board on the wall
      expect(fasciaSpans(w)).toEqual([]);
      const mesh = shopfrontMesh(w, wallBays(w, []), 5, OFFSET);
      const tris = triangles(mesh.canopy);
      expect(tris.length).toBeGreaterThan(0);
      const ys = tris.map(({ c }) => c[1]);
      const zs = tris.map(({ c }) => c[2]);
      // out to its depth (−y), from the wall
      expect(Math.min(...ys)).toBeCloseTo(-4, 1);
      expect(Math.max(...ys)).toBeLessThanOrEqual(CANOPY.tuck + 1e-9);
      // the slab's top at the measured height, the fascia's lip over it,
      // the fascia no deeper than CANOPY.fasciaH
      expect(Math.max(...zs)).toBeCloseTo(104.3 + CANOPY.lip);
      expect(Math.min(...zs)).toBeGreaterThanOrEqual(
        104.3 - CANOPY.fasciaH - 1e-9
      );
      for (const { n } of tris) {
        // nothing faces into the wall
        expect(n[1]).toBeLessThanOrEqual(1e-9);
      }
    });
  }

  test("a low canopy's fascia keeps the headroom", () => {
    const w = wall({ canopy: [{ at: [0, 12], d: 3, h: 3 }], gf_top: 2.2 });
    const zs = triangles(shopfrontMesh(w, [], 4, OFFSET).canopy).map(
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

test("the feet go into the ground along the risers and piers", () => {
  const w = wall({ z: [100, 101] });
  const joins = shopfrontJoins(w, wallBays(w, []));
  expect(joins.length).toBeGreaterThan(4);
  for (const j of joins) {
    expect(j.kind).toBe("foot");
    expect(j.y).toBeCloseTo(2000 - SHOPFRONT.frameProud);
    const ground = 100 + (j.x - 1000) / 12;
    expect(j.z).toBeLessThanOrEqual(ground - SHOPFRONT_SINK + 1e-9);
  }
});
