import type { TerrainBounds } from "./terrain-geometry";

/**
 * Preprocessed DGM heightfield: produced by scripts/prepare-data.ts at build
 * time and read by app/_components/terrain-layer.ts. Two files next to each
 * other:
 *  - <name>.heightfield-<n>.json   — this header
 *  - <name>.heightfield-<n>.u16.gz — n*n little-endian uint16 samples,
 *    row-major, row 0 = north (the GeoTIFF convention, which is what
 *    terrain-geometry.ts expects), gzip-compressed.
 *
 * Samples are quantised: elevation = zMin + value * zScale (centimetre steps
 * by default), and 0xFFFF marks NoData. Half the bytes of float32 and, unlike
 * noise-like floats, the integers gzip well (a 1024² tile: 4 MB → ~1 MB on
 * the wire). The gzip is baked into the file rather than left to the server
 * because static hosts only compress "text-like" MIME types — the float32
 * blob used to travel uncompressed. The browser inflates it with the native
 * DecompressionStream.
 *
 * Little-endian is assumed on both sides: every browser and Bun target this
 * app supports is little-endian, and a byte-swapping reader would cost a copy
 * of the whole raster on the main thread. No THREE, no DOM.
 */
export const HEIGHTFIELD_VERSION = 2;

/** Default vertical quantisation step (m). */
export const HEIGHTFIELD_Z_SCALE = 0.01;

/** The uint16 value reserved for NoData. */
export const HEIGHTFIELD_NODATA = 0xff_ff;

export interface HeightfieldHeader {
  /** [minX, minY, maxX, maxY] in the projected CRS (EPSG:25833 for Saxony) */
  bounds: TerrainBounds;
  /** file name of the gzipped uint16 samples, relative to the header's directory */
  data: string;
  /** grid size (n x n) */
  n: number;
  version: typeof HEIGHTFIELD_VERSION;
  /** elevation of quantised value 0 (m) */
  zMin: number;
  /** metres per quantisation step */
  zScale: number;
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

function parseFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(`${name} must be a finite number, got ${String(value)}`);
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
  const zScale = parseFinite(raw.zScale, "zScale");
  if (zScale <= 0) {
    return invalid(`zScale must be positive, got ${zScale}`);
  }
  return {
    version: HEIGHTFIELD_VERSION,
    n,
    bounds: parseBounds(raw.bounds),
    data: parseDataName(raw.data),
    zMin: parseFinite(raw.zMin, "zMin"),
    zScale,
  };
}

export interface EncodedHeightfield {
  samples: Uint16Array;
  zMin: number;
  zScale: number;
}

/**
 * Quantises raster samples for storage: NoData and non-finite values become
 * the 0xFFFF sentinel, everything else `round((z - zMin) / zScale)`. The step
 * widens beyond `zScale` only when the tile's relief would not fit 16 bits
 * (655 m at 1 cm) — the header carries the step actually used.
 */
export function encodeHeightfield(
  samples: ArrayLike<number>,
  nodata: number | null,
  zScale: number = HEIGHTFIELD_Z_SCALE
): EncodedHeightfield {
  const isBad = (z: number) =>
    !Number.isFinite(z) || (nodata !== null && z === nodata);
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;
  for (const z of Array.from(samples)) {
    if (!isBad(z)) {
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
    }
  }
  if (!Number.isFinite(zMin)) {
    zMin = 0;
    zMax = 0;
  }
  const scale = Math.max(zScale, (zMax - zMin) / (HEIGHTFIELD_NODATA - 1));
  const out = new Uint16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const z = samples[i];
    out[i] = isBad(z)
      ? HEIGHTFIELD_NODATA
      : Math.min(HEIGHTFIELD_NODATA - 1, Math.round((z - zMin) / scale));
  }
  return { samples: out, zMin, zScale: scale };
}

/** Inflated uint16 bytes → float32 elevations, NoData as NaN. */
export function decodeHeightfield(
  buffer: ArrayBuffer,
  header: Pick<HeightfieldHeader, "n" | "zMin" | "zScale">
): Float32Array {
  const { n, zMin, zScale } = header;
  const expected = n * n * 2;
  if (buffer.byteLength !== expected) {
    throw new Error(
      `Heightfield size mismatch: expected ${expected} bytes, got ${buffer.byteLength}`
    );
  }
  const raw = new Uint16Array(buffer);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    out[i] = v === HEIGHTFIELD_NODATA ? Number.NaN : zMin + v * zScale;
  }
  return out;
}

/** Replaces the last path segment of `headerUrl` with a sibling file name. */
export function resolveSiblingUrl(headerUrl: string, file: string): string {
  const cut = headerUrl.lastIndexOf("/");
  return cut === -1 ? file : `${headerUrl.slice(0, cut + 1)}${file}`;
}
