/**
 * The ground plate's heights as the camera's coarse ground (camera-pose.ts
 * `coarseHeightAt`): read in the viewer only, so it lives apart from
 * ground-plate.ts, which keys the plate's bake.
 */
import type { PlateTile } from "./ground-plate";

/**
 * The plate's ground at an EPSG position, bilinear between the four
 * vertices around it; undefined off every tile. Holds only the tiles'
 * heights (`n`² floats a tile), so it can outlive the build.
 */
export function plateHeightAt(
  tiles: readonly PlateTile[],
  n: number
): (x: number, y: number) => number | undefined {
  const kept = tiles.map((t) => ({ bounds: t.bounds, heights: t.heights }));
  return (x, y) => {
    const t = kept.find(
      ({ bounds: [x0, y0, x1, y1] }) => x >= x0 && x <= x1 && y >= y0 && y <= y1
    );
    if (!t) {
      return undefined;
    }
    const [x0, y0, x1, y1] = t.bounds;
    const fi = ((x - x0) / (x1 - x0)) * (n - 1);
    const fj = ((y1 - y) / (y1 - y0)) * (n - 1);
    const i = Math.min(Math.floor(fi), n - 2);
    const j = Math.min(Math.floor(fj), n - 2);
    const u = fi - i;
    const v = fj - j;
    const h = (a: number, b: number) => t.heights[(j + b) * n + i + a];
    return (
      (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) +
      (h(0, 1) * (1 - u) + h(1, 1) * u) * v
    );
  };
}
