/**
 * Error-bounded terrain TIN: an irregular triangle mesh over the tile, refined
 * by scripts/bake-terrain-tin.ts (Delatin greedy refinement of the native 1 m
 * DGM1) and written by scripts/prepare-data.ts as the FINE terrain level's
 * glTF (lib/city/tileset.ts, `TerrainExtras.tin`). Where a regular grid
 * spends the same vertex density on a flat river as on a retaining wall, the
 * TIN puts its vertices where the ground actually bends: every grid point of
 * the source lies within `maxError` of the mesh, so a 2 m drop that spans two
 * 1 m cells in the source stays two cells wide instead of being resampled
 * into a ramp.
 *
 * Vertices sit on the source grid's pixel centres, like the grid mesh's; the
 * outermost ring is snapped to the true tile edge so neighbouring tiles meet.
 * Triangles are wound counter-clockwise seen from above (+Z in the data
 * frame). A TIN has no NoData: the bake refuses a grid with holes, and that
 * tile's fine level falls back to the grid.
 *
 * `TinIndex` answers `heightAt` over the very triangles the GPU draws: at
 * build time for the walls and kerbs standing on the ground, at runtime (from
 * the streamed glTF's positions) for everything the viewer stands on it.
 * No THREE, no DOM.
 */
import { SKIRT_DEPTH, type TerrainBounds } from "./terrain-geometry";

/** A TIN: grid-space vertices + elevations + CCW triangles. */
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

/** A Delatin run over an n×n grid (scripts/bake-terrain-tin.ts). */
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

/** Vertex order: row-major by (gy, gx). Returns old index → new index. */
function sortVertices(coords: ArrayLike<number>): {
  order: Uint32Array;
  remap: Uint32Array;
} {
  const count = coords.length / 2;
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    order[i] = i;
  }
  order.sort(
    (a, b) =>
      coords[2 * a + 1] - coords[2 * b + 1] || coords[2 * a] - coords[2 * b]
  );
  const remap = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    remap[order[i]] = i;
  }
  return { order, remap };
}

/** Rotates each triangle so its smallest index leads, winds it CCW from
 *  above (grid y points south, so grid-CW is world-CCW), sorts by lead. */
function canonicalTriangles(
  triangles: ArrayLike<number>,
  remap: Uint32Array,
  coords: ArrayLike<number>
): Uint32Array {
  const count = triangles.length / 3;
  const tris = new Uint32Array(triangles.length);
  for (let t = 0; t < count; t++) {
    const ia = triangles[3 * t];
    let ib = triangles[3 * t + 1];
    let ic = triangles[3 * t + 2];
    // Orientation in grid space (x east, y SOUTH): a positive cross product
    // is clockwise seen from above in the north-up data frame → swap.
    const cross =
      (coords[2 * ib] - coords[2 * ia]) *
        (coords[2 * ic + 1] - coords[2 * ia + 1]) -
      (coords[2 * ib + 1] - coords[2 * ia + 1]) *
        (coords[2 * ic] - coords[2 * ia]);
    if (cross > 0) {
      [ib, ic] = [ic, ib];
    }
    let a = remap[ia];
    let b = remap[ib];
    let c = remap[ic];
    while (a > b || a > c) {
      [a, b, c] = [b, c, a];
    }
    tris[3 * t] = a;
    tris[3 * t + 1] = b;
    tris[3 * t + 2] = c;
  }
  const idx = new Uint32Array(count);
  for (let t = 0; t < count; t++) {
    idx[t] = t;
  }
  idx.sort(
    (p, q) => tris[3 * p] - tris[3 * q] || tris[3 * p + 1] - tris[3 * q + 1]
  );
  const sorted = new Uint32Array(tris.length);
  for (let t = 0; t < count; t++) {
    sorted.set(tris.subarray(3 * idx[t], 3 * idx[t] + 3), 3 * t);
  }
  return sorted;
}

