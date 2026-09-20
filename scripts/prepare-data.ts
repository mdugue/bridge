/**
 * Prepares the tile block for the browser: copies the committed per-tile
 * artifacts from data/ into public/data/, and turns each DGM GeoTIFF into a
 * ready-to-upload heightfield (see lib/city/heightfield.ts) so the client
 * never decodes a 13 MB raster on the main thread. Runs ahead of `dev` and
 * `build`; public/data/ is gitignored to avoid duplicating ~100 MB in git.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { fromArrayBuffer } from "geotiff";
import {
  encodeHeightfield,
  HEIGHTFIELD_VERSION,
  type HeightfieldHeader,
  parseHeightfieldHeader,
} from "../lib/city/heightfield";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { tfwToBounds } from "../lib/city/tfw";
import {
  dgmSourceFiles,
  heightfieldDataFile,
  heightfieldHeaderFile,
  TILE_BLOCK,
  tileArtifacts,
} from "../lib/city/tile";

// The tile block and every per-tile artifact come from lib/city/tile.ts — the
// one list the client requests from as well, so a tile or artifact added there
// is prepared here. Land-cover/canopy/lamps/… are baked offline by the
// scripts/extract-*.sh bakes; the raw downloads stay gitignored, only these
// small per-tile outputs are committed + copied.
const OUT_DIR = "public/data";

const artifacts = TILE_BLOCK.flatMap((spec) =>
  Object.values(tileArtifacts(spec)).filter((a) => a.source !== null)
);
// The DGM is NOT copied: it is baked into a heightfield below.
const copies: [string, string][] = artifacts
  .filter((a) => a.required)
  .map((a) => [`data/${a.source}/${a.file}`, join(OUT_DIR, a.file)]);
// Optional artifacts: a tile may not have been baked yet — copy when present,
// warn but never fail; the loader treats a missing file as "feature off".
const optionalCopies: [string, string][] = artifacts
  .filter((a) => !a.required)
  .map((a) => [`data/${a.source}/${a.file}`, join(OUT_DIR, a.file)]);

for (const [src, dest] of copies) {
  const srcPath = join(process.cwd(), src);
  const destPath = join(process.cwd(), dest);
  if (!existsSync(srcPath)) {
    process.stderr.write(`prepare-data: missing source file ${src}\n`);
    process.exit(1);
  }
  const upToDate =
    existsSync(destPath) && statSync(destPath).size === statSync(srcPath).size;
  if (upToDate) {
    continue;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
  process.stdout.write(`prepare-data: copied ${src} -> ${dest}\n`);
}

for (const [src, dest] of optionalCopies) {
  const srcPath = join(process.cwd(), src);
  const destPath = join(process.cwd(), dest);
  if (!existsSync(srcPath)) {
    // public/data/ is persistent and gitignored, so a copy from an earlier bake
    // would keep being served after its source was removed — the loader would
    // never see the "feature off" fallback it is supposed to degrade to.
    if (existsSync(destPath)) {
      rmSync(destPath);
      process.stdout.write(
        `prepare-data: optional source gone, removed stale ${dest}\n`
      );
    } else {
      process.stdout.write(
        `prepare-data: optional source absent, skipping ${src}\n`
      );
    }
    continue;
  }
  const upToDate =
    existsSync(destPath) && statSync(destPath).size === statSync(srcPath).size;
  if (upToDate) {
    continue;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
  process.stdout.write(`prepare-data: copied ${src} -> ${dest}\n`);
}

// --- DGM -> heightfield -------------------------------------------------
// The browser used to fetch each tile's 13.6 MB GeoTIFF and resample it on the
// main thread (~0.6 s per tile, x4 tiles). Doing it here leaves the client with
// a header plus a raw float32 grid it can upload as is.

/** True when getBoundingBox() returned pixel indices instead of map units. */
function isPixelSpaceBounds(
  bounds: number[],
  width: number,
  height: number
): boolean {
  const [minX, minY, maxX, maxY] = bounds;
  return (
    Math.abs(minX) <= 1 &&
    Math.abs(minY) <= 1 &&
    Math.abs(maxX - width) <= 1 &&
    Math.abs(maxY - height) <= 1
  );
}

