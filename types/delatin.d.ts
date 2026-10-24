/**
 * Minimal ambient typing for the untyped `delatin` package (bake-time only —
 * scripts/bake-terrain-tin.ts, scripts/measured-roofs.ts; nothing under
 * app/ may import it). Greedy
 * Delaunay refinement of a regular height grid: vertices land on grid
 * points, `run(maxError)` inserts the worst-fitting grid point until every
 * grid point is within `maxError` of the mesh. https://github.com/mapbox/delatin
 */
declare module "delatin" {
  export default class Delatin {
    constructor(data: ArrayLike<number>, width: number, height?: number);
    /** flat [x0, y0, x1, y1, …] grid coordinates of the vertices */
    coords: number[];
    /** flat [a, b, c, …] vertex indices, three per triangle */
    triangles: number[];
    getMaxError(): number;
    getRMSD(): number;
    heightAt(x: number, y: number): number;
    refine(): void;
    run(maxError?: number): void;
    /** the grid's width (internal; scripts/bake-terrain-tin.ts
     *  `ScaledDelatin` reads it) */
    width: number;
    /** each triangle's worst point, x and y (internal: `ScaledDelatin`) */
    _candidates: number[];
    /** rasterizes a triangle for its worst point and queues it (internal:
     *  `ScaledDelatin` overrides it) */
    _findCandidate(
      p0x: number,
      p0y: number,
      p1x: number,
      p1y: number,
      p2x: number,
      p2y: number,
      t: number
    ): void;
    _queuePush(t: number, error: number): void;
  }
}
