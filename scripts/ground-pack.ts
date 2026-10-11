/**
 * A tile's fine ground as scripts/prepare-data.ts caches it: the TIN its
 * fine level is meshed from (bake-tiles.ts `fineTin`), or the shaped grid
 * where the DGM has NoData — one binary entry holding their typed arrays as
 * they are, so the mesh and the ground height rebuilt from it (`tinMesh`,
 * `tinHeightAt`, `gridMesh`, `gridHeightAt`) are the very ones the bake
 * built. Every fine level's walls, kerbs, stairs and fences stand on the
 * whole site's ground: a process baking a few tiles loads the others'
 * from here instead of refining their TINs again.
 *
 * Layout: a header of float64s — version, kind, bounds, n and the length of
 * each array — then the arrays, each at a multiple of 8 bytes.
 */
import { closeSync, openSync, readSync } from "node:fs";
import type { TerrainTin } from "../lib/city/terrain-tin";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import type { ShapedGrid } from "./bake-tiles";

export type FineGround =
  | { kind: "tin"; tin: TerrainTin }
  | { kind: "grid"; grid: ShapedGrid };

/** What the header alone says: enough to find the tile owning a point. */
export interface GroundHeader {
  bounds: TerrainBounds;
  kind: FineGround["kind"];
}

const VERSION = 1;
const KINDS: FineGround["kind"][] = ["tin", "grid"];
/** version, kind, 4 bounds, n, 4 array lengths */
const HEADER_NUMBERS = 11;
const HEADER_BYTES = HEADER_NUMBERS * 8;

type Packed = Uint16Array | Uint32Array | Float32Array;

const align = (bytes: number) => Math.ceil(bytes / 8) * 8;

function arraysOf(ground: FineGround): {
  arrays: Packed[];
  bounds: TerrainBounds;
  n: number;
} {
  if (ground.kind === "tin") {
    const { bounds, gx, gy, n, triangles, z } = ground.tin;
    return { arrays: [gx, gy, z, triangles], bounds, n };
  }
  const { bounds, elevations, n } = ground.grid;
  return { arrays: [elevations], bounds, n };
}

/** The ground as one cache entry. */
export function packGround(ground: FineGround): Uint8Array {
  const { arrays, bounds, n } = arraysOf(ground);
  const lengths = [0, 0, 0, 0];
  arrays.forEach((a, i) => {
    lengths[i] = a.length;
  });
  const size = arrays.reduce((sum, a) => sum + align(a.byteLength), 0);
  const out = new Uint8Array(HEADER_BYTES + size);
  new Float64Array(out.buffer, 0, HEADER_NUMBERS).set([
    VERSION,
    KINDS.indexOf(ground.kind),
    ...bounds,
    n,
    ...lengths,
  ]);
  let at = HEADER_BYTES;
  for (const a of arrays) {
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at);
    at += align(a.byteLength);
  }
  return out;
}

/** The header's numbers, checked. */
function headerOf(bytes: Uint8Array): Float64Array {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error("ground entry: shorter than its header");
  }
  // a copy from the view's own offset: a Buffer's slice() is a view, and
  // its buffer can start before the entry
  const header = new Float64Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + HEADER_BYTES)
  );
  if (header[0] !== VERSION || KINDS[header[1]] === undefined) {
    throw new Error(`ground entry: version ${header[0]}, kind ${header[1]}`);
  }
  return header;
}

function boundsOf(header: Float64Array): TerrainBounds {
  return [header[2], header[3], header[4], header[5]];
}

/** The ground a cache entry holds; its arrays are copies (aligned). */
export function unpackGround(bytes: Uint8Array): FineGround {
  const header = headerOf(bytes);
  const bounds = boundsOf(header);
  const n = header[6];
  let at = bytes.byteOffset + HEADER_BYTES;
  const take = <T extends Packed>(
    Kind: { BYTES_PER_ELEMENT: number; new (buffer: ArrayBuffer): T },
    length: number
  ): T => {
    const byteLength = length * Kind.BYTES_PER_ELEMENT;
    const copy = bytes.buffer.slice(at, at + byteLength) as ArrayBuffer;
    at += align(byteLength);
    return new Kind(copy);
  };
  if (KINDS[header[1]] === "grid") {
    return {
      kind: "grid",
      grid: { bounds, elevations: take(Float32Array, header[7]), n },
    };
  }
  // in the order packGround wrote them
  const gx = take(Uint16Array, header[7]);
  const gy = take(Uint16Array, header[8]);
  const z = take(Float32Array, header[9]);
  const triangles = take(Uint32Array, header[10]);
  return { kind: "tin", tin: { bounds, gx, gy, n, triangles, z } };
}

/** A cache entry's header, read from the file alone. */
export function readGroundHeader(path: string): GroundHeader {
  const bytes = new Uint8Array(HEADER_BYTES);
  const fd = openSync(path, "r");
  try {
    readSync(fd, bytes, 0, HEADER_BYTES, 0);
  } finally {
    closeSync(fd);
  }
  const header = headerOf(bytes);
  return { bounds: boundsOf(header), kind: KINDS[header[1]] };
}
