/**
 * Error-bounded terrain TIN: an irregular triangle mesh over the tile, baked
 * by scripts/bake-terrain-tin.ts (Delatin greedy refinement of a regular
 * height grid) and read by app/_components/terrain-layer.ts when the viewer
 * runs with `?terrain=tin`. Where the regular heightfield spends the same
 * vertex density on a flat river as on a retaining wall, the TIN puts its
 * vertices where the ground actually bends: every grid point of the source
 * lies within `maxError` of the mesh, so a 2 m drop that spans two 1 m cells
 * in the source stays two cells wide instead of being resampled into a ramp.
 *
 * Two files, like the heightfield:
 *  - <name>.json    — this header
 *  - <name>.bin.gz  — gzipped payload (see encodeTerrainTin). Vertices are
 *    sorted row-major (row 0 = north) and stored as three uint16 planes, each
 *    split into its low bytes then its high bytes (gzip finds far more runs
 *    in a byte plane than in interleaved uint16s):
 *      gy — delta from the previous vertex's row
 *      gx — delta from the previous vertex in the same row (raw on a new row)
 *      z  — quantised (elevation = zMin + value * zScale), stored as the
 *           wrapping uint16 delta from the previous vertex
 *    then a varint triangle stream, 3 per triangle: a − previous a, b − a,
 *    c − a (each triangle rotated so its smallest index `a` leads and the list
 *    sorted by `a`, which keeps every delta small).
 *
 * Vertices sit on the source grid's pixel centres, like the heightfield's; the
 * outermost ring is snapped to the true tile edge so neighbouring tiles meet.
 * Triangles are wound counter-clockwise seen from above (+Z in the data frame).
 * A TIN has no NoData: the bake refuses a grid with holes (that tile keeps the
 * heightfield). No THREE, no DOM.
 */
import { SKIRT_DEPTH, type TerrainBounds } from "./terrain-geometry";

export const TERRAIN_TIN_VERSION = 1;

/** Default vertical quantisation step (m), as for the heightfield. */
export const TERRAIN_TIN_Z_SCALE = 0.01;

export interface TerrainTinHeader {
  /** [minX, minY, maxX, maxY] in the projected CRS */
  bounds: TerrainBounds;
  /** file name of the gzipped payload, relative to the header's directory */
  data: string;
  /** the Delatin tolerance the mesh was refined to (m) */
  maxError: number;
  /** source grid size (n × n pixel centres span the tile) */
  n: number;
  triangleCount: number;
  version: typeof TERRAIN_TIN_VERSION;
  vertexCount: number;
  /** elevation of quantised value 0 (m) */
  zMin: number;
  /** metres per quantisation step */
  zScale: number;
}

/** A decoded TIN: grid-space vertices + elevations + CCW triangles. */
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

function invalid(reason: string): never {
  throw new Error(`Invalid terrain TIN header: ${reason}`);
}

function positiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return invalid(`${name} must be a positive integer, got ${String(value)}`);
  }
  return value;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(`${name} must be a finite number, got ${String(value)}`);
  }
  return value;
}

function parseBounds(value: unknown): TerrainBounds {
  if (!(Array.isArray(value) && value.length === 4)) {
    return invalid("bounds must be an array of 4 numbers");
  }
  const [minX, minY, maxX, maxY] = (value as unknown[]).map((v, i) =>
    finite(v, `bounds[${i}]`)
  );
  if (maxX <= minX || maxY <= minY) {
    return invalid("degenerate bounds");
  }
  return [minX, minY, maxX, maxY];
}

function parseDataName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalid("data must be a non-empty file name");
  }
  if (value.includes("/") || value.includes("..")) {
    return invalid(`data must be a bare file name, got "${value}"`);
  }
  return value;
}

