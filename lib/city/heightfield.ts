import type { TerrainBounds } from "./terrain-geometry";

/**
 * Preprocessed DGM heightfield: produced by scripts/prepare-data.ts at build
 * time and read by app/_components/terrain-layer.ts. Two files next to each
 * other:
 *  - <name>.heightfield-<n>.json — this header
 *  - <name>.heightfield-<n>.f32  — n*n little-endian float32 samples,
 *    row-major, row 0 = north (the GeoTIFF convention, which is what
 *    terrain-geometry.ts expects); NoData is stored as NaN.
 *
 * Little-endian is assumed on both sides: every browser and Bun target this
 * app supports is little-endian, and a byte-swapping reader would cost a copy
 * of the whole raster on the main thread — the very thing this format exists
 * to avoid. No THREE, no DOM.
 */
export const HEIGHTFIELD_VERSION = 1;

export interface HeightfieldHeader {
  /** [minX, minY, maxX, maxY] in the projected CRS (EPSG:25833 for Saxony) */
  bounds: TerrainBounds;
  /** file name of the .f32 samples, relative to the header's directory */
  data: string;
  /** grid size (n x n) */
  n: number;
  version: typeof HEIGHTFIELD_VERSION;
}

function invalid(reason: string): never {
  throw new Error(`Invalid heightfield header: ${reason}`);
}

function parseBounds(value: unknown): TerrainBounds {
  if (!(Array.isArray(value) && value.length === 4)) {
    return invalid("bounds must be an array of 4 numbers");
  }
  const bounds = value as number[];
  if (!bounds.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return invalid("bounds must be finite numbers");
  }
  const [minX, minY, maxX, maxY] = bounds;
  if (maxX <= minX || maxY <= minY) {
    return invalid(`degenerate bounds [${bounds.join(", ")}]`);
  }
  return [minX, minY, maxX, maxY];
}

function parseDataName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalid("data must be a non-empty file name");
  }
  // The name is joined onto the header's URL, so it must stay a sibling:
  // no directory traversal, no absolute path.
  if (value.includes("/") || value.includes("..")) {
    return invalid(`data must be a bare file name, got "${value}"`);
  }
  return value;
}

export function parseHeightfieldHeader(json: unknown): HeightfieldHeader {
  if (typeof json !== "object" || json === null) {
    return invalid("not an object");
  }
  const raw = json as Record<string, unknown>;
  if (raw.version !== HEIGHTFIELD_VERSION) {
    return invalid(
      `version ${String(raw.version)} (expected ${HEIGHTFIELD_VERSION})`
    );
  }
  const n = raw.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    return invalid(`n must be a positive integer, got ${String(n)}`);
  }
  return {
    version: HEIGHTFIELD_VERSION,
    n,
    bounds: parseBounds(raw.bounds),
    data: parseDataName(raw.data),
  };
}

/**
 * Normalises raster samples for storage: NoData and non-finite values become
 * NaN, so the reader needs no nodata sentinel (terrain-geometry treats
 * non-finite as a hole).
 */
export function encodeHeightfield(
  samples: ArrayLike<number>,
  nodata: number | null
): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const z = samples[i];
    const bad = !Number.isFinite(z) || (nodata !== null && z === nodata);
    out[i] = bad ? Number.NaN : z;
  }
  return out;
}

export function decodeHeightfield(
  buffer: ArrayBuffer,
  n: number
): Float32Array {
  const expected = n * n * 4;
  if (buffer.byteLength !== expected) {
    throw new Error(
      `Heightfield size mismatch: expected ${expected} bytes, got ${buffer.byteLength}`
    );
  }
  return new Float32Array(buffer);
}

/** Replaces the last path segment of `headerUrl` with a sibling file name. */
export function resolveSiblingUrl(headerUrl: string, file: string): string {
  const cut = headerUrl.lastIndexOf("/");
  return cut === -1 ? file : `${headerUrl.slice(0, cut + 1)}${file}`;
}
