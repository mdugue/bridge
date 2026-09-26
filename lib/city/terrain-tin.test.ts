import { expect, test } from "bun:test";
import { SKIRT_DEPTH } from "./terrain-geometry";
import {
  buildTinGeometryData,
  type TerrainTin,
  TinIndex,
  tinFromMesher,
  tinSurface,
  tinVertexXY,
} from "./terrain-tin";

// A 3×3 grid over a 30 m tile (pixel centres at 5, 15, 25 m; the border
// ring snaps to 0 / 30), meshed the way Delatin would: the four corners plus
// the centre, four triangles in mixed winding.
const BOUNDS: [number, number, number, number] = [0, 0, 30, 30];
const GRID = [100, 101, 102, 103, 110, 105, 106, 107, 108];
const heightAt = (x: number, y: number) => GRID[y * 3 + x];
const COORDS = [0, 0, 2, 0, 2, 2, 0, 2, 1, 1];
const TRIANGLES = [0, 1, 4, 4, 2, 1, 2, 3, 4, 0, 4, 3];

function roundTrip(): TerrainTin {
  return tinFromMesher({
    bounds: BOUNDS,
    n: 3,
    coords: COORDS,
    triangles: TRIANGLES,
    heightAt,
  });
}

/** Signed area of triangle t in the north-up data frame (> 0 = CCW). */
function signedArea(tin: TerrainTin, t: number): number {
  const xy = tinVertexXY(tin);
  const [a, b, c] = [0, 1, 2].map((k) => tin.triangles[3 * t + k]);
  return (
    (xy[2 * b] - xy[2 * a]) * (xy[2 * c + 1] - xy[2 * a + 1]) -
    (xy[2 * b + 1] - xy[2 * a + 1]) * (xy[2 * c] - xy[2 * a])
  );
}

test("the TIN keeps the mesher's vertices, heights and triangles", () => {
  const tin = roundTrip();
  expect(tin.gx.length).toBe(5);
  const verts = [...tin.gx].map((x, i) => `${x},${tin.gy[i]}`).sort();
  expect(verts).toEqual(["0,0", "0,2", "1,1", "2,0", "2,2"]);
  for (let i = 0; i < tin.gx.length; i++) {
    expect(tin.z[i]).toBeCloseTo(heightAt(tin.gx[i], tin.gy[i]), 2);
  }
  // Same four triangles (as sets of grid points), whatever the order.
  const key = (tri: ArrayLike<number>) =>
    Array.from(tri)
      .map((v) => `${tin.gx[v]},${tin.gy[v]}`)
      .sort()
      .join("|");
  const kept = [0, 1, 2, 3]
    .map((t) => key(tin.triangles.slice(3 * t, 3 * t + 3)))
    .sort();
  const source = [0, 1, 2, 3]
    .map((t) =>
      [0, 1, 2]
        .map((k) => {
          const v = TRIANGLES[3 * t + k];
          return `${COORDS[2 * v]},${COORDS[2 * v + 1]}`;
        })
        .sort()
        .join("|")
    )
    .sort();
  expect(kept).toEqual(source);
});

test("every triangle is wound counter-clockwise seen from above", () => {
  const tin = roundTrip();
  for (let t = 0; t < tin.triangles.length / 3; t++) {
    expect(signedArea(tin, t)).toBeGreaterThan(0);
  }
});

test("heightAt interpolates the drawn triangles and is exact at vertices", () => {
  const tin = roundTrip();
  const index = new TinIndex(tinSurface(tin), 4);
  // The centre vertex (grid 1,1) sits at the pixel centre (15, 15).
  expect(index.heightAt(15, 15)).toBeCloseTo(110, 2);
  // Corners are snapped to the true tile edge.
  expect(index.heightAt(0, 30)).toBeCloseTo(100, 2);
  expect(index.heightAt(30, 0)).toBeCloseTo(108, 2);
  // Halfway along the north edge between two corners: their mean.
  expect(index.heightAt(15, 30)).toBeCloseTo(101, 2);
  expect(index.heightAt(-1, 10)).toBeNull();
  expect(index.heightAt(10, 31)).toBeNull();
});

test("the mesh snaps its border to the tile edge and hangs a skirt", () => {
  const tin = roundTrip();
  const offset = { cx: 15, cy: 15 };
  const { positions, indices, minElevation } = buildTinGeometryData(
    tin,
    offset
  );
  expect(minElevation).toBeCloseTo(100, 2);
  // 5 surface vertices + 2 border vertices on each of the 4 sides.
  expect(positions.length / 3).toBe(5 + 8);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 5; i++) {
    minX = Math.min(minX, positions[3 * i]);
    maxX = Math.max(maxX, positions[3 * i]);
  }
  expect(minX).toBe(-15);
  expect(maxX).toBe(15);
  // 4 surface triangles + 2 per border edge (one edge per side).
  expect(indices.length / 3).toBe(4 + 8);
  const skirtZ = positions[3 * 5 + 2];
  expect(skirtZ).toBeCloseTo(positions[2] - SKIRT_DEPTH, 2);
});

test("the skirt walls face away from the tile", () => {
  const tin = roundTrip();
  const { positions, indices } = buildTinGeometryData(tin, { cx: 15, cy: 15 });
  for (let t = tin.triangles.length / 3; t < indices.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => indices[3 * t + k]);
    const e1 = [0, 1, 2].map(
      (k) => positions[3 * b + k] - positions[3 * a + k]
    );
    const e2 = [0, 1, 2].map(
      (k) => positions[3 * c + k] - positions[3 * a + k]
    );
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const cx = (positions[3 * a] + positions[3 * b] + positions[3 * c]) / 3;
    const cy =
      (positions[3 * a + 1] + positions[3 * b + 1] + positions[3 * c + 1]) / 3;
    // Outward = the horizontal normal points the same way as the centroid.
    expect(nx * cx + ny * cy).toBeGreaterThan(0);
  }
});

test("heightAt skips the vertical skirt triangles it is handed", () => {
  const tin = roundTrip();
  const { positions, indices } = buildTinGeometryData(tin, { cx: 0, cy: 0 });
  const count = positions.length / 3;
  const xy = new Float64Array(count * 2);
  const z = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // a hair of float noise, as the streamed positions carry
    xy[2 * i] = positions[3 * i] + positions[3 * i + 2] * 1e-15;
    xy[2 * i + 1] = positions[3 * i + 1];
    z[i] = positions[3 * i + 2];
  }
  const index = new TinIndex({ bounds: BOUNDS, xy, z, triangles: indices });
  // On the north edge a skirt triangle shares the plan position of the
  // surface one; the surface wins, never the skirt's lowered floor.
  expect(index.heightAt(15, 30)).toBeCloseTo(101, 2);
  expect(index.heightAt(30, 15)).toBeCloseTo(105, 2);
});