export function parseTerrainTinHeader(json: unknown): TerrainTinHeader {
  if (typeof json !== "object" || json === null) {
    return invalid("not an object");
  }
  const raw = json as Record<string, unknown>;
  if (raw.version !== TERRAIN_TIN_VERSION) {
    return invalid(
      `version ${String(raw.version)} (expected ${TERRAIN_TIN_VERSION})`
    );
  }
  const n = positiveInt(raw.n, "n");
  if (n > 0xff_ff) {
    return invalid(`n ${n} does not fit the uint16 vertex grid`);
  }
  const zScale = finite(raw.zScale, "zScale");
  if (zScale <= 0) {
    return invalid(`zScale must be positive, got ${zScale}`);
  }
  return {
    version: TERRAIN_TIN_VERSION,
    bounds: parseBounds(raw.bounds),
    data: parseDataName(raw.data),
    maxError: finite(raw.maxError, "maxError"),
    n,
    vertexCount: positiveInt(raw.vertexCount, "vertexCount"),
    triangleCount: positiveInt(raw.triangleCount, "triangleCount"),
    zMin: finite(raw.zMin, "zMin"),
    zScale,
  };
}

// --- encode (bake side) ------------------------------------------------------

export interface TinSource {
  bounds: TerrainBounds;
  /** Delatin output: flat [x, y] grid coordinates */
  coords: ArrayLike<number>;
  /** elevation of grid point (x, y) — the source raster */
  heightAt: (x: number, y: number) => number;
  /** the refinement tolerance (m), recorded in the header */
  maxError?: number;
  n: number;
  /** Delatin output: flat vertex indices, three per triangle, any winding */
  triangles: ArrayLike<number>;
}

function pushVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
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
 * Serialises a Delatin mesh into the payload described in the file header,
 * ungzipped (the caller gzips). Throws on a NaN/NoData vertex.
 */
export function encodeTerrainTin(
  src: TinSource,
  zScale: number = TERRAIN_TIN_Z_SCALE
): { data: Buffer; header: Omit<TerrainTinHeader, "data"> } {
  const { coords, n } = src;
  const count = coords.length / 2;
  const { order, remap } = sortVertices(coords);
  const zs = new Float64Array(count);
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const z = src.heightAt(coords[2 * i], coords[2 * i + 1]);
    if (!Number.isFinite(z)) {
      throw new Error(
        "terrain TIN: NoData vertex — bake the heightfield instead"
      );
    }
    zs[i] = z;
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const scale = Math.max(zScale, (zMax - zMin) / 0xff_fe);
  const planes = new Uint16Array(3 * count);
  let prevGy = -1;
  let prevGx = 0;
  let prevZ = 0;
  for (let k = 0; k < count; k++) {
    const i = order[k];
    const gy = coords[2 * i + 1];
    const gx = coords[2 * i];
    const z = Math.round((zs[i] - zMin) / scale);
    planes[k] = k === 0 ? gy : gy - prevGy;
    planes[count + k] = gy === prevGy ? gx - prevGx : gx;
    planes[2 * count + k] = (z - prevZ) & 0xff_ff;
    prevGy = gy;
    prevGx = gx;
    prevZ = z;
  }
  const split = new Uint8Array(planes.length * 2);
  for (let p = 0; p < 3; p++) {
    const base = p * count;
    for (let k = 0; k < count; k++) {
      split[2 * base + k] = planes[base + k] & 0xff;
      split[2 * base + count + k] = planes[base + k] >> 8;
    }
  }
  const tris = canonicalTriangles(src.triangles, remap, coords);
  const bytes: number[] = [];
  let prevA = 0;
  for (let t = 0; t < tris.length; t += 3) {
    pushVarint(bytes, tris[t] - prevA);
    pushVarint(bytes, tris[t + 1] - tris[t]);
    pushVarint(bytes, tris[t + 2] - tris[t]);
    prevA = tris[t];
  }
  return {
    data: Buffer.concat([Buffer.from(split), Buffer.from(bytes)]),
    header: {
      version: TERRAIN_TIN_VERSION,
      bounds: src.bounds,
      n,
      maxError: src.maxError ?? 0,
      vertexCount: count,
      triangleCount: tris.length / 3,
      zMin,
      zScale: scale,
    },
  };
}

// --- decode (client side) ----------------------------------------------------

