/**
 * The ground plate's heights as the camera's coarse ground (camera-pose.ts
 * `coarseHeightAt`): read in the viewer only, so it lives apart from
 * ground-plate.ts, which keys the plate's bake.
 */
import type { TerrainBounds } from "./terrain-geometry";
import { PLATE_SINK_M } from "./ground-plate";

/** A plate tile as the viewer keeps it: its drawn positions (Y-up, `n`²
 *  vertices, `platePositions`), the inner ones sunk by PLATE_SINK_M. */
export interface DrawnPlateTile {
  bounds: TerrainBounds;
  positions: ArrayLike<number>;
}

/**
 * The plate's ground at an EPSG position, bilinear between the four
 * vertices around it; undefined off every tile. Reads the meshes' own
 * positions — no copy of its own (ADR 0047).
 */
export function plateHeightAt(
  tiles: readonly DrawnPlateTile[],
  n: number
): (x: number, y: number) => number | undefined {
  const heightOf = (t: DrawnPlateTile, i: number, j: number): number => {
    const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
    return t.positions[(j * n + i) * 3 + 1] + (edge ? 0 : PLATE_SINK_M);
  };
  return (x, y) => {
    const t = tiles.find(
      ({ bounds: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1
    );
    if (!t) {
      return;
    }
    const [x0, y0, x1, y1] = t.bounds;
    const fi = ((x - x0) / (x1 - x0)) * (n - 1);
    const fj = ((y1 - y) / (y1 - y0)) * (n - 1);
    const i = Math.min(Math.floor(fi), n - 2);
    const j = Math.min(Math.floor(fj), n - 2);
    const u = fi - i;
    const v = fj - j;
    return (
      (heightOf(t, i, j) * (1 - u) + heightOf(t, i + 1, j) * u) * (1 - v) +
      (heightOf(t, i, j + 1) * (1 - u) + heightOf(t, i + 1, j + 1) * u) * v
    );
  };
}
