/**
 * The building bake's vertex stream (`CityVertices`: non-indexed triangles,
 * one attribute array per column) and the only code that knows its list of
 * attributes: `appended` (parts after the stream), `streamWriter` (a
 * stream rebuilt triangle by triangle), `emptyStream` and `copyVertices`
 * (a stream cut in place, scripts/city-passages.ts). Everything is written
 * straight into typed arrays: a dense tile's stream runs to millions of
 * vertices, and a copy through plain arrays held eight bytes a number
 * beside it. Used by scripts/bake-city-mesh.ts and its parts; no DOM.
 */

/** The mesh as non-indexed triangles, flat per-face vertices. */
export interface CityVertices {
  /** per vertex where it lies on its wall, for the windows (4 × snorm16,
   *  lib/city/windows.ts `facadeAttribute`); absent: no windows */
  facade?: Int16Array<ArrayBuffer>;
  /** 1 on RoofSurface vertices, 0 elsewhere */
  isRoof: Float32Array<ArrayBuffer>;
  /** per vertex, a normal to shade with in place of the triangle's flat
   *  one (a measured face's, smoothed over it); NaN or absent: flat */
  normals?: Float32Array<ArrayBuffer>;
  /** index into the object table */
  objectIds: Float32Array<ArrayBuffer>;
  /** recentered data-frame (Z-up) positions, 3 per vertex */
  positions: Float32Array<ArrayBuffer>;
  /** per vertex its roof face's own colour (linear RGB, 3 a vertex; NaN:
   *  the object's), read from the orthophoto face by face
   *  (`withFaceRoofColours`), and the rebuilt roofs' parts
   *  (`withMeasuredRoofs`). Only the vertices at the stream's start carry
   *  one: whatever is appended after them has none. */
  roofRgb?: Float32Array<ArrayBuffer>;
  /** per LoD2 vertex the loader's surface it lies on: its geometry's index
   *  in the object and the surface's in the geometry (2 a vertex) */
  surfaces?: Float32Array<ArrayBuffer>;
}

/** Triangles to append to a stream. */
export interface StreamPart {
  /** the object they belong to, or one a vertex */
  id: number | ArrayLike<number>;
  /** per vertex 1 on a roof (absent: none is) */
  isRoof?: ArrayLike<number>;
  /** per vertex a normal to shade with (NaN, or absent: flat) */
  normals?: ArrayLike<number>;
  /** flat x, y, z */
  positions: ArrayLike<number>;
}

/**
 * The stream with `parts` after it. Its normals run on where it carries
 * any or a part brings some (flat, NaN, wherever neither says); the roof
 * faces' own colours stay the stream's start's; the loader's surfaces and
 * the places on the walls are not carried (the first is read before
 * anything is appended, the second written after everything is).
 */
export function appended(
  v: CityVertices,
  parts: readonly StreamPart[]
): CityVertices {
  const own = v.objectIds.length;
  const total = parts.reduce((n, p) => n + p.positions.length / 3, own);
  const positions = new Float32Array(3 * total);
  const objectIds = new Float32Array(total);
  const isRoof = new Float32Array(total);
  positions.set(v.positions);
  objectIds.set(v.objectIds);
  isRoof.set(v.isRoof);
  let normals: Float32Array<ArrayBuffer> | undefined;
  if (v.normals || parts.some((p) => p.normals)) {
    normals = new Float32Array(3 * total).fill(Number.NaN);
    if (v.normals) {
      normals.set(v.normals);
    }
  }
  let at = own;
  for (const p of parts) {
    const n = p.positions.length / 3;
    positions.set(p.positions, 3 * at);
    if (typeof p.id === "number") {
      objectIds.fill(p.id, at, at + n);
    } else {
      objectIds.set(p.id, at);
    }
    if (p.isRoof) {
      isRoof.set(p.isRoof, at);
    }
    if (p.normals && normals) {
      normals.set(p.normals, 3 * at);
    }
    at += n;
  }
  return {
    positions,
    objectIds,
    isRoof,
    ...(normals && { normals }),
    ...(v.roofRgb && { roofRgb: v.roofRgb }),
  };
}

/** A column that grows as it is written. */
class Column {
  private data: Float32Array<ArrayBuffer>;
  private length = 0;
  private readonly unset: number;

  constructor(capacity: number, unset: number) {
    this.data = new Float32Array(capacity);
    this.unset = unset;
  }

  /** room for `n` more values, each unset */
  private grow(n: number): number {
    const start = this.length;
    const end = start + n;
    if (end > this.data.length) {
      const next = new Float32Array(Math.max(end, 2 * this.data.length));
      next.set(this.data.subarray(0, start));
      this.data = next;
    }
    this.length = end;
    return start;
  }

  /** `values`, or `n` unset ones where there are none */
  push(values: ArrayLike<number> | undefined, n: number): void {
    const start = this.grow(n);
    // (a roof colour column ends where the stream's start does)
    if (!values || values.length < n) {
      this.data.fill(this.unset, start, start + n);
    }
    if (values) {
      this.data.set(values, start);
    }
  }

  fill(value: number, n: number): void {
    const start = this.grow(n);
    this.data.fill(value, start, start + n);
  }

  done(): Float32Array<ArrayBuffer> {
    return this.data.slice(0, this.length);
  }
}

/** `count` vertices of column `a` (`n` values a vertex) from vertex `i`. */
const span = (
  a: Float32Array | undefined,
  i: number,
  count: number,
  n: number
) => a?.subarray(n * i, n * (i + count));

