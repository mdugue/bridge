/**
 * Refines one tile's ground into an error-bounded terrain TIN
 * (lib/city/terrain-tin.ts) — the fine terrain level's mesh, in place of the
 * regular 1024² grid. The DGM is read at its NATIVE resolution (DGM1: 1 m,
 * 2000²) rather than resampled, then Delatin inserts the worst-fitting grid
 * point until every grid point lies within `maxError` of the mesh. Flat
 * ground (the Elbe, squares, meadows) collapses to a few large triangles and
 * the budget goes where the ground bends: a retaining wall keeps the 1–2 m
 * ramp the DGM1 has instead of the ~3 m the 1024² resample smears it into.
 *
 * No wall conflation here: the terrain study (scripts/terrain-study/,
 * docs/transformations.md "Terrain TIN") measured the breakline burn against
 * the laser scan and it triples the error in the 20 m band around walls — it
 * flattens terraced walls (the Jungfernbastei steps 108.6 → 117.4 → 119.7 →
 * 121.1 m) into one cliff at the top level. On the sharper native DGM1 the
 * wall ribbons snap to the measured step instead (lib/city/wall-snap.ts).
 *
 * Called by scripts/bake-tiles.ts; no DOM, no filesystem.
 */
import Delatin from "delatin";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { type TerrainTin, tinFromMesher } from "../lib/city/terrain-tin";

/**
 * Delatin tolerance (m) of the fine level. The fine level is what the walker
 * stands on: at 0.15 m a TIN is ~150–300k triangles (a seventh to a third of
 * the 1024² grid's 2 M) and matches or beats the grid on every accuracy
 * metric of the terrain study (docs/transformations.md, "Terrain TIN").
 */
export const FINE_TIN_MAX_ERROR = 0.15;

const orient = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
) => (bx - cx) * (ay - cy) - (by - cy) * (ax - cx);

/** How many pixels into a row an edge function `w` rising by `a` per
 *  pixel turns non-negative (Delatin's row start). */
function rowStart(w: number, a: number): number {
  return w < 0 && a !== 0 ? Math.floor(-w / a) : 0;
}

/**
 * Delatin whose error at a grid point is scaled by `scale` there: a point
 * scaled by s is held to maxError / s. The beds the lines lie on
 * (lib/city/track-beds.ts) are refined to BED_TIN_ERROR so their rails,
 * a few centimetres over the burned ground, never sink into a triangle
 * that only approximates it. Delatin has no public hook for a per-point
 * tolerance: this is its `_findCandidate` (delatin 0.2.0, pinned exactly in
 * package.json) with the scale applied to each point's error.
 */
class ScaledDelatin extends Delatin {
  /** Delatin's constructor rasterizes its first two triangles: the scale
   *  has to be there before `super` returns. */
  private static pending: ArrayLike<number> | null = null;
  private readonly scale: ArrayLike<number>;

  constructor(
    data: ArrayLike<number>,
    width: number,
    scale: ArrayLike<number>
  ) {
    ScaledDelatin.pending = scale;
    super(data, width, width);
    this.scale = scale;
    ScaledDelatin.pending = null;
  }

  _findCandidate(
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    t: number
  ): void {
    // the original's forward differencing over the triangle's pixels
    const minX = Math.min(p0x, p1x, p2x);
    const minY = Math.min(p0y, p1y, p2y);
    const maxX = Math.max(p0x, p1x, p2x);
    const maxY = Math.max(p0y, p1y, p2y);
    let w00 = orient(p1x, p1y, p2x, p2y, minX, minY);
    let w01 = orient(p2x, p2y, p0x, p0y, minX, minY);
    let w02 = orient(p0x, p0y, p1x, p1y, minX, minY);
    const a01 = p1y - p0y;
    const b01 = p0x - p1x;
    const a12 = p2y - p1y;
    const b12 = p1x - p2x;
    const a20 = p0y - p2y;
    const b20 = p2x - p0x;
    const a = orient(p0x, p0y, p1x, p1y, p2x, p2y);
    const z0 = this.heightAt(p0x, p0y) / a;
    const z1 = this.heightAt(p1x, p1y) / a;
    const z2 = this.heightAt(p2x, p2y) / a;
    const width = this.width;
    // during Delatin's constructor `this.scale` is not set yet
    const scale = this.scale ?? (ScaledDelatin.pending as ArrayLike<number>);
    let maxError = 0;
    let mx = 0;
    let my = 0;
    for (let y = minY; y <= maxY; y++) {
      const dx = Math.max(
        rowStart(w00, a12),
        rowStart(w01, a20),
        rowStart(w02, a01)
      );
      let w0 = w00 + a12 * dx;
      let w1 = w01 + a20 * dx;
      let w2 = w02 + a01 * dx;
      let wasInside = false;
      for (let x = minX + dx; x <= maxX; x++) {
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          wasInside = true;
          const z = z0 * w0 + z1 * w1 + z2 * w2;
          const dz = Math.abs(z - this.heightAt(x, y)) * scale[width * y + x];
          if (dz > maxError) {
            maxError = dz;
            mx = x;
            my = y;
          }
        } else if (wasInside) {
          break;
        }
        w0 += a12;
        w1 += a20;
        w2 += a01;
      }
      w00 += b12;
      w01 += b20;
      w02 += b01;
    }
    if (
      (mx === p0x && my === p0y) ||
      (mx === p1x && my === p1y) ||
      (mx === p2x && my === p2y)
    ) {
      maxError = 0;
    }
    this._candidates[2 * t] = mx;
    this._candidates[2 * t + 1] = my;
    this._queuePush(t, maxError);
  }
}

/**
 * Refines a Delatin mesh over an n×n grid (row 0 = north) to `maxError`;
 * with `scale` (n·n), a point is held to maxError / scale there
 * (`ScaledDelatin`). Throws when the grid has NoData: a TIN has no holes,
 * so such a tile keeps the regular grid (bake-tiles.ts falls back).
 */
export function tinFromGrid(
  grid: ArrayLike<number>,
  n: number,
  bounds: TerrainBounds,
  maxError: number,
  scale?: ArrayLike<number>
): TerrainTin {
  for (let i = 0; i < grid.length; i++) {
    if (!Number.isFinite(grid[i])) {
      throw new Error("terrain TIN: the source grid has NoData");
    }
  }
  const mesher = scale
    ? new ScaledDelatin(grid, n, scale)
    : new Delatin(grid, n, n);
  mesher.run(maxError);
  return tinFromMesher({
    bounds,
    n,
    coords: mesher.coords,
    triangles: mesher.triangles,
    heightAt: (x, y) => grid[y * n + x],
  });
}
