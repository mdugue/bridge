/**
 * Error-bounded terrain TIN: an irregular triangle mesh over a tile, refined
 * at build time by Delatin from the NATIVE 1 m DGM (scripts/bake-tiles.ts,
 * `tinTerrainMesh`) and shipped as each terrain level's glTF content
 * (lib/city/tileset.ts). Where a regular grid spends the same vertex density
 * on a flat river as on a retaining wall, the TIN puts its vertices where
 * the ground actually bends: every grid point of the source lies within
 * `maxError` of the mesh, so a 2 m drop that spans two 1 m cells in the
 * source stays two cells wide instead of being resampled into a ramp.
 *
 * Bake side: `tinFromDelatin` turns Delatin's output into a `TerrainTin`
 * (triangles wound counter-clockwise seen from above, +Z in the data frame)
 * and `buildTinGeometryData` meshes it with the heightfield's skirt.
 * Runtime side: `TriangleIndex` answers `heightAt` from the very triangles
 * the GPU draws (read back from the streamed mesh, terrain-layer.ts).
 *
 * Vertices sit on the source grid's pixel centres, like the grid mesh's; the
 * outermost ring is snapped to the true tile edge so neighbouring tiles meet.
 * A TIN has no NoData: `tinFromDelatin` refuses a grid with holes and the
 * bake falls back to the regular grid for that tile. No THREE, no DOM.
 */
import { SKIRT_DEPTH, type TerrainBounds } from "./terrain-geometry";

/** A TIN in grid space: vertices + elevations + CCW triangles. */
export interface TerrainTin {
  bounds: TerrainBounds;
  n: number;
  /** vertex grid columns (0 … n−1, west → east) */
  gx: Uint16Array;
  /** vertex grid rows (0 … n−1, north → south) */
  gy: Uint16Array;
  /** 3 vertex indices per triangle, CCW from above */
  triangles: Uint32Array;
  /** vertex elevations (m) */
  z: Float32Array;
}

export interface TinSource {
  bounds: TerrainBounds;
  /** Delatin output: flat [x, y] grid coordinates */
  coords: ArrayLike<number>;
  /** elevation of grid point (x, y) — the source raster */
  heightAt: (x: number, y: number) => number;
  n: number;
  /** Delatin output: flat vertex indices, three per triangle, any winding */
  triangles: ArrayLike<number>;
}

/**
 * Delatin's mesh as a `TerrainTin`: elevations read from the source grid,
 * every triangle wound CCW seen from above. Throws on a NaN/NoData vertex.
 */
export function tinFromDelatin(src: TinSource): TerrainTin {
  const { coords, n } = src;
  const count = coords.length / 2;
  if (n > 0xff_ff) {
    throw new Error(`terrain TIN: n ${n} does not fit the uint16 grid`);
  }
  const gx = new Uint16Array(count);
  const gy = new Uint16Array(count);
  const z = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    gx[i] = coords[2 * i];
    gy[i] = coords[2 * i + 1];
    const h = src.heightAt(gx[i], gy[i]);
    if (!Number.isFinite(h)) {
      throw new Error("terrain TIN: NoData vertex — bake the grid instead");
    }
    z[i] = h;
  }
  const triangles = new Uint32Array(src.triangles.length);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = src.triangles[t];
    let b = src.triangles[t + 1];
    let c = src.triangles[t + 2];
    // Orientation in grid space (x east, y SOUTH): a positive cross product
    // is clockwise seen from above in the north-up data frame → swap.
    const cross =
      (gx[b] - gx[a]) * (gy[c] - gy[a]) - (gy[b] - gy[a]) * (gx[c] - gx[a]);
    if (cross > 0) {
      [b, c] = [c, b];
    }
    triangles[t] = a;
    triangles[t + 1] = b;
    triangles[t + 2] = c;
  }
  return { bounds: src.bounds, n, gx, gy, z, triangles };
}

// --- geometry ------------------------------------------------------------------

/** Projected (EPSG) x/y of every vertex: pixel centres, the outermost ring
 *  snapped to the true tile edge (the heightfield mesh's rule). */
export function tinVertexXY(tin: TerrainTin): Float64Array {
  const { n, gx, gy } = tin;
  const [minX, minY, maxX, maxY] = tin.bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  const xy = new Float64Array(gx.length * 2);
  for (let i = 0; i < gx.length; i++) {
    const col = gx[i];
    const row = gy[i];
    xy[2 * i] =
      col === 0 ? minX : col === n - 1 ? maxX : minX + (col + 0.5) * dx;
    xy[2 * i + 1] =
      row === 0 ? maxY : row === n - 1 ? minY : maxY - (row + 0.5) * dy;
  }
  return xy;
}

