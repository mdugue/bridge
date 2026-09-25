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

/**
 * Refines a Delatin mesh over an n×n grid (row 0 = north) to `maxError`.
 * Throws when the grid has NoData: a TIN has no holes, so such a tile keeps
 * the regular grid (bake-tiles.ts falls back).
 */
export function tinFromGrid(
  grid: ArrayLike<number>,
  n: number,
  bounds: TerrainBounds,
  maxError: number
): TerrainTin {
  for (let i = 0; i < grid.length; i++) {
    if (!Number.isFinite(grid[i])) {
      throw new Error("terrain TIN: the source grid has NoData");
    }
  }
  const mesher = new Delatin(grid, n, n);
  mesher.run(maxError);
  return tinFromMesher({
    bounds,
    n,
    coords: mesher.coords,
    triangles: mesher.triangles,
    heightAt: (x, y) => grid[y * n + x],
  });
}