function readTriangles(
  bytes: Uint8Array,
  start: number,
  triangleCount: number,
  vertexCount: number
): Uint32Array {
  const tris = new Uint32Array(triangleCount * 3);
  let p = start;
  let prevA = 0;
  const next = (): number => {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (p >= bytes.length) {
        throw new Error("terrain TIN: truncated triangle stream");
      }
      const b = bytes[p++];
      v += (b & 0x7f) * mul;
      if (b < 0x80) {
        return v;
      }
      mul *= 128;
    }
  };
  for (let t = 0; t < tris.length; t += 3) {
    const a = prevA + next();
    tris[t] = a;
    tris[t + 1] = a + next();
    tris[t + 2] = a + next();
    prevA = a;
    if (tris[t + 1] >= vertexCount || tris[t + 2] >= vertexCount) {
      throw new Error("terrain TIN: triangle index out of range");
    }
  }
  return tris;
}

/** Inflated payload → the decoded TIN. */
export function decodeTerrainTin(
  buffer: ArrayBuffer,
  header: Pick<
    TerrainTinHeader,
    "bounds" | "n" | "triangleCount" | "vertexCount" | "zMin" | "zScale"
  >
): TerrainTin {
  const { vertexCount: v, n, zMin, zScale } = header;
  if (buffer.byteLength < v * 6) {
    throw new Error("terrain TIN: payload shorter than its vertex planes");
  }
  const bytes = new Uint8Array(buffer);
  /** uint16 k of byte-split plane p */
  const plane = (p: number, k: number): number =>
    bytes[2 * p * v + k] | (bytes[2 * p * v + v + k] << 8);
  const gx = new Uint16Array(v);
  const gy = new Uint16Array(v);
  const z = new Float32Array(v);
  let row = 0;
  let col = 0;
  let q = 0;
  for (let i = 0; i < v; i++) {
    const dRow = plane(0, i);
    row += dRow;
    col = i > 0 && dRow === 0 ? col + plane(1, i) : plane(1, i);
    q = (q + plane(2, i)) & 0xff_ff;
    if (row >= n || col >= n) {
      throw new Error("terrain TIN: vertex outside the grid");
    }
    gy[i] = row;
    gx[i] = col;
    z[i] = zMin + q * zScale;
  }
  const triangles = readTriangles(bytes, 6 * v, header.triangleCount, v);
  return { bounds: header.bounds, n, gx, gy, z, triangles };
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
  indices: Uint32Array;
  minElevation: number;
  /** vertex positions in the recentered Z-up data frame, skirt ring appended */
  positions: Float32Array;
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

/**
 * Point → triangle lookup for `heightAt`: a uniform bucket grid over the tile
 * (CSR layout: `start[b] … start[b+1]` in `items`), each triangle listed in
 * every bucket its bounding box touches. One bucket read + a handful of
 * barycentric tests per query — vegetation and lamps call this tens of
 * thousands of times at load.
 */
export class TinIndex {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly items: Uint32Array;
  private readonly start: Uint32Array;
  private readonly xy: Float64Array;
  private readonly tin: TerrainTin;

  constructor(tin: TerrainTin, cell = INDEX_CELL_M) {
    this.tin = tin;
    this.xy = tinVertexXY(tin);
    const [minX, minY, maxX, maxY] = tin.bounds;
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
    const { triangles } = this.tin;
    const [minX, minY] = this.tin.bounds;
    const xy = this.xy;
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
    const [minX, minY, maxX, maxY] = this.tin.bounds;
    if (x < minX || x > maxX || y < minY || y > maxY) {
      return null;
    }
    const col = Math.min(this.cols - 1, Math.floor((x - minX) / this.cell));
    const row = Math.min(this.rows - 1, Math.floor((y - minY) / this.cell));
    const b = row * this.cols + col;
    const { triangles, z } = this.tin;
    const xy = this.xy;
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
      const EPS = 1e-9;
      if (u >= -EPS && w >= -EPS && u + w <= 1 + EPS) {
        return z[a] + u * (z[bb] - z[a]) + w * (z[c] - z[a]);
      }
    }
    return null;
  }
}
