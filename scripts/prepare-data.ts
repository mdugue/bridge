/**
 * Prepares the tile block for the browser. Two stages:
 *
 *  1. **Bake** — every artifact the viewer may request (lib/city/tile.ts,
 *     `tileArtifacts`) is either a committed per-tile file under data/ or is
 *     produced here from one (the DGM GeoTIFF → heightfield, see
 *     lib/city/heightfield.ts; the 4096² land-cover rasters → their 2048²
 *     variants, see downsample-raster.ts; CityJSON → the building mesh).
 *     Baked outputs live in `.cache/prepare-data/` (gitignored) with
 *     mtime-based staleness against the inputs AND the bake's own source
 *     files, so a rerun is cheap and a changed bake never serves a stale
 *     cache. Every `required` artifact must come out of this stage.
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
import type { Matrix4 } from "three";
import type { RoofColorLut } from "../lib/city/building-tint";
import {
  HEIGHTFIELD_VERSION,
  type HeightfieldHeader,
  parseHeightfieldHeader,
} from "../lib/city/heightfield";
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
import { bakeHeightfield } from "./bake-heightfield";
import { bakeWissenHero } from "./bake-wissen-hero";
import { downsampleRaster } from "./downsample-raster";

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

// --- bake: downsampled rasters ----------------------------------------------
// The DLM bake writes 4096² land-cover rasters. A neighbour tile is backdrop
// and is served at 2048²; phones get 2048² for the primary tile as well (see
// MOBILE_RASTER_PX) — a quarter of the texture memory per raster. The class
// raster keeps NEAREST (ids must not blend); the pastel RGB splat (alpha =
// water coverage) is Lanczos-filtered. Which variants exist is decided by
// tileArtifacts() (lib/city/tile.ts), not here; HOW they are resampled by
// scripts/downsample-raster.ts — read its header before touching either.

/** The bake's own sources: the resampler, and the kernel each variant
 *  declares. A change to either re-bakes every variant. */
const RASTER_BAKE_SOURCES = [
  join(process.cwd(), "scripts/downsample-raster.ts"),
  join(process.cwd(), "lib/city/tile.ts"),
];

async function bakeRasters(): Promise<void> {
  for (const spec of TILE_BLOCK) {
    for (const artifact of Object.values(tileArtifacts(spec))) {
      const { bakedFrom, raster, resample } = artifact;
      if (!(bakedFrom && raster && resample) || toPublish.has(artifact.file)) {
        continue;
      }
      const source = `data/${bakedFrom.source}/${bakedFrom.file}`;
      const src = join(process.cwd(), source);
      if (!existsSync(src)) {
        fail(`missing source file ${source}`);
      }
      const dest = join(process.cwd(), CACHE_DIR, artifact.file);
      toPublish.set(artifact.file, dest);
      if (!isStale(dest, src, ...RASTER_BAKE_SOURCES)) {
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, await downsampleRaster(src, raster, resample));
      log(`downsampled ${bakedFrom.file} to ${raster}² (${resample})`);
    }
  }
}

await bakeRasters();

// --- bake: DGM -> heightfield ---------------------------------------------
// The resample + encode lives in scripts/bake-heightfield.ts; this stage owns
// the paths, the staleness check and the registration for publish.

function readArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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

/** The heightfield bake's own sources — the resampler, the codec and the .tfw
 *  reader. A change to any of them re-bakes every tile, as the header
 *  promises: a quantisation or z-scale edit must never serve a stale cache
 *  just because HEIGHTFIELD_VERSION was not bumped. */
const HEIGHTFIELD_BAKE_SOURCES = [
  join(process.cwd(), "scripts/bake-heightfield.ts"),
  join(process.cwd(), "lib/city/heightfield.ts"),
  join(process.cwd(), "lib/city/tfw.ts"),
];

async function bakeHeightfieldTile(tile: string, n: number): Promise<void> {
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
    isStale(headerPath, tifPath, tfwPath, ...HEIGHTFIELD_BAKE_SOURCES) ||
    isStale(dataPath, tifPath, tfwPath, ...HEIGHTFIELD_BAKE_SOURCES) ||
    !headerIsCurrent(headerPath);
  if (!stale) {
    return;
  }

  const baked = await bakeHeightfield(
    readArrayBuffer(tifPath),
    existsSync(tfwPath) ? readFileSync(tfwPath, "utf8") : null,
    n
  ).catch((err: unknown) =>
    fail(`${tile}: ${err instanceof Error ? err.message : String(err)}`)
  );
  const header: HeightfieldHeader = {
    ...baked.header,
    // Logical sibling name; publish() rewrites it to the hashed one.
    data: dataName,
  };
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, baked.data);
  writeFileSync(headerPath, `${JSON.stringify(header, null, 2)}\n`);
  log(
    `built ${headerName} (${n}x${n} from ${baked.source.width}x${baked.source.height}, bounds [${header.bounds.join(", ")}])`
  );
}

for (const { tile, n } of TILE_BLOCK) {
  await bakeHeightfieldTile(tile, n);
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

// --- bake: the /wissen picture ---------------------------------------------
// The block's pastel land-cover splat as one map (scripts/bake-wissen-hero.ts)
// for the knowledge-base pages, which let next/image size it. Not a viewer
// artifact: optional, and skipped quietly if a splat is missing.

const HERO_FILE = "wissen-hero.webp";
const HERO_WIDTH = 1600;
const HERO_BAKE_SOURCES = [join(process.cwd(), "scripts/bake-wissen-hero.ts")];

async function bakeHero(): Promise<void> {
  const tiles = TILE_BLOCK.map(({ tile }) => tile);
  const rasterOf = (tile: string) =>
    join(process.cwd(), `data/dlm/landcover_rgb_${tile}.png`);
  if (!tiles.every((tile) => existsSync(rasterOf(tile)))) {
    log("land-cover splat missing, skipping the /wissen picture");
    return;
  }
  const dest = join(process.cwd(), CACHE_DIR, HERO_FILE);
  toPublish.set(HERO_FILE, dest);
  if (!isStale(dest, ...tiles.map(rasterOf), ...HERO_BAKE_SOURCES)) {
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, await bakeWissenHero(tiles, rasterOf, HERO_WIDTH));
  log(`baked ${HERO_FILE}`);
}

await bakeHero();

// Every required artifact must have come out of a stage above. A kind that
// is neither a committed source nor covered by a bake step (or a spec whose
// raster edge is 0/NaN and so skipped the raster bake) fails here — not as
// a 404 the loader turns into "feature off" on every client.
for (const spec of TILE_BLOCK) {
  for (const artifact of Object.values(tileArtifacts(spec))) {
    if (artifact.required && !toPublish.has(artifact.file)) {
      fail(`required artifact ${artifact.file} was neither copied nor baked`);
    }
  }
}

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
