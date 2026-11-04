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

/** Whether a plate tile holds an EPSG position (its edges included). */
function holds(d: DrawnPlateTile, x: number, y: number): boolean {
  return (
    x >= d.bounds[0] && x <= d.bounds[2] && y >= d.bounds[1] && y <= d.bounds[3]
  );
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
  const bilinear = (t: DrawnPlateTile, x: number, y: number): number => {
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
  // the tiles are one grid: a point finds its tile by its cell, not by
  // asking every tile (the framing of an answer asks thousands of times)
  const [first] = tiles;
  const w = first ? first.bounds[2] - first.bounds[0] : 1;
  const h = first ? first.bounds[3] - first.bounds[1] : 1;
  const cell = (x: number, y: number) =>
    `${Math.floor(x / w)},${Math.floor(y / h)}`;
  const byCell = new Map(
    tiles.map((t) => [
      cell((t.bounds[0] + t.bounds[2]) / 2, (t.bounds[1] + t.bounds[3]) / 2),
      t,
    ])
  );
  return (x, y) => {
    const near = byCell.get(cell(x, y));
    // on a cell's north or east edge the cell beyond may hold nothing
    const t =
      near && holds(near, x, y) ? near : tiles.find((d) => holds(d, x, y));
    return t ? bilinear(t, x, y) : undefined;
  };
}
