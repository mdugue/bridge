/**
 * What a streamed terrain level's dressing works out from its glTF before
 * it can show (app/_components/terrain-layer.ts `dressTerrain`): the
 * ground's heights in the data frame — a grid level's elevations, a TIN's
 * projected vertices for its height index — and, with the class raster's
 * water cells, the triangles the water and mist sheets keep and the boxes
 * around them. Every number comes from the positions as stored (quantised,
 * maybe interleaved) and the level's local → data matrix, in flat loops
 * over typed arrays: it runs in the ground worker
 * (app/_components/ground-worker.ts), off the main thread, where it was
 * the longest task of a flight (a fine level's 1 M index entries read
 * through three's per-vertex accessors: up to 1.4 s on a phone). No
 * THREE, no DOM.
 */
import { planTriangles } from "./terrain-tin";
import {
  MIST_REACH_M,
  reach,
  trianglesOver,
  WATER_REACH_M,
  type WaterMask,
} from "./water-mask";

export type GroundIndex = Uint16Array | Uint32Array;
export type GroundPositions =
  | Float32Array
  | Int16Array
  | Int8Array
  | Uint16Array
  | Uint8Array;

export interface GroundPrepInput {
  /** the positions as stored: `stride` numbers per vertex, x at `offset` */
  positions: GroundPositions;
  stride: number;
  offset: number;
  count: number;
  /** whether the stored integers stand for [-1, 1] / [0, 1] (glTF) */
  normalized: boolean;
  /** the level's triangles (a grid's: the site's shared index) */
  index: GroundIndex | null;
  /** local → data frame, column-major (three's `Matrix4.elements`) */
  toData: ArrayLike<number>;
  /** the site's recentre offset: data + offset = projected */
  origin: { cx: number; cy: number };
  /** [minX, minY, maxX, maxY], projected */
  bounds: readonly [number, number, number, number];
  /** a grid level's side (its first n² vertices are the grid); null for a
   *  TIN */
  grid: number | null;
  /** the tile's water cells: with them, the sheets' triangles */
  mask: WaterMask | null;
}

/** A sheet: its triangles and the box around them (local frame: minX,
 *  minY, minZ, maxX, maxY, maxZ — what three's `Box3` takes). */
export interface SheetPrep {
  index: GroundIndex;
  box: Float64Array;
}

export interface GroundPrep {
  /** a grid level's elevations (m), row-major */
  elevations?: Float32Array;
  /** a TIN's projected x, y per vertex and their elevations (m) */
  xy?: Float64Array;
  z?: Float32Array;
  /** the water's and the mist's triangles, where the tile has water */
  water?: SheetPrep;
  mist?: SheetPrep;
}

/** What a stored integer is divided by (three's `denormalize`). */
function scaleOf(positions: GroundPositions, normalized: boolean): number {
  if (!normalized) {
    return 1;
  }
  if (positions instanceof Int16Array) {
    return 32_767;
  }
  if (positions instanceof Uint16Array) {
    return 65_535;
  }
  if (positions instanceof Int8Array) {
    return 127;
  }
  if (positions instanceof Uint8Array) {
    return 255;
  }
  return 1;
}

/** Reads a vertex's local position into `out`, as three's
 *  `fromBufferAttribute` reads it (`denormalize`, in doubles). */
export type VertexReader = (i: number, out: Float64Array) => void;

export function localReader(input: GroundPrepInput): VertexReader {
  const { positions, stride, offset } = input;
  const scale = scaleOf(positions, input.normalized);
  const clamp =
    scale !== 1 &&
    (positions instanceof Int16Array || positions instanceof Int8Array);
  return (i, out) => {
    const at = i * stride + offset;
    for (let k = 0; k < 3; k++) {
      const v = positions[at + k] / scale;
      out[k] = clamp ? Math.max(v, -1) : v;
    }
  };
}

/** A local position mapped to the data frame (x east, y north, z up) by a
 *  column-major matrix, into `out` (three's `applyMatrix4`). */
