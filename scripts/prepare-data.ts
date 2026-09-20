/**
 * Prepares the tile block for the browser. Two stages:
 *
 *  1. **Bake** — every artifact the viewer may request (lib/city/tile.ts,
 *     `tileArtifacts`) is either a committed per-tile file under data/ or is
 *     produced here from one (the DGM GeoTIFF → heightfield, see
 *     lib/city/heightfield.ts). Baked outputs live in `.cache/prepare-data/`
 *     (gitignored) with mtime-based staleness, so a rerun is cheap.
 *  2. **Publish** — each artifact is copied into `public/data/` under a
 *     content-hashed name and `manifest.json` maps logical → hashed names.
 *     Hashed names let `/data/*` be served as immutable (next.config.ts) while
 *     a re-bake still reaches every client through the manifest. Stale files
 *     in public/data/ are pruned, so a removed optional source really turns
 *     its feature off instead of serving an old copy forever.
 *
 * Runs ahead of `dev` and `build`; public/data/ is gitignored.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { fromArrayBuffer } from "geotiff";
import type { Matrix4 } from "three";
import type { RoofColorLut } from "../lib/city/building-tint";
import {
  encodeHeightfield,
  HEIGHTFIELD_VERSION,
  type HeightfieldHeader,
  parseHeightfieldHeader,
} from "../lib/city/heightfield";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { tfwToBounds } from "../lib/city/tfw";
import {
  cityMeshDataFile,
  cityMeshMetaFile,
  cityMeshSourceFiles,
  type DataManifest,
  dgmSourceFiles,
  heightfieldDataFile,
  heightfieldHeaderFile,
  MANIFEST_FILE,
  TILE_BLOCK,
  tileArtifacts,
} from "../lib/city/tile";
import type { CityJsonDocument } from "../lib/city/types";
import { bakeCityMesh } from "./bake-city-mesh";

const OUT_DIR = "public/data";
const CACHE_DIR = ".cache/prepare-data";

function fail(message: string): never {
  process.stderr.write(`prepare-data: ${message}\n`);
  process.exit(1);
}

function log(message: string): void {
  process.stdout.write(`prepare-data: ${message}\n`);
}

// --- bake: copies ---------------------------------------------------------

/** Logical artifact name → the on-disk file to publish from (source or cache). */
const toPublish = new Map<string, string>();

const artifacts = TILE_BLOCK.flatMap((spec) =>
  Object.values(tileArtifacts(spec)).filter((a) => a.source !== null)
);
for (const artifact of artifacts) {
  const src = join(process.cwd(), `data/${artifact.source}/${artifact.file}`);
  if (existsSync(src)) {
    toPublish.set(artifact.file, src);
  } else if (artifact.required) {
    fail(`missing source file data/${artifact.source}/${artifact.file}`);
  } else {
    // The loader treats a missing optional artifact as "feature off"; the
    // prune below makes sure an earlier copy doesn't keep it on.
    log(`optional source absent, skipping ${artifact.file}`);
  }
}

// --- bake: DGM -> heightfield ---------------------------------------------
// The browser used to fetch each tile's 13.6 MB GeoTIFF and resample it on the
// main thread (~0.6 s per tile, x4 tiles). Doing it here leaves the client with
// a header plus a gzipped uint16 grid it dequantises in one pass.

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

/** A cached header is only reusable if it still parses at this version. */
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
    fail(`missing source file ${source.tif}`);
  }
  const headerName = heightfieldHeaderFile(tile, n);
  const dataName = heightfieldDataFile(tile, n);
  const headerPath = join(process.cwd(), CACHE_DIR, headerName);
  const dataPath = join(process.cwd(), CACHE_DIR, dataName);
  toPublish.set(headerName, headerPath);
  toPublish.set(dataName, dataPath);
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
    // Logical sibling name; publish() rewrites it to the hashed one.
    data: dataName,
    zMin: encoded.zMin,
    zScale: encoded.zScale,
  };
  mkdirSync(dirname(dataPath), { recursive: true });
  // Pre-gzipped: static hosts don't compress binary MIME types, and the
  // browser inflates it natively (DecompressionStream) — see heightfield.ts.
  writeFileSync(dataPath, gzipSync(Buffer.from(encoded.samples.buffer)));
  writeFileSync(headerPath, `${JSON.stringify(header, null, 2)}\n`);
  log(
    `built ${headerName} (${n}x${n} from ${width}x${height}, bounds [${bounds.join(", ")}])`
  );
}

for (const { tile, n } of TILE_BLOCK) {
  await bakeHeightfield(tile, n);
}

// --- bake: CityJSON -> building mesh ---------------------------------------
// The browser used to parse 8–11 MB of CityJSON per tile (earcut + attribute
// annotation, ~0.5 s of main thread each). scripts/bake-city-mesh.ts does it
// once here; the primary tile goes first because the neighbours share its
// recenter matrix (the same rule the browser used to apply at load time).