/**
 * The TIN of a Delatin run: vertices sorted row-major (row 0 = north),
 * triangles wound CCW from above. Throws on a NaN/NoData vertex.
 */
export function tinFromMesher(src: TinSource): TerrainTin {
  const { coords, n } = src;
  if (n > 0xff_ff) {
    throw new Error(`terrain TIN: n ${n} does not fit the uint16 vertex grid`);
  }
  const { order, remap } = sortVertices(coords);
  const count = order.length;
  const gx = new Uint16Array(count);
  const gy = new Uint16Array(count);
  const z = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = coords[2 * order[i]];
    const y = coords[2 * order[i] + 1];
    const h = src.heightAt(x, y);
    if (!Number.isFinite(h)) {
      throw new Error(`terrain TIN: NoData at grid (${x}, ${y})`);
    }
    gx[i] = x;
    gy[i] = y;
    z[i] = h;
  }
  return {
    bounds: src.bounds,
    n,
    gx,
    gy,
    z,
    triangles: canonicalTriangles(src.triangles, remap, coords),
  };
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

/** Twice the plan area (m²) below which a triangle has none: a TIN's smallest
 *  is half a 1 m grid cell (den = 1), a skirt triangle's is zero up to the
 *  float noise of dequantising and turning the streamed positions. */
const MIN_PLAN_AREA = 1e-6;

/** What `TinIndex` needs: projected vertex positions, their elevations and
 *  the surface triangles (no skirt). */
export interface TinSurface {
  bounds: TerrainBounds;
  /** 3 vertex indices per triangle */
  triangles: ArrayLike<number>;
  /** projected (EPSG) x, y per vertex */
  xy: ArrayLike<number>;
  /** elevation (m) per vertex */
  z: ArrayLike<number>;
}

/** A TIN as the surface `TinIndex` reads. */
export function tinSurface(tin: TerrainTin): TinSurface {
  return {
    bounds: tin.bounds,
    triangles: tin.triangles,
    xy: tinVertexXY(tin),
    z: tin.z,
  };
}

/**
 * Point → triangle lookup for `heightAt`: a uniform bucket grid over the tile
 * (CSR layout: `start[b] … start[b+1]` in `items`), each triangle listed in
 * every bucket its bounding box touches. One bucket read + a handful of
 * barycentric tests per query — vegetation and lamps call this tens of
 * thousands of times per tile.
 */
export class TinIndex {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly items: Uint32Array;
  private readonly start: Uint32Array;
  private readonly surface: TinSurface;

  constructor(surface: TinSurface, cell = INDEX_CELL_M) {
    this.surface = surface;
    const [minX, minY, maxX, maxY] = surface.bounds;
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
    const { triangles, xy } = this.surface;
    const [minX, minY] = this.surface.bounds;
    for (let t = 0; t < triangles.length / 3; t++) {
      const a = triangles[3 * t];
      const b = triangles[3 * t + 1];
      const c = triangles[3 * t + 2];
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

  /** Elevation at projected (x, y); null outside the tile. */
  heightAt(x: number, y: number): number | null {
    const [minX, minY, maxX, maxY] = this.surface.bounds;
    if (x < minX || x > maxX || y < minY || y > maxY) {
      return null;
    }
    const col = Math.min(this.cols - 1, Math.floor((x - minX) / this.cell));
    const row = Math.min(this.rows - 1, Math.floor((y - minY) / this.cell));
    const b = row * this.cols + col;
    const { triangles, xy, z } = this.surface;
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
      if (Math.abs(den) < MIN_PLAN_AREA) {
        continue; // a skirt triangle (vertical), or one quantisation collapsed
      }
      const u = (px * v1y - v1x * py) / den;
      const w = (v0x * py - px * v0y) / den;
      const EPS = 1e-9;
      if (u >= -EPS && w >= -EPS && u + w <= 1 + EPS) {
        return z[a] + u * (z[bb] - z[a]) + w * (z[c] - z[a]);
      }
    }
    return null;
  }
}