export interface TinGeometryData {
  indices: Uint32Array<ArrayBuffer>;
  minElevation: number;
  /** vertex positions in the recentered Z-up data frame, skirt ring appended */
  positions: Float32Array<ArrayBuffer>;
}

/** The border vertices of one side, sorted along it. */
function borderRuns(tin: TerrainTin): {
  east: number[];
  north: number[];
  south: number[];
  west: number[];
} {
  const { n, gx, gy } = tin;
  const north: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
  for (let i = 0; i < gx.length; i++) {
    if (gy[i] === 0) north.push(i);
    if (gy[i] === n - 1) south.push(i);
    if (gx[i] === 0) west.push(i);
    if (gx[i] === n - 1) east.push(i);
  }
  north.sort((a, b) => gx[a] - gx[b]);
  south.sort((a, b) => gx[a] - gx[b]);
  west.sort((a, b) => gy[a] - gy[b]);
  east.sort((a, b) => gy[a] - gy[b]);
  return { north, south, west, east };
}

/**
 * Positions + CCW indices for the TIN, with the same vertical skirt as the
 * heightfield mesh (terrain-geometry.ts): the border runs drop SKIRT_DEPTH so a
 * height mismatch against a neighbour tile's coarser grid shows terrain, not
 * sky. Delatin keeps every border grid point it inserts ON the border edge, so
 * consecutive border vertices are exactly the mesh's boundary edges.
 */
export function buildTinGeometryData(
  tin: TerrainTin,
  offset: { cx: number; cy: number }
): TinGeometryData {
  const v = tin.gx.length;
  const xy = tinVertexXY(tin);
  const runs = borderRuns(tin);
  const skirtCount =
    runs.north.length + runs.south.length + runs.west.length + runs.east.length;
  const positions = new Float32Array((v + skirtCount) * 3);
  let minElevation = Number.POSITIVE_INFINITY;
  for (let i = 0; i < v; i++) {
    positions[3 * i] = xy[2 * i] - offset.cx;
    positions[3 * i + 1] = xy[2 * i + 1] - offset.cy;
    positions[3 * i + 2] = tin.z[i];
    minElevation = Math.min(minElevation, tin.z[i]);
  }
  const skirt: number[] = [];
  let s = v;
  const addBorder = (top: number[], ccwTop: boolean): void => {
    const base = s;
    for (const i of top) {
      positions[3 * s] = positions[3 * i];
      positions[3 * s + 1] = positions[3 * i + 1];
      positions[3 * s + 2] = positions[3 * i + 2] - SKIRT_DEPTH;
      s++;
    }
    for (let k = 0; k < top.length - 1; k++) {
      const [tp, tq, bp, bq] = [top[k], top[k + 1], base + k, base + k + 1];
      if (ccwTop) {
        skirt.push(tp, tq, bq, tp, bq, bp);
      } else {
        skirt.push(tp, bq, tq, tp, bp, bq);
      }
    }
  };
  // Runs are sorted west→east / north→south; the heightfield's winding rule
  // (north & east CCW-from-top) applies unchanged because it lists its border
  // vertices in the same order.
  addBorder(runs.north, true);
  addBorder(runs.east, true);
  addBorder(runs.south, false);
  addBorder(runs.west, false);
  const indices = new Uint32Array(tin.triangles.length + skirt.length);
  indices.set(tin.triangles, 0);
  indices.set(skirt, tin.triangles.length);
  return { positions, indices, minElevation };
}

// --- heightAt ------------------------------------------------------------------

/** Bucket edge (m) of the triangle index: ~8 m keeps a bucket at a few dozen
 *  triangles on the densest ground and a big flat triangle in a few hundred
 *  buckets. */
const INDEX_CELL_M = 8;

/** Twice a triangle's signed area in xy below which it is a vertical skirt
 *  wall (or a sliver) that no ground query can land in. */
const MIN_XY_AREA = 1e-6;

/**
 * Point → triangle lookup for `heightAt` over any triangle mesh of a tile: a
 * uniform bucket grid over `bounds` (CSR layout: `start[b] … start[b+1]` in
 * `items`), each triangle listed in every bucket its bounding box touches.
 * One bucket read + a handful of barycentric tests per query — vegetation
 * and lamps call this tens of thousands of times at load. Triangles with no
 * area in plan (the skirt) are left out.
 */
export class TriangleIndex {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly items: Uint32Array;
  private readonly start: Uint32Array;