/** The bake's own sources: a change to either invalidates every tile. */
const CITY_BAKE_SOURCES = [
  join(process.cwd(), "scripts/bake-city-mesh.ts"),
  join(process.cwd(), "lib/city/city-mesh.ts"),
  join(process.cwd(), "lib/city/building-tint.ts"),
  join(process.cwd(), "lib/city/minimap.ts"),
];

function bakeCityMeshes(): void {
  let sharedMatrix: Matrix4 | null = null;
  const stale = TILE_BLOCK.some(({ tile }) => {
    const src = cityMeshSourceFiles(tile);
    const inputs = [
      join(process.cwd(), src.city),
      join(process.cwd(), src.roofColor),
      ...CITY_BAKE_SOURCES,
    ];
    return (
      isStale(
        join(process.cwd(), CACHE_DIR, cityMeshMetaFile(tile)),
        ...inputs
      ) ||
      isStale(join(process.cwd(), CACHE_DIR, cityMeshDataFile(tile)), ...inputs)
    );
  });
  for (const { tile } of TILE_BLOCK) {
    const metaPath = join(process.cwd(), CACHE_DIR, cityMeshMetaFile(tile));
    const dataPath = join(process.cwd(), CACHE_DIR, cityMeshDataFile(tile));
    toPublish.set(cityMeshMetaFile(tile), metaPath);
    toPublish.set(cityMeshDataFile(tile), dataPath);
    if (!stale) {
      continue;
    }
    const src = cityMeshSourceFiles(tile);
    const cityPath = join(process.cwd(), src.city);
    if (!existsSync(cityPath)) {
      fail(`missing source file ${src.city}`);
    }
    const doc = JSON.parse(readFileSync(cityPath, "utf8")) as CityJsonDocument;
    const roofPath = join(process.cwd(), src.roofColor);
    const roofLut = existsSync(roofPath)
      ? (JSON.parse(readFileSync(roofPath, "utf8")) as { roofs?: RoofColorLut })
          .roofs
      : undefined;
    const baked = bakeCityMesh(tile, doc, roofLut, sharedMatrix);
    sharedMatrix ??= baked.matrix;
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(dataPath, gzipSync(Buffer.from(baked.bytes)));
    writeFileSync(metaPath, JSON.stringify(baked.meta));
    log(
      `built ${cityMeshMetaFile(tile)} (${baked.meta.objects.length} objects, ${baked.meta.vertexCount} vertices${roofLut ? ", DOP roof colours" : ""})`
    );
  }
}

bakeCityMeshes();

// --- publish: hashed names + manifest -------------------------------------

/** `name.ext` → `name.<8 hex of sha1(content)>.ext` (`.u16.gz` keeps both). */
function hashedName(file: string, content: Buffer): string {
  const hash = createHash("sha1").update(content).digest("hex").slice(0, 8);
  const ext = file.endsWith(".u16.gz") ? ".u16.gz" : extname(file);
  const stem = basename(file, ext);
  return `${stem}.${hash}${ext}`;
}

const outDir = join(process.cwd(), OUT_DIR);
mkdirSync(outDir, { recursive: true });
const manifest: DataManifest = { version: 1, files: {} };
const keep = new Set<string>([MANIFEST_FILE]);
let published = 0;

/** Publishes one artifact; `content` overrides the file on disk when given. */
function publish(logical: string, path: string, content?: Buffer): void {
  const bytes = content ?? readFileSync(path);
  const hashed = hashedName(logical, bytes);
  manifest.files[logical] = hashed;
  keep.add(hashed);
  const dest = join(outDir, hashed);
  if (existsSync(dest)) {
    return;
  }
  if (content) {
    writeFileSync(dest, content);
  } else {
    copyFileSync(path, dest);
  }
  published++;
}

// Data files first: a heightfield header names its data sibling, so the
// header can only be published once the data's hashed name is known.
const headerNames = new Set(
  TILE_BLOCK.map(({ tile, n }) => heightfieldHeaderFile(tile, n))
);
for (const [logical, path] of toPublish) {
  if (!headerNames.has(logical)) {
    publish(logical, path);
  }
}
for (const [logical, path] of toPublish) {
  if (headerNames.has(logical)) {
    const header = parseHeightfieldHeader(
      JSON.parse(readFileSync(path, "utf8"))
    );
    const data = manifest.files[header.data];
    if (!data) {
      fail(
        `heightfield header ${logical} names unpublished data ${header.data}`
      );
    }
    publish(
      logical,
      path,
      Buffer.from(`${JSON.stringify({ ...header, data }, null, 2)}\n`)
    );
  }
}

writeFileSync(
  join(outDir, MANIFEST_FILE),
  `${JSON.stringify(manifest, null, 2)}\n`
);

// Prune whatever the manifest no longer references (old hashes, removed
// optional sources, the pre-manifest flat copies).
let pruned = 0;
for (const entry of readdirSync(outDir)) {
  if (!keep.has(entry)) {
    rmSync(join(outDir, entry), { recursive: true });
    pruned++;
  }
}
log(
  `${Object.keys(manifest.files).length} artifacts in ${OUT_DIR} (${published} new, ${pruned} pruned)`
);
