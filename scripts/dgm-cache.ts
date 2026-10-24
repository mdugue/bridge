/**
 * A tile's DGM read from its files, its decode kept by content. geotiff.js
 * decodes a committed DGM1 tile (LZW, one row per strip) in 0.6–0.8 s on
 * one thread, and the budget checks (scripts/line-levels.test.ts,
 * scripts/ground-joins.test.ts) read fifteen and nine of them: ten seconds
 * of every unit run went to decoding the same bytes. The decoded raster is
 * kept under `.cache/dgm/` (gitignored), keyed by the TIFF's and sidecar's
 * bytes, the size asked for, `DGM_DECODER` and geotiff's version — so a
 * changed tile, decoder or library takes a new key, and the stale entry is
 * dropped (one entry per tile and size, written whole: bake-cache.ts).
 *
 * The cache is opt-in: under `bun test` (NODE_ENV=test) or with
 * `DGM_CACHE=1` (the CLIs). The build decodes a tile once per bake and
 * keeps the bake's own result (scripts/prepare-data.ts), so it would only
 * fill the disk with every site's rasters — 16 MB a tile.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { cachedEntry, writeEntry } from "./bake-cache";
import { type Dgm, readDgm } from "./bake-tiles";

/** Bump when readDgm's decode changes what it returns for the same bytes
 *  (NoData handling, resampling, bounds): every entry is keyed by it. */
export const DGM_DECODER = 1;

/** geotiff's installed version: a new decoder is a new key. */
const GEOTIFF_VERSION = (
  JSON.parse(
    readFileSync(
      Bun.resolveSync("geotiff/package.json", import.meta.dir),
      "utf8"
    )
  ) as { version: string }
).version;

/** Where the decoded DGMs are kept, or null when the cache is off. */
export function dgmCacheDir(
  env: { DGM_CACHE?: string; NODE_ENV?: string } = process.env
): string | null {
  return env.NODE_ENV === "test" || env.DGM_CACHE === "1"
    ? join(process.cwd(), ".cache", "dgm")
    : null;
}

/** The key of a decode: the inputs' bytes and everything that decodes
 *  them. */
export function dgmKey(
  tif: Uint8Array,
  tfw: string | null,
  size: number | "native"
): string {
  return createHash("sha1")
    .update(`dgm ${DGM_DECODER} geotiff ${GEOTIFF_VERSION} ${size}\n`)
    .update(tfw ?? "")
    .update("\n")
    .update(tif)
    .digest("hex");
}

/** n, then the bounds, as doubles: the elevations follow, aligned. */
const HEADER = 5;

/** A decoded DGM as one entry's bytes. */
export function packDgm(dgm: Dgm): Uint8Array {
  const out = new Uint8Array(HEADER * 8 + dgm.elevations.byteLength);
  new Float64Array(out.buffer, 0, HEADER).set([dgm.n, ...dgm.bounds]);
  out.set(
    new Uint8Array(
      dgm.elevations.buffer,
      dgm.elevations.byteOffset,
      dgm.elevations.byteLength
    ),
    HEADER * 8
  );
  return out;
}

/** An entry's bytes back as the DGM; null when they are not one whole
 *  entry (a truncated file is read again from the TIFF). */
export function unpackDgm(bytes: Uint8Array): Dgm | null {
  if (bytes.byteLength < HEADER * 8) {
    return null;
  }
  // copied out: a Buffer's slice is a view into a shared pool
  const header = new Float64Array(HEADER);
  new Uint8Array(header.buffer).set(bytes.subarray(0, HEADER * 8));
  const [n, ...bounds] = header;
  if (!Number.isInteger(n) || bytes.byteLength !== HEADER * 8 + n * n * 4) {
    return null;
  }
  // an array that owns its buffer, as readDgm's does (and aligned, which a
  // view into the file's bytes need not be)
  const elevations = new Float32Array(n * n);
  new Uint8Array(elevations.buffer).set(bytes.subarray(HEADER * 8));
  return { bounds: bounds as Dgm["bounds"], elevations, n };
}

/**
 * The DGM at `tif` (with its `tfw` sidecar, when there is one) read at
 * `size`, as readDgm reads it — from the cache when `dir` holds the
 * decode of these very bytes.
 */
export async function readDgmFile(
  tif: string,
  tfw: string | null,
  size: number | "native",
  dir: string | null = dgmCacheDir()
): Promise<Dgm> {
  const bytes = readFileSync(tif);
  const sidecar =
    tfw !== null && existsSync(tfw) ? readFileSync(tfw, "utf8") : null;
  const key = dir === null ? "" : dgmKey(bytes, sidecar, size);
  const name = `${basename(tif)}.${size}.dgm`;
  const hit = dir === null ? null : cachedEntry(dir, name, key);
  const kept = hit === null ? null : unpackDgm(readFileSync(hit));
  if (kept !== null) {
    return kept;
  }
  const dgm = await readDgm(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    sidecar,
    size
  );
  if (dir !== null) {
    writeEntry(dir, name, key, packDgm(dgm));
  }
  return dgm;
}
