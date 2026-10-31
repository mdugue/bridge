import { describe, expect, test } from "bun:test";
import { chimneyMesh, dormerMesh, DORMER_SINK, MIN_FRONT } from "./dormers";
import type { DormerFeature } from "./features";

/** A dormer on a 45° roof falling towards +x, its roof at z 20 there;
 *  a shed one with its roof's fall `tf`. */
const dormer = (ax = 1, ay = 0, tf?: number): DormerFeature => ({
  geometry: { type: "Point", coordinates: [100, 200] },
  properties: {
    of: "a",
    ax,
    ay,
    w: 2,
    d: 2,
    z: 20,
    top: 21.5,
    slope: 45,
    ...(tf === undefined ? {} : { tf }),
  },
});
const offset = { cx: 0, cy: 0 };

const unitNormals = (tris: number[]) => {
  const out: number[][] = [];
  for (let i = 0; i < tris.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = tris.slice(i, i + 9);
    const u = [bx - ax, by - ay, bz - az];
    const v = [cx - ax, cy - ay, cz - az];
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const l = Math.hypot(...n);
    out.push(n.map((c) => c / l));
  }
  return out;
};

const faceNormals = (tris: number[]) =>
  unitNormals(tris).map((n) => n.map((c) => Math.round(c) + 0));

describe("dormerMesh", () => {
  test("a front down the slope, two cheeks across it, a roof up", () => {
    const { positions, isRoof } = dormerMesh(dormer(), offset);
    const normals = faceNormals(positions);
    const roofs = normals.filter((_, i) => isRoof[3 * i] === 1);
    const walls = normals.filter((_, i) => isRoof[3 * i] === 0);
    expect(roofs).toEqual([
      [0, 0, 1],
      [0, 0, 1],
    ]);
    expect(walls).toContainEqual([1, 0, 0]);
    expect(walls).toContainEqual([0, 1, 0]);
    expect(walls).toContainEqual([0, -1, 0]);
    expect(walls).not.toContainEqual([-1, 0, 0]);
  });

  test("its front stands in the roof, its top at the measured top", () => {
    const { positions, base } = dormerMesh(dormer(), offset);
    const zs = positions.filter((_, i) => i % 3 === 2);
    // the front at d/2 downslope: the roof there is 1 m lower
    expect(base).toBeCloseTo(19 - DORMER_SINK, 6);
    expect(Math.min(...zs)).toBeCloseTo(base, 6);
    expect(Math.max(...zs)).toBeCloseTo(21.5, 6);
  });

  test("its roof runs back until the main roof reaches it", () => {
    const { positions } = dormerMesh(dormer(), offset);
    const xs = positions.filter((_, i) => i % 3 === 0);
    // 1.5 m over the roof at 45°: 1.5 m upslope of the centre, and the tuck
    expect(Math.min(...xs)).toBeCloseTo(100 - 1.5 - 0.3, 6);
  });

  test("turns with the slope", () => {
    const { positions, isRoof } = dormerMesh(dormer(0, -1), offset);
    const walls = faceNormals(positions).filter((_, i) => isRoof[3 * i] === 0);
    expect(walls).toContainEqual([0, -1, 0]);
    expect(walls).not.toContainEqual([0, 1, 0]);
  });

  test("a shed dormer's roof falls from the top line to its front", () => {
    const flat = dormerMesh(dormer(), offset);
    const shed = dormerMesh(dormer(1, 0, 20), offset);
    const tan20 = Math.tan((20 * Math.PI) / 180);
    // the same back line (1.5 m upslope) and foot, its front lower
    const xs = shed.positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(100 - 1.5 - 0.3, 6);
    expect(shed.base).toBeCloseTo(flat.base, 6);
    const front = (q: { positions: number[]; isRoof: number[] }) =>
      Math.max(
        ...q.positions.filter(
          (v, i) =>
            i % 3 === 2 &&
            q.isRoof[(i - 2) / 3] === 0 &&
            q.positions[i - 2] === 101
        )
      );
    expect(front(flat)).toBeCloseTo(21.5, 6);
    // 2.5 m from the back line at b = −1.5 to the front at b = 1
    expect(front(shed)).toBeCloseTo(21.5 - 2.5 * tan20, 6);
    // its roof faces up and down the slope, at the measured fall
    const roof = unitNormals(shed.positions).filter(
      (_, i) => shed.isRoof[3 * i] === 1
    );
    for (const n of roof) {
      expect(n[0]).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 6);
      expect(n[2]).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 6);
    }
  });

  test("a shed dormer's front stays over the main roof", () => {
    // a fall that would take the front under the roof: kept MIN_FRONT up
    const shed = dormerMesh(dormer(1, 0, 40), offset);
    const zs = shed.positions.filter(
      (_, i) => i % 3 === 2 && shed.positions[i - 2] === 101
    );
    expect(Math.max(...zs)).toBeCloseTo(19 + MIN_FRONT, 6);
    // a fall as steep as the roof's: shallower, still meeting it behind
    const steep = dormerMesh(dormer(1, 0, 60), offset);
    expect(steep.positions.every(Number.isFinite)).toBe(true);
  });
});

describe("chimneyMesh", () => {
  /** A 0.6 × 1.6 m chimney on the 45° roof, its top 1.5 m over the roof
   *  at its centre. */
  const chimney: DormerFeature = {
    geometry: { type: "Point", coordinates: [100, 200] },
    properties: {
      of: "a",
      k: "chimney",
      ax: 1,
      ay: 0,
      w: 0.6,
      d: 1.6,
      z: 20,
      top: 21.5,
      slope: 45,
    },
  };

  test("a closed box from under the roof's lowest point to its top", () => {
    const m = chimneyMesh(chimney, offset);
    // four sides and a top, two triangles each
    expect(m.positions.length).toBe(5 * 2 * 9);
    expect(m.isRoof.every((r) => r === 0)).toBe(true);
    const zs = m.positions.filter((_, i) => i % 3 === 2);
    // the roof falls 0.8 m to its downslope side, and the box reaches under
    expect(Math.min(...zs)).toBeCloseTo(20 - 0.8 - DORMER_SINK);
    expect(m.base).toBeCloseTo(20 - 0.8 - DORMER_SINK);
    expect(Math.max(...zs)).toBeCloseTo(21.5);
    const xs = m.positions.filter((_, i) => i % 3 === 0);
    const ys = m.positions.filter((_, i) => i % 3 === 1);
    // d along the axis (x), w across it
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.6);
  });

  test("every face looks outwards", () => {
    const m = chimneyMesh(chimney, offset);
    const n = unitNormals(m.positions);
    for (let t = 0; t < n.length; t++) {
      const tri = m.positions.slice(t * 9, t * 9 + 9);
      const cx = (tri[0] + tri[3] + tri[6]) / 3 - 100;
      const cy = (tri[1] + tri[4] + tri[7]) / 3 - 200;
      const cz = (tri[2] + tri[5] + tri[8]) / 3 - (m.base + 21.5) / 2;
      // from the box's middle out through the face
      expect(n[t][0] * cx + n[t][1] * cy + n[t][2] * cz).toBeGreaterThan(0);
    }
  });
});
