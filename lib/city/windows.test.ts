import { describe, expect, test } from "bun:test";
import { ShapeUtils, Vector2 } from "three";
import { QUANTUM_M } from "./shopfronts";
import {
  axes,
  cutFace,
  cutOf,
  type FacadeModel,
  FASCHE,
  fitsFace,
  footprintOf,
  NICHE,
  nicheMesh,
  bandMeshes,
  ROWS,
  rows,
  wallFaces,
  type WindowMesh,
  windowLayout,
  type WindowWall,
} from "./windows";

/** THREE's earcut as the bake passes it (scripts/bake-city-mesh.ts). */
const triangulate = (data: number[], holes: number[]): number[] => {
  const pts: Vector2[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    pts.push(new Vector2(data[i], data[i + 1]));
  }
  const cuts = [...holes, pts.length];
  const rings = holes.map((start, i) => pts.slice(start, cuts[i + 1]));
  return ShapeUtils.triangulateShape(pts.slice(0, cuts[0]), rings).flat();
};

const model = (extra: Partial<FacadeModel> = {}): FacadeModel => ({
  axis: 3,
  grid: "regular",
  h: 1.6,
  w: 1.2,
  ...extra,
});

describe("axes", () => {
  test("centred on the wall at the measured spacing", () => {
    const xs = axes(14, model(), "k");
    expect(xs.length).toBe(4);
    expect((xs[0] + xs.at(-1)!) / 2).toBeCloseTo(7, 9);
    expect(xs[1] - xs[0]).toBeCloseTo(3, 9);
    // the outer windows keep the wall's edge
    expect(xs[0] - 0.6).toBeGreaterThanOrEqual(ROWS.edge - 1e-9);
  });

  test("a loose grid is off a little, the same every bake, never crowded", () => {
    const a = axes(14, model({ grid: "loose" }), "x/1");
    expect(a).toEqual(axes(14, model({ grid: "loose" }), "x/1"));
    expect(a).not.toEqual(axes(14, model(), "x/1"));
    for (let k = 1; k < a.length; k++) {
      expect(a[k] - a[k - 1] - 1.2).toBeGreaterThanOrEqual(ROWS.gap - 1e-9);
    }
  });

  test("no window on a wall too short for one, or an axis narrower than it", () => {
    expect(axes(2, model(), "k")).toEqual([]);
    expect(axes(14, model({ axis: 1.3 }), "k")).toEqual([]);
  });
});

test("rows: one per storey over the first line, under the eave, under its lintel", () => {
  const r = rows(4, 3.2, 2.5, 14);
  // the window is cut to the storey: 3.2 − sill − lintel
  for (const [z0, z1] of r) {
    expect(z1 - z0).toBeCloseTo(3.2 - ROWS.sill - ROWS.lintel, 9);
  }
  expect(r.length).toBe(3);
  r.forEach(([z0], k) => expect(z0).toBeCloseTo(4.9 + 3.2 * k, 9));
  expect(r.at(-1)?.[1]).toBeLessThanOrEqual(14);
  // a storey too low for a window under its lintel has none
  expect(rows(4, 1.8, 1.6, 30)).toEqual([]);
});

test("the layout starts over the ground floor, or over a shopfront", () => {
  const w = {
    L: 14,
    eave: 15,
    oid: "o",
    wi: 0,
    z: [100, 100] as [number, number],
  };
  const host = { baseZ: 100, eaveH: 15, storeyH: 3.5 };
  const wins = windowLayout(w, model(), host);
  expect(Math.min(...wins.map((r) => r.z0))).toBeCloseTo(103.5 + ROWS.sill, 9);
  expect(Math.max(...wins.map((r) => r.z1))).toBeLessThanOrEqual(
    115 - ROWS.eaveClear
  );
  // a shop reaching 5 m up: the first row a storey higher
  const over = windowLayout(w, model(), host, 105);
  expect(Math.min(...over.map((r) => r.z0))).toBeCloseTo(
    103.5 + 3.5 + ROWS.sill,
    9
  );
});

/** A wall 14 m long and 15 m high along x (y = 0), facing −y, as two
 *  triangles, and a second face (another wall) beside it. */
function wallMesh(): { positions: number[]; wall: WindowWall } {
  const q = (a: number[], b: number[], c: number[], d: number[]) => [
    ...a,
    ...b,
    ...c,
    ...a,
    ...c,
    ...d,
  ];
  // counter-clockwise seen from −y: x right, z up
  const front = q([0, 0, 100], [14, 0, 100], [14, 0, 115], [0, 0, 115]);
  // the side wall at x = 14, facing +x
  const side = q([14, 0, 100], [14, 10, 100], [14, 10, 115], [14, 0, 115]);
  return {
    positions: [...front, ...side],
    wall: {
      a: [0, 0],
      b: [14, 0],
      eave: 15,
      imgs: 4,
      L: 14,
      n: [0, -1],
      oid: "o",
      seqs: 2,
      traits: {},
      wi: 0,
      z: [100, 100],
    },
  };
}