  /**
   * @param xy projected x, y per vertex
   * @param z elevation per vertex
   * @param triangles three vertex indices per triangle
   * @param bounds the extent queries may land in (projected)
   */
  constructor(
    private readonly xy: ArrayLike<number>,
    private readonly z: ArrayLike<number>,
    private readonly triangles: ArrayLike<number>,
    private readonly bounds: TerrainBounds,
    cell = INDEX_CELL_M
  ) {
    const [minX, minY, maxX, maxY] = bounds;
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    this.rows = Math.max(1, Math.ceil((maxY - minY) / cell));
    const counts = new Uint32Array(this.cols * this.rows + 1);
    this.forEachBucket((b) => {
      counts[b + 1]++;
    });
    for (let b = 1; b < counts.length; b++) {
      counts[b] += counts[b - 1];
    }
    this.start = counts;
    this.items = new Uint32Array(counts[counts.length - 1]);
    const fill = counts.slice(0, -1);
    this.forEachBucket((b, t) => {
      this.items[fill[b]++] = t;
    });
  }

  private bucketRange(x0: number, x1: number, lo: number, cells: number) {
    const a = Math.max(0, Math.floor((x0 - lo) / this.cell));
    const b = Math.min(cells - 1, Math.floor((x1 - lo) / this.cell));
    return [a, b] as const;
  }

  private forEachBucket(visit: (bucket: number, tri: number) => void): void {
    const { triangles, xy } = this;
    const [minX, minY] = this.bounds;
    for (let t = 0; t < triangles.length / 3; t++) {
      const a = triangles[3 * t];
      const b = triangles[3 * t + 1];
      const c = triangles[3 * t + 2];
      const area =
        (xy[2 * b] - xy[2 * a]) * (xy[2 * c + 1] - xy[2 * a + 1]) -
        (xy[2 * b + 1] - xy[2 * a + 1]) * (xy[2 * c] - xy[2 * a]);
      if (Math.abs(area) < MIN_XY_AREA) {
        continue;
      }
      const [c0, c1] = this.bucketRange(
        Math.min(xy[2 * a], xy[2 * b], xy[2 * c]),
        Math.max(xy[2 * a], xy[2 * b], xy[2 * c]),
        minX,
        this.cols
      );
      const [r0, r1] = this.bucketRange(
        Math.min(xy[2 * a + 1], xy[2 * b + 1], xy[2 * c + 1]),
        Math.max(xy[2 * a + 1], xy[2 * b + 1], xy[2 * c + 1]),
        minY,
        this.rows
      );
      for (let r = r0; r <= r1; r++) {
        for (let col = c0; col <= c1; col++) {
          visit(r * this.cols + col, t);
        }
      }
    }
  }

  /** Elevation at projected (x, y); null outside the bounds or the mesh. */
  heightAt(x: number, y: number): number | null {
    const [minX, minY, maxX, maxY] = this.bounds;
    if (x < minX || x > maxX || y < minY || y > maxY) {
      return null;
    }
    const col = Math.min(this.cols - 1, Math.floor((x - minX) / this.cell));
    const row = Math.min(this.rows - 1, Math.floor((y - minY) / this.cell));
    const b = row * this.cols + col;
    const { triangles, xy, z } = this;
    for (let k = this.start[b]; k < this.start[b + 1]; k++) {
      const t = this.items[k];
      const a = triangles[3 * t];
      const bb = triangles[3 * t + 1];
      const c = triangles[3 * t + 2];
      const ax = xy[2 * a];
      const ay = xy[2 * a + 1];
      const v0x = xy[2 * bb] - ax;
      const v0y = xy[2 * bb + 1] - ay;
      const v1x = xy[2 * c] - ax;
      const v1y = xy[2 * c + 1] - ay;
      const px = x - ax;
      const py = y - ay;
      const den = v0x * v1y - v1x * v0y;
      const u = (px * v1y - v1x * py) / den;
      const w = (v0x * py - px * v0y) / den;
      // Quantised positions leave shared edges a hair apart: a little slack.
      const EPS = 1e-6;
      if (u >= -EPS && w >= -EPS && u + w <= 1 + EPS) {
        return z[a] + u * (z[bb] - z[a]) + w * (z[c] - z[a]);
      }
    }
    return null;
  }
}

/** The index over a grid-space TIN (the bake's tests query it directly). */
export function tinIndex(tin: TerrainTin, cell?: number): TriangleIndex {
  return new TriangleIndex(
    tinVertexXY(tin),
    tin.z,
    tin.triangles,
    tin.bounds,
    cell
  );
}