export function toDataFrame(
  e: ArrayLike<number>,
  local: Float64Array,
  out: Float64Array
): void {
  const x = local[0];
  const y = local[1];
  const z = local[2];
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
  out[0] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
  out[1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
  out[2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
}

/** The box (local frame) around the vertices `index` names. */
export function indexBox(index: GroundIndex, read: VertexReader): Float64Array {
  const box = new Float64Array([
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]);
  const v = new Float64Array(3);
  for (let i = 0; i < index.length; i++) {
    read(index[i], v);
    for (let k = 0; k < 3; k++) {
      if (v[k] < box[k]) {
        box[k] = v[k];
      }
      if (v[k] > box[k + 3]) {
        box[k + 3] = v[k];
      }
    }
  }
  return box;
}

/**
 * Each vertex's mask cell (x east, y south from the tile's north edge),
 * from its projected position (`projected`, into the scratch it is given).
 */
function vertexCells(
  count: number,
  projected: (i: number, out: Float64Array) => void,
  bounds: readonly [number, number, number, number],
  cells: number
): { x: Uint16Array; y: Uint16Array } {
  const [minX, minY, maxX, maxY] = bounds;
  const x = new Uint16Array(count);
  const y = new Uint16Array(count);
  const sx = cells / (maxX - minX);
  const sy = cells / (maxY - minY);
  const p = new Float64Array(3);
  for (let i = 0; i < count; i++) {
    projected(i, p);
    const cx = Math.floor((p[0] - minX) * sx);
    const cy = Math.floor((maxY - p[1]) * sy);
    x[i] = Math.min(cells - 1, Math.max(0, cx));
    y[i] = Math.min(cells - 1, Math.max(0, cy));
  }
  return { x, y };
}

/** The water and mist sheets' triangles over the tile's water cells. */
function sheetsOf(
  input: GroundPrepInput,
  index: GroundIndex,
  read: VertexReader,
  projected: (i: number, out: Float64Array) => void,
  mask: WaterMask
): { water: SheetPrep; mist: SheetPrep } {
  const cells = vertexCells(input.count, projected, input.bounds, mask.cells);
  const tileM = input.bounds[2] - input.bounds[0];
  // the ground's triangles with area in plan (no skirt), once for both
  const plan = planTriangles(
    index,
    input.positions,
    input.stride,
    input.offset
  );
  const sheet = (metres: number): SheetPrep => {
    const kept = trianglesOver(
      plan,
      cells.x,
      cells.y,
      reach(mask, metres, tileM)
    );
    return { index: kept, box: indexBox(kept, read) };
  };
  return { water: sheet(WATER_REACH_M), mist: sheet(MIST_REACH_M) };
}

/**
 * Everything above for one terrain level. Nothing the size of the mesh
 * beyond what it returns: a grid reads its first n² vertices for their
 * heights, a TIN keeps its projected vertices (its height index reads
 * them), and the sheets' cells are read from those or, on a grid, from
 * each vertex in turn.
 */
export function prepareGround(input: GroundPrepInput): GroundPrep {
  const read = localReader(input);
  const { cx, cy } = input.origin;
  const local = new Float64Array(3);
  const data = new Float64Array(3);
  // vertex i in the data frame, into `data`
  const atData = (i: number) => {
    read(i, local);
    toDataFrame(input.toData, local, data);
  };
  const out: GroundPrep = {};
  let projected: (i: number, p: Float64Array) => void;
  if (input.grid !== null) {
    const elevations = new Float32Array(input.grid * input.grid);
    for (let i = 0; i < elevations.length; i++) {
      atData(i);
      elevations[i] = data[2];
    }
    out.elevations = elevations;
    projected = (i, p) => {
      atData(i);
      p[0] = data[0] + cx;
      p[1] = data[1] + cy;
    };
  } else {
    const count = input.count;
    const xy = new Float64Array(count * 2);
    const z = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      atData(i);
      xy[2 * i] = data[0] + cx;
      xy[2 * i + 1] = data[1] + cy;
      z[i] = data[2];
    }
    out.xy = xy;
    out.z = z;
    projected = (i, p) => {
      p[0] = xy[2 * i];
      p[1] = xy[2 * i + 1];
    };
  }
  if (input.mask && input.index) {
    const { water, mist } = sheetsOf(
      input,
      input.index,
      read,
      projected,
      input.mask
    );
    out.water = water;
    out.mist = mist;
  }
  return out;
}

/** The buffers of a result, to hand over without a copy (postMessage). */
export function groundPrepTransfer(prep: GroundPrep): ArrayBuffer[] {
  return [
    prep.elevations,
    prep.xy,
    prep.z,
    prep.water?.index,
    prep.water?.box,
    prep.mist?.index,
    prep.mist?.box,
  ]
    .filter((a): a is NonNullable<typeof a> => a !== undefined)
    .map((a) => a.buffer as ArrayBuffer);
}