function fail(message: string): never {
  process.stderr.write(`prepare-data: ${message}\n`);
  process.exit(1);
}

function readArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * The raster's georeferenced bounds. geotiff.js cannot read .tfw sidecars, so
 * when a GeoTIFF carries no embedded geotransform we parse the sidecar here —
 * and fail loudly rather than silently misplace a tile.
 */
function resolveBounds(
  embedded: number[] | null,
  width: number,
  height: number,
  tfwPath: string
): TerrainBounds {
  if (embedded && !isPixelSpaceBounds(embedded, width, height)) {
    return embedded as TerrainBounds;
  }
  if (existsSync(tfwPath)) {
    return tfwToBounds(readFileSync(tfwPath, "utf8"), width, height);
  }
  return fail(
    "DGM GeoTIFF has no embedded georeferencing and no readable .tfw sidecar. " +
      "Embed it with: gdal_translate -a_srs EPSG:25833 in.tif out.tif"
  );
}

/** True when `dest` is missing or older than any of its sources. */
function isStale(dest: string, ...sources: string[]): boolean {
  if (!existsSync(dest)) {
    return true;
  }
  const destTime = statSync(dest).mtimeMs;
  return sources.some(
    (src) => existsSync(src) && statSync(src).mtimeMs > destTime
  );
}

/** A previously written header is only reusable if it still parses at this version. */
function headerIsCurrent(path: string): boolean {
  try {
    return (
      parseHeightfieldHeader(JSON.parse(readFileSync(path, "utf8"))).version ===
      HEIGHTFIELD_VERSION
    );
  } catch {
    return false;
  }
}

async function bakeHeightfield(tile: string, n: number): Promise<void> {
  const source = dgmSourceFiles(tile);
  const tifPath = join(process.cwd(), source.tif);
  const tfwPath = join(process.cwd(), source.tfw);
  if (!existsSync(tifPath)) {
    fail(`missing source file ${tifPath}`);
  }
  const headerPath = join(
    process.cwd(),
    OUT_DIR,
    heightfieldHeaderFile(tile, n)
  );
  const dataPath = join(process.cwd(), OUT_DIR, heightfieldDataFile(tile, n));
  const stale =
    isStale(headerPath, tifPath, tfwPath) ||
    isStale(dataPath, tifPath, tfwPath) ||
    !headerIsCurrent(headerPath);
  if (!stale) {
    return;
  }

  const tiff = await fromArrayBuffer(readArrayBuffer(tifPath));
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  let embedded: number[] | null = null;
  try {
    embedded = image.getBoundingBox();
  } catch {
    embedded = null;
  }
  const bounds = resolveBounds(embedded, width, height, tfwPath);
  const raster = await image.readRasters({
    width: n,
    height: n,
    samples: [0],
    interleave: true,
    resampleMethod: "bilinear",
  });
  if (!ArrayBuffer.isView(raster)) {
    fail(`unexpected raster shape for ${tile}`);
  }
  // reason: geotiff types the result as TypedArray | TypedArray[]; isView narrowed it above
  const encoded = encodeHeightfield(
    raster as unknown as ArrayLike<number>,
    image.getGDALNoData()
  );
  const header: HeightfieldHeader = {
    version: HEIGHTFIELD_VERSION,
    n,
    bounds,
    data: heightfieldDataFile(tile, n),
    zMin: encoded.zMin,
    zScale: encoded.zScale,
  };
  mkdirSync(dirname(dataPath), { recursive: true });
  // Pre-gzipped: static hosts don't compress binary MIME types, and the
  // browser inflates it natively (DecompressionStream) — see heightfield.ts.
  writeFileSync(dataPath, gzipSync(Buffer.from(encoded.samples.buffer)));
  writeFileSync(headerPath, `${JSON.stringify(header, null, 2)}\n`);
  process.stdout.write(
    `prepare-data: built ${heightfieldHeaderFile(tile, n)} (${n}x${n} from ${width}x${height}, bounds [${bounds.join(", ")}])\n`
  );
}

for (const { tile, n } of TILE_BLOCK) {
  await bakeHeightfield(tile, n);
}
