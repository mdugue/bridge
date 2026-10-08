import { describe, expect, test } from "bun:test";
import { dormerMesh, DORMER_SINK } from "./dormers";
import type { DormerFeature } from "./features";

/** A dormer on a 45° roof falling towards +x, its roof at z 20 there. */
const dormer = (ax = 1, ay = 0): DormerFeature => ({
  geometry: { type: "Point", coordinates: [100, 200] },
  properties: { of: "a", ax, ay, w: 2, d: 2, z: 20, top: 21.5, slope: 45 },
});
const offset = { cx: 0, cy: 0 };

const faceNormals = (tris: number[]) => {
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
    out.push(n.map((c) => Math.round(c / l) + 0));
  }
  return out;
};

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
});