describe("cutting the wall", () => {
  const offset = { cx: 0, cy: 0 };

  test("the wall's face is found, in its plane, with its outline", () => {
    const { positions, wall } = wallMesh();
    const faces = wallFaces(wall, offset, positions, [0, 3, 6, 9]);
    expect(faces.length).toBe(1);
    expect(faces[0].triangles).toEqual([0, 3]);
    expect(faces[0].area).toBeCloseTo(14 * 15, 6);
    expect(faces[0].loops.length).toBe(1);
    expect(faces[0].loops[0].pts.length).toBe(4);
  });

  test("holes are cut from the outline's own vertices, facing out, area kept", () => {
    const { positions, wall } = wallMesh();
    const [face] = wallFaces(wall, offset, positions, [0, 3]);
    const m = model();
    const wins = windowLayout(wall, m, { baseZ: 100, eaveH: 15, storeyH: 3.5 });
    const fit = wins.filter((r) => fitsFace(face, footprintOf(r, m), 0.12));
    expect(fit.length).toBe(wins.length);
    const cut = cutFace(
      face,
      fit.map((r) => cutOf(r, m)),
      positions,
      triangulate
    );
    expect(cut).toBeDefined();
    const tris = cut ?? [];
    let area = 0;
    for (let i = 0; i < tris.length; i += 9) {
      const e1 = [
        tris[i + 3] - tris[i],
        tris[i + 4] - tris[i + 1],
        tris[i + 5] - tris[i + 2],
      ];
      const e2 = [
        tris[i + 6] - tris[i],
        tris[i + 7] - tris[i + 1],
        tris[i + 8] - tris[i + 2],
      ];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      // every piece faces −y, out of the wall
      expect(ny).toBeLessThan(0);
      area += Math.abs(ny) / 2;
      // and lies in the wall's plane
      for (let k = 1; k < 9; k += 3) {
        expect(Math.abs(tris[i + k])).toBeLessThan(1e-9);
      }
    }
    const holes = fit
      .map((r) => cutOf(r, m))
      .reduce((s, r) => s + (r.s1 - r.s0) * (r.z1 - r.z0), 0);
    expect(area).toBeCloseTo(14 * 15 - holes, 6);
    // the outline keeps its four corners, nothing on its edges
    const onEdge = [];
    for (let i = 0; i < tris.length; i += 3) {
      const [x, , z] = [tris[i], tris[i + 1], tris[i + 2]];
      const corner = (x === 0 || x === 14) && (z === 100 || z === 115);
      const edge = x === 0 || x === 14 || z === 100 || z === 115;
      if (edge && !corner) {
        onEdge.push([x, z]);
      }
    }
    expect(onEdge).toEqual([]);
  });

  test("a window that does not fit inside the face is not cut", () => {
    const { positions, wall } = wallMesh();
    const [face] = wallFaces(wall, offset, positions, [0, 3]);
    expect(fitsFace(face, { s0: 13.5, s1: 14.5, z0: 105, z1: 106 }, 0.12)).toBe(
      false
    );
    expect(fitsFace(face, { s0: 2, s1: 3, z0: 114.95, z1: 116 }, 0.12)).toBe(
      false
    );
    expect(fitsFace(face, { s0: 2, s1: 3, z0: 105, z1: 106 }, 0.12)).toBe(true);
  });
});

describe("the niche", () => {
  const { wall, positions } = wallMesh();
  const [face] = wallFaces(wall, { cx: 0, cy: 0 }, positions, [0, 3]);
  const r = { s0: 2, s1: 3.2, z0: 105, z1: 106.6 };
  const mesh = (m: FacadeModel): WindowMesh => {
    const out: WindowMesh = {
      backs: { normals: [], positions: [] },
      bands: { normals: [], positions: [] },
      reveals: { normals: [], positions: [] },
    };
    nicheMesh(out, face.frame, r, m);
    bandMeshes(out, face.frame, [r], m, [0.2, 13.8]);
    return out;
  };
  /** y of every vertex: the wall lies at 0, out of it is −y. */
  const outs = (p: number[]) => p.filter((_, i) => i % 3 === 1).map((y) => -y);

  test("its back lies behind the wall, the lip rolls from the wall's plane", () => {
    const m = mesh(model());
    expect(m.bands.positions).toEqual([]);
    for (const o of outs(m.backs.positions)) {
      expect(o).toBeCloseTo(-NICHE.depth, 9);
    }
    const reveal = outs(m.reveals.positions);
    expect(Math.max(...reveal)).toBeCloseTo(0, 9);
    expect(Math.min(...reveal)).toBeCloseTo(-NICHE.depth, 9);
    // smooth: the lip's normals turn between the wall's and the reveal's
    const n = m.reveals.normals;
    expect(n.some((v, i) => i % 3 === 1 && v < -0.2 && v > -0.95)).toBe(true);
  });

  test("whatever lies along the wall keeps two quanta off it", () => {
    for (const m of [
      model(),
      model({ frame: true, sill: true, lisene: true, orn: true }),
    ]) {
      const all = mesh(m);
      for (const part of [all.backs, all.bands, all.reveals]) {
        for (let i = 0; i < part.positions.length; i += 9) {
          const ys = [
            part.positions[i + 1],
            part.positions[i + 4],
            part.positions[i + 7],
          ];
          // a face parallel to the wall: all three at one depth
          if (
            Math.max(...ys) - Math.min(...ys) < 1e-9 &&
            Math.abs(ys[0]) > 1e-9
          ) {
            expect(Math.abs(ys[0])).toBeGreaterThanOrEqual(2 * QUANTUM_M);
          }
        }
      }
    }
  });

  test("a Fasche stands out round the window and rolls into the reveal", () => {
    const m = mesh(model({ frame: true }));
    const front = outs(m.bands.positions);
    expect(Math.max(...front)).toBeCloseTo(FASCHE.proud, 9);
    // the opening it frames is the window, without a lip
    expect(cutOf(r, model({ frame: true }))).toEqual(r);
  });
});