/** Which of the optional attributes a written stream carries. */
export interface StreamAttributes {
  normals: boolean;
  roofRgb: boolean;
  surfaces: boolean;
}

/** What a new triangle list brings beside its positions. */
export interface NewTriangles {
  /** per vertex 1 on a roof, or one flag for all (absent: none is) */
  isRoof?: number | ArrayLike<number>;
  /** the old vertex whose loader surface they lie on */
  like?: number;
  /** per vertex a normal to shade with (absent: flat) */
  normals?: ArrayLike<number>;
  /** per vertex a roof colour (absent: the object's) */
  roofRgb?: ArrayLike<number>;
}

/**
 * Builds a stream from an old one's vertices (`copy`) and new triangles
 * (`add`), in the order they are given; `carries` says which optional
 * attributes it has (a stream's own by default). A vertex the old stream
 * has no normal, roof colour or surface for carries none (NaN, NaN, −1).
 */
export function streamWriter(v: CityVertices, has?: StreamAttributes) {
  const carries = has ?? {
    normals: v.normals !== undefined,
    roofRgb: v.roofRgb !== undefined,
    surfaces: v.surfaces !== undefined,
  };
  const room = v.objectIds.length;
  const positions = new Column(3 * room, 0);
  const objectIds = new Column(room, 0);
  const isRoof = new Column(room, 0);
  const normals = carries.normals ? new Column(3 * room, Number.NaN) : null;
  const roofRgb = carries.roofRgb ? new Column(3 * room, Number.NaN) : null;
  const surfaces = carries.surfaces ? new Column(2 * room, -1) : null;
  return {
    /** `count` vertices of the old stream from `i` on, as they were */
    copy(i: number, count: number): void {
      if (count <= 0) {
        return;
      }
      positions.push(span(v.positions, i, count, 3), 3 * count);
      objectIds.push(span(v.objectIds, i, count, 1), count);
      isRoof.push(span(v.isRoof, i, count, 1), count);
      normals?.push(span(v.normals, i, count, 3), 3 * count);
      roofRgb?.push(span(v.roofRgb, i, count, 3), 3 * count);
      surfaces?.push(span(v.surfaces, i, count, 2), 2 * count);
    },
    /** new triangles (flat x, y, z) of object `o` */
    add(xyz: ArrayLike<number>, o: number, more: NewTriangles = {}): void {
      const count = xyz.length / 3;
      if (count === 0) {
        return;
      }
      // (a stray coordinate would shift every column of every later part)
      if (!Number.isInteger(count)) {
        throw new Error(`a part of ${xyz.length} coordinates is no triangles`);
      }
      positions.push(xyz, 3 * count);
      objectIds.fill(o, count);
      if (typeof more.isRoof === "object") {
        isRoof.push(more.isRoof, count);
      } else {
        isRoof.fill(more.isRoof ?? 0, count);
      }
      normals?.push(more.normals, 3 * count);
      roofRgb?.push(more.roofRgb, 3 * count);
      if (surfaces) {
        const s = v.surfaces;
        const at = more.like;
        for (let k = 0; k < count; k += 1) {
          surfaces.push(
            s && at !== undefined ? s.subarray(2 * at, 2 * at + 2) : undefined,
            2
          );
        }
      }
    },
    done(): CityVertices {
      return {
        positions: positions.done(),
        objectIds: objectIds.done(),
        isRoof: isRoof.done(),
        ...(normals && { normals: normals.done() }),
        ...(roofRgb && { roofRgb: roofRgb.done() }),
        ...(surfaces && { surfaces: surfaces.done() }),
      };
    },
  };
}

/** A stream of `total` vertices with `v`'s attributes, unset: no normal
 *  (NaN), roof colour or surface. */
export function emptyStream(v: CityVertices, total: number): CityVertices {
  return {
    positions: new Float32Array(3 * total),
    objectIds: new Float32Array(total),
    isRoof: new Float32Array(total),
    ...(v.normals && {
      normals: new Float32Array(3 * total).fill(Number.NaN),
    }),
    ...(v.roofRgb && {
      roofRgb: new Float32Array(3 * total).fill(Number.NaN),
    }),
    ...(v.surfaces && { surfaces: new Float32Array(2 * total).fill(-1) }),
    ...(v.facade && { facade: new Int16Array(4 * total) }),
  };
}

/** `n` vertices of `from` from vertex `i`, every attribute, to vertex `at`
 *  of `to`. */
export function copyVertices(
  from: CityVertices,
  i: number,
  n: number,
  to: CityVertices,
  at: number
): void {
  if (n <= 0) {
    return;
  }
  to.positions.set(from.positions.subarray(3 * i, 3 * (i + n)), 3 * at);
  to.objectIds.set(from.objectIds.subarray(i, i + n), at);
  to.isRoof.set(from.isRoof.subarray(i, i + n), at);
  if (to.normals && from.normals) {
    to.normals.set(from.normals.subarray(3 * i, 3 * (i + n)), 3 * at);
  }
  // only the stream's first vertices carry a roof colour
  const rgbEnd = Math.min(3 * (i + n), from.roofRgb?.length ?? 0);
  if (to.roofRgb && from.roofRgb && rgbEnd > 3 * i) {
    to.roofRgb.set(from.roofRgb.subarray(3 * i, rgbEnd), 3 * at);
  }
  if (to.surfaces && from.surfaces) {
    to.surfaces.set(from.surfaces.subarray(2 * i, 2 * (i + n)), 2 * at);
  }
  if (to.facade && from.facade) {
    to.facade.set(from.facade.subarray(4 * i, 4 * (i + n)), 4 * at);
  }
}
