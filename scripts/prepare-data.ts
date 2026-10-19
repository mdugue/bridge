/**
 * Prepares one site for the browser (`bun scripts/prepare-data.ts <site>`;
 * scripts/prepare-sites.ts runs it for every ready site): bakes its tiles into an OGC 3D Tiles
 * tileset (lib/city/tileset.ts) and publishes everything under
 * content-hashed names. Four steps:
 *
 *  1. **Side files** — each tile's rasters and feature collections
 *     (lib/city/tile.ts, `tileArtifacts`): the site's files under data/<site>/dlm/
 *     as they are, plus the 2048² class raster downsampled from the 4096²
 *     one (downsample-raster.ts).
 *  2. **Content** — per tile, the buildings (CityJSON → glTF with a
 *     per-object table, bake-city-mesh.ts) and the terrain at two levels
 *     (DGM → glTF, bake-tiles.ts: the fine level an error-bounded TIN over
 *     the native DGM, bake-terrain-tin.ts), each glTF naming its side files in
 *     `extras`. Pre-gzipped (`.glb.gz`): static hosts do not compress binary
 *     types, and the viewer inflates natively (DecompressionStream).
 *  3. **Tilesets** — the tree over all tiles, and one over the spawn tile
 *     alone (the `lite` profile).
 *  4. **Publish** — `manifest.json` maps logical → hashed names; it is the
 *     one file served `no-cache` (next.config.ts), everything else is
 *     immutable. Files the manifest no longer references are pruned.
 *
 * Baked outputs are cached in `.cache/prepare-data/` (gitignored; on Vercel
 * `.next/cache/prepare-data/`, which its build cache keeps) under a
 * key of their inputs' contents, every module the artifact's own bake
 * imports (bake-sources.ts, walked from that bake's entry), this file, the
 * site's own config, the names they reference and the locked versions of
 * the packages those modules import, so a rerun is cheap, a changed bake
 * never serves a stale cache, and an edit to another site or to what only
 * the viewer reads (or a bump of a package only it imports) re-bakes
 * nothing.
 * Writes public/data/<site>/ (gitignored), the folder the route /<site>
 * streams from.
 */
import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { FacadeMaterial, RoofColours } from "../lib/city/building-tint";
import type { OsmBuildingLut, WallMaterial } from "../lib/city/city-mesh";
import { type LandmarkFile, siteLandmarks } from "../lib/city/landmarks";
import type {
  CanopyFeature,
  DoorFeature,
  ShopfrontFile,
  PlinthFeature,
  DormerFeature,
  FeatureCollection,
  RailFeature,
  TramFeature,
  MeasuredRoofFeature,
  SmallBuildingFeature,
  StructureFeature,
} from "../lib/city/features";
import { cutWallGates } from "../lib/city/fences";
import {
  PROVENANCE_FILE,
  type ProvenanceRecord,
  siteProvenance,
} from "../lib/city/provenance";
import type { Passage } from "../lib/city/passages";
import type { LevelLine } from "../lib/city/levels";
import { tileExtentOf } from "../lib/city/site";
import { packPoints, pointOf } from "../lib/city/point-pack";
import {
  lod2Roofs,
  type RoofFootprint,
  treesOffRoofs,
} from "../lib/city/roof-trees";
import { treesOffStructures } from "../lib/city/small-buildings";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import {
  buildingHeights,
  footprintArea,
  landcoverShares,
  quantile,
  SITE_STATS_FILE,
  type SiteStats,
} from "../lib/city/site-stats";
import { groundRelief } from "../lib/city/valley-fog";
import {
  cityMeshSourceFiles,
  type DataManifest,
  COARSE_DRESSING_KINDS,
  DRESSING_KINDS,
  pickFiles,
  ASK_KINDS,
  type TileArtifact,
  type TileArtifactKind,
  dgmSourceFiles,
  kerbSourceFile,
  MANIFEST_FILE,
  sideFileSource,
  siteDataDir,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  wallSourceFile,
  tileIds,
} from "../lib/city/tile";
import { SITE_MAP_FILE } from "../lib/city/site-index";
import {
  ownsPoint,
  type BakedTile,
  buildTileset,
  type CityExtras,
  TERRAIN_LEVELS,
  type TerrainExtras,
  TILESET_FILE,
  TILESET_SPAWN_FILE,
  type TilesetExtras,
} from "../lib/city/tileset";
import type { CityJsonDocument } from "../lib/city/types";
import type { WindowFile } from "../lib/city/windows";
import {
  TRAM_TIMETABLE_FILE,
  tramTimetableSource,
} from "../lib/city/tram-timetable";
import { siteFromArgs } from "../sites";
import { bakeMode, NOT_CACHED } from "./warmers";
import {
  type BakedCityMesh,
  bakeCityMesh,
  type CityFrame,
  cityFrame,
  cityMesh,
} from "./bake-city-mesh";
import { bakeCoarseCrowns } from "./coarse-crowns";
import {
  contentKey,
  createContentHasher,
  lockedVersions,
  moduleGraph,
  packageImports,
  readLockfile,
} from "./bake-sources";
import { cachedEntry, writeEntry } from "./bake-cache";
import {
  type Dgm,
  fenceMesh,
  fineTin,
  gridHeightAt,
  gridMesh,
  kerbMesh,
  readDgm,
  shapeGrid,
  stairMesh,
  type TerrainFeatures,
  type TerrainMesh,
  terrainMesh,
  tinHeightAt,
  tinMesh,
  wallMesh,
} from "./bake-tiles";
import { FINE_TIN_MAX_ERROR } from "./bake-terrain-tin";
import { bakeWissenHero } from "./bake-wissen-hero";
import { type ColonyCrop, cropColonyRaster } from "./crop-raster";
import { downsampleClassRaster } from "./downsample-raster";
import {
  type FineGround,
  packGround,
  readGroundHeader,
  unpackGround,
} from "./ground-pack";
import {
  levelInputs,
  type SiteLevels,
  siteLineLevels,
  sitePassages,
} from "./line-levels";
import { writeMeshGlb } from "./tile-glb";
import {
  fenceLines,
  gatePoints,
  kerbLines,
  stairLines,
  terraces,
  wallLines,
} from "./tile-sources";

/** On Vercel the cache lives under `.next/cache`, the one folder (with
 *  node_modules) its Next.js builds carry from one deployment to the next;
 *  elsewhere under `.cache`, so clearing `.next` keeps a local bake. */
const CACHE_DIR = join(
  process.cwd(),
  process.env.VERCEL ? ".next/cache/prepare-data" : ".cache/prepare-data"
);
const { MODE, SITE } = (() => {
  try {
    const { rest, site } = siteFromArgs(process.argv.slice(2));
    return { MODE: bakeMode(rest, tileIds(site)), SITE: site };
  } catch (error) {
    process.stderr.write(`prepare-data: ${(error as Error).message}\n`);
    process.exit(2);
  }
})();
const OUT_DIR = join(process.cwd(), "public/data", SITE.id);
const TILES = tileIds(SITE);
/** A warmer (warmers.ts; prepare-sites.ts runs them only with
 *  PREPARE_WARMERS=1) only fills the cache for its own tiles: it publishes
 *  nothing — no file under public/data, no manifest, no prune. */
const WARMING = MODE.kind !== "publish";
/** The tiles this run bakes. */
const OWN = new Set(MODE.kind === "publish" ? TILES : MODE.tiles);
/** What a missing source means for a site that has not been fetched yet. */
const HINT = ` — run \`bun run fetch ${SITE.id}\` and \`bun run bake ${SITE.id}\``;

function fail(message: string): never {
  process.stderr.write(`prepare-data: ${message}\n`);
  process.exit(1);
}

function log(message: string): void {
  process.stdout.write(`prepare-data: ${message}\n`);
}

/** Whole milliseconds since `t0` (`performance.now()`), for the timing
 *  lines. */
const since = (t0: number) => Math.round(performance.now() - t0);
const started = performance.now();

const at = (path: string) => join(process.cwd(), path);
const utf8 = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const parse = <T>(bytes: Uint8Array): T =>
  JSON.parse(new TextDecoder().decode(bytes)) as T;
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

// --- publish ------------------------------------------------------------------

if (!WARMING) {
  mkdirSync(OUT_DIR, { recursive: true });
}
const manifest: DataManifest = { version: 1, files: {} };
const keep = new Set<string>([MANIFEST_FILE]);
let published = 0;

/** `name.ext` → `name.<8 hex of sha1>.ext` (`.glb.gz`, `.pts.gz`, `.crw.gz`
 *  keep both). */
function hashedName(file: string, content: Uint8Array): string {
  const hash = createHash("sha1").update(content).digest("hex").slice(0, 8);
  const ext = file.match(/(\.(?:glb|pts|crw)\.gz|\.[^.]+)$/u)?.[0] ?? "";
  return `${basename(file, ext)}.${hash}${ext}`;
}

/** Publishes one artifact and returns the name it is served under (a
 *  warmer only names it: the names go into the glTF's extras). */
function publish(logical: string, content: Uint8Array): string {
  const hashed = hashedName(logical, content);
  manifest.files[logical] = hashed;
  keep.add(hashed);
  const dest = join(OUT_DIR, hashed);
  if (!WARMING && !existsSync(dest)) {
    writeFileSync(dest, content);
    published++;
  }
  return hashed;
}

// --- cache --------------------------------------------------------------------

/** What every key carries: this file (the orchestration), the site's own
 *  config and the dependency patches (the glTF tools' versions shape the
 *  output too). Not the other sites' configs, nor what only the viewer
 *  reads: an artifact's own bake brings its sources (`cacheKey`'s
 *  `entries`). Each must exist: the hasher reads a missing file as
 *  "absent" (an optional input's right answer), which would drop it from
 *  every key without a word. */
const COMMON_SOURCES = [
  "scripts/prepare-data.ts",
  `sites/${SITE.id}.ts`,
  "sites/providers.ts",
  ...readdirSync(at("patches")).map((name) => `patches/${name}`),
].map((source) => {
  if (!existsSync(at(source))) {
    fail(
      `missing source file ${source} — every cache key carries it (a site's config is sites/<site id>.ts)`
    );
  }
  return at(source);
});

/** The lockfile, of which a key carries only what it resolved for the
 *  packages the key's modules import (and their dependencies): a bump of
 *  a package only the viewer imports re-bakes nothing. */
const LOCKFILE = "bun.lock";
if (!existsSync(at(LOCKFILE))) {
  fail(`missing ${LOCKFILE} — every cache key carries the versions it holds`);
}
const lockfile = readLockfile(readFileSync(at(LOCKFILE), "utf8"));
const packagesIn = new Map<string, string[]>();
const locked = new Map<string, string[]>();

/** The lockfile's lines for every package `sources` import, memoised per
 *  set of packages. */
function lockedFor(sources: Iterable<string>): string[] {
  const packages = new Set<string>();
  for (const file of sources) {
    // the patches are no modules
    if (!/\.tsx?$/u.test(file)) {
      continue;
    }
    let own = packagesIn.get(file);
    if (!own) {
      own = packageImports(file);
      packagesIn.set(file, own);
    }
    for (const name of own) {
      packages.add(name);
    }
  }
  const names = [...packages].toSorted();
  let lines = locked.get(names.join(" "));
  if (!lines) {
    lines = lockedVersions(lockfile, names);
    locked.set(names.join(" "), lines);
  }
  return lines;
}

const hashOf = createContentHasher();
const graphs = new Map<string, string[]>();

/** Every module reachable from `entry`, memoised per bake run. */
function sourcesOf(entry: string): string[] {
  let graph = graphs.get(entry);
  if (!graph) {
    graph = moduleGraph(entry).map(at);
    graphs.set(entry, graph);
  }
  return graph;
}

/** A cache key over the contents of the input files, the sources of the
 *  bake that makes the artifact (each entry module and every module it
 *  imports: the bake modules and the lib/city helpers this file calls for
 *  it), the common sources, the locked versions of the packages they all
 *  import, and any extra values. */
function cacheKey(
  inputs: string[],
  entries: string[],
  ...extra: unknown[]
): string {
  const sources = new Set<string>(COMMON_SOURCES);
  for (const entry of entries) {
    for (const file of sourcesOf(entry)) {
      sources.add(file);
    }
  }
  return contentKey(
    hashOf,
    [...inputs, ...[...sources].toSorted()],
    [lockedFor(sources), ...extra]
  );
}

/** The modules a tile's shaped ground is baked by (`shapedTerrain`): the
 *  DGM reader and meshers, the TIN's tolerance, the stair, terrace and wall
 *  sources, the passages the site's lines open, the levels' grid sizes and
 *  the tile's extent — and the cache entry the fine ground is read back
 *  from (`groundFile`): every artifact made from it keys on its reader. */
const GROUND_BAKE = [
  "scripts/bake-tiles.ts",
  "scripts/bake-terrain-tin.ts",
  "scripts/ground-pack.ts",
  "scripts/tile-sources.ts",
  "scripts/line-levels.ts",
  "lib/city/tileset.ts",
  "lib/city/site.ts",
];

/**
 * A site-wide artifact's cache name. Every site shares the cache, and
 * `cached` keeps one entry per name: unscoped, each site's build would evict
 * the entry of the site built before it (and re-bake its own on every run).
 * A tile's names need no scope while no two sites share a tile.
 */
const siteWide = (name: string) => `${SITE.id}.${name}`;

/** `--if-cached` (warmers.ts) stops at the first entry it would bake. */
function mayBake(name: string): void {
  if (MODE.kind === "publish" && MODE.ifCached) {
    log(`${name} is not cached: the warmers bake the site`);
    process.exit(NOT_CACHED);
  }
}

/** The cached bytes for `key`, or the baked ones (then cached: one entry
 *  per name, written whole — bake-cache.ts). */
async function cached(
  name: string,
  key: string,
  bake: () => Promise<Uint8Array> | Uint8Array
): Promise<Uint8Array> {
  const path = cachedEntry(CACHE_DIR, name, key);
  if (path) {
    return readFileSync(path);
  }
  mayBake(name);
  const bytes = await bake();
  writeEntry(CACHE_DIR, name, key, bytes);
  return bytes;
}

/** Where the cached entry for `key` lies, baked first when it is not
 *  there — for an entry read later, or only in part. */
async function cachedFile(
  name: string,
  key: string,
  bake: () => Promise<Uint8Array> | Uint8Array
): Promise<string> {
  const path = cachedEntry(CACHE_DIR, name, key);
  if (path) {
    return path;
  }
  mayBake(name);
  return writeEntry(CACHE_DIR, name, key, await bake());
}

// --- 1. side files --------------------------------------------------------------

/** Artifact kind → published name (absent optional files: missing), plus
 *  the phones' colony raster publishColonies derives beside
 *  `cultivatedRaster`. */
type Published = Partial<Record<TileArtifactKind | "cultivatedLow", string>>;

/** tile → artifact kind → published name */
const sideFiles = new Map<string, Published>();
/** tile → where its published colony raster lies in the tile */
const colonyCrops = new Map<string, ColonyCrop>();

/**
 * The colony raster cropped to its colonies, and the half-resolution twin
 * phones read (`cultivatedLow`); a tile without a colony publishes neither.
 */
async function publishColonies(
  tile: string,
  file: string,
  names: Published
): Promise<void> {
  const src = at(sideFileSource(SITE, file));
  const key = cacheKey([src], ["scripts/crop-raster.ts"]);
  const lowFile = file.replace(/\.png$/u, ".r1024.png");
  const cropFile = file.replace(/\.png$/u, ".crop.json");
  let cropping: ReturnType<typeof cropColonyRaster> | null = null;
  const cut = () => {
    cropping ??= cropColonyRaster(src);
    return cropping;
  };
  const crop = parse<ColonyCrop | null>(
    await cached(cropFile, key, async () => utf8((await cut())?.crop ?? null))
  );
  if (!crop) {
    log(`no colony on ${tile}, skipping ${file}`);
    return;
  }
  colonyCrops.set(tile, crop);
  const full = await cached(
    file,
    key,
    async () => (await cut())?.full ?? new Uint8Array()
  );
  const low = await cached(
    lowFile,
    key,
    async () => (await cut())?.low ?? new Uint8Array()
  );
  names.cultivatedRaster = publish(file, full);
  names.cultivatedLow = publish(lowFile, low);
}

/** Each tile's LoD2 roofs, read once for its canopy and scan crowns. */
const tileRoofs = new Map<string, RoofFootprint[]>();
function roofsOf(tile: string): RoofFootprint[] {
  let roofs = tileRoofs.get(tile);
  if (!roofs) {
    const city = at(cityMeshSourceFiles(SITE, tile).city);
    roofs = existsSync(city) ? lod2Roofs(readJson<CityJsonDocument>(city)) : [];
    tileRoofs.set(tile, roofs);
  }
  return roofs;
}

/**
 * The canopy (DOM1) or the laser-scan crowns without the points that stand
 * in or within 0.5 m of one of the tile's scan structures: DOM1 reads a
 * shed's roof as a 3–4 m tree (lib/city/small-buildings.ts). Here, not in
 * the canopy bake, because the structures are baked after the canopy. Nor
 * the points that are a LoD2 roof (lib/city/roof-trees.ts): a hall on what
 * the Basis-DLM still files as park.
 */
async function publishCanopy(tile: string, file: string): Promise<string> {
  const src = at(sideFileSource(SITE, file));
  const sheds = at(cityMeshSourceFiles(SITE, tile).smallBuild);
  const city = at(cityMeshSourceFiles(SITE, tile).city);
  // Packed, not GeoJSON (lib/city/point-pack.ts): the browser parsed up to
  // 9.5 MB of it in one task. Relative to the tile's south-west corner, and
  // pre-gzipped like the glTF (static hosts do not compress binary types).
  const packed = file.replace(/\.geojson$/u, ".pts.gz");
  const [minX, minY] = tileExtentOf(SITE.tiles[TILES.indexOf(tile)]);
  const stride = file.startsWith("canopyx_") ? 4 : 3;
  const bake = [
    "lib/city/point-pack.ts",
    "lib/city/roof-trees.ts",
    "lib/city/small-buildings.ts",
    "lib/city/site.ts",
  ];
  const bytes = await cached(packed, cacheKey([src, sheds, city], bake), () => {
    const trees =
      readJson<FeatureCollection<CanopyFeature>>(src).features ?? [];
    let features = trees;
    if (existsSync(sheds)) {
      const structures =
        readJson<FeatureCollection<SmallBuildingFeature>>(sheds).features ?? [];
      features = treesOffStructures(trees, structures);
      log(
        `${file}: ${trees.length - features.length} points in a scan structure dropped`
      );
    }
    const offSheds = features.length;
    features = treesOffRoofs(features, roofsOf(tile));
    if (features.length < offSheds) {
      log(
        `${file}: ${offSheds - features.length} points on a LoD2 roof dropped`
      );
    }
    return gz(packPoints(features.map(pointOf), [minX, minY], stride));
  });
  return publish(packed, bytes);
}

/** The levels of the site's rail and tram lines, solved over whole lines on
 *  every tile's DGM (scripts/line-levels.ts): each tile's file publishes
 *  with them. */
const levelsStarted = performance.now();
const lineLevels = parse<SiteLevels>(
  await cached(
    `line-levels-${SITE.id}.json`,
    cacheKey(levelInputs(SITE), ["scripts/line-levels.ts"]),
    async () => utf8(await siteLineLevels(SITE))
  )
);
log(`line levels: ${since(levelsStarted)} ms`);

/** The passages the lines open through the fill under the decks
 *  (lib/city/passages.ts): the terrain bake opens each in the tiles it
 *  touches. */
const passages = sitePassages(SITE, lineLevels);

/** The passages that reach into a tile's extent. */
function passagesIn(tile: string): Passage[] {
  const [x0, y0, x1, y1] = tileExtentOf(SITE.tiles[TILES.indexOf(tile)]);
  return passages.filter((p) =>
    p.coords.some(
      ([x, y]) =>
        x >= x0 - p.half &&
        x <= x1 + p.half &&
        y >= y0 - p.half &&
        y <= y1 + p.half
    )
  );
}

/**
 * A tile's rail or tram file with each line's runs off the ground (`lv`,
 * lib/city/levels.ts), so the layer draws it on the level its whole run
 * says rather than deciding per sample.
 */
function publishLevels(tile: string, line: LevelLine, file: string): string {
  const src = at(sideFileSource(SITE, file));
  const runs = lineLevels[tile]?.[line] ?? {};
  if (Object.keys(runs).length === 0) {
    return publish(file, readFileSync(src));
  }
  const doc = readJson<FeatureCollection<RailFeature | TramFeature>>(src);
  const features = (doc.features ?? []).map((f, i) =>
    runs[i] ? { ...f, properties: { ...f.properties, lv: runs[i] } } : f
  );
  return publish(file, utf8({ ...doc, features }));
}

// A ground warmer needs none; a tile warmer its own tiles'.
const sidesStarted = performance.now();
for (const tile of MODE.kind === "ground"
  ? []
  : TILES.filter((t) => OWN.has(t))) {
  const names: Published = {};
  const artifacts = Object.entries(tileArtifacts(tile)) as [
    TileArtifactKind,
    TileArtifact,
  ][];
  for (const [kind, artifact] of artifacts) {
    if (kind === "crowns") {
      // baked from the tree files on the fine ground (publishCrowns)
      continue;
    }
    if (
      kind === "cultivatedRaster" &&
      existsSync(at(sideFileSource(SITE, artifact.file)))
    ) {
      await publishColonies(tile, artifact.file, names);
      continue;
    }
    if (
      (kind === "canopy" || kind === "canopyx") &&
      existsSync(at(sideFileSource(SITE, artifact.file)))
    ) {
      names[kind] = await publishCanopy(tile, artifact.file);
      continue;
    }
    if (
      (kind === "rail" || kind === "tram") &&
      existsSync(at(sideFileSource(SITE, artifact.file)))
    ) {
      names[kind] = publishLevels(tile, kind, artifact.file);
      continue;
    }
    if (artifact.bakedFrom) {
      const source = sideFileSource(SITE, artifact.bakedFrom.file);
      const src = at(source);
      if (!existsSync(src)) {
        fail(`missing source file ${source}${HINT}`);
      }
      const { raster } = artifact.bakedFrom;
      // lib/city/tile.ts: the artifact table names the raster's size
      const bake = ["scripts/downsample-raster.ts", "lib/city/tile.ts"];
      const bytes = await cached(artifact.file, cacheKey([src], bake), () =>
        downsampleClassRaster(src, raster)
      );
      names[kind] = publish(artifact.file, bytes);
      continue;
    }
    const source = sideFileSource(SITE, artifact.file);
    const src = at(source);
    if (existsSync(src)) {
      names[kind] = publish(artifact.file, readFileSync(src));
    } else if (artifact.required) {
      fail(`missing source file ${source}${HINT}`);
    } else {
      // The loader treats a missing optional artifact as "feature off".
      log(`optional source absent, skipping ${artifact.file}`);
    }
  }
  sideFiles.set(tile, names);
}
log(`side files: ${since(sidesStarted)} ms`);

// --- 2. content -----------------------------------------------------------------

/** A tile's landmarks (pipeline/bake/landmarks.py), or none. */
function landmarkFile(tile: string): LandmarkFile | undefined {
  const path = at(cityMeshSourceFiles(SITE, tile).landmarks);
  return existsSync(path) ? readJson<LandmarkFile>(path) : undefined;
}

/**
 * The OSM facts per object with the tile's landmarks folded in: each of a
 * landmark's objects is marked, and takes the wall material Wikidata names
 * where OSM names none.
 */
function withLandmarks(
  lut: OsmBuildingLut | undefined,
  file: LandmarkFile | undefined
): OsmBuildingLut | undefined {
  if (!file?.landmarks.length) {
    return lut;
  }
  const out: OsmBuildingLut = { ...lut };
  for (const lm of file.landmarks) {
    for (const id of lm.objects) {
      const own = out[id];
      out[id] = {
        ...own,
        landmark: 1,
        material: own?.material ?? (lm.material as WallMaterial | undefined),
      };
    }
  }
  return out;
}

/**
 * Every tile is recentered on one offset, the spawn tile's (the frame
 * snapshots are recorded in): its bake finds it as the loader parses it,
 * the rest take it from `cityFrame`, which reads the spawn tile's CityJSON
 * without parsing a building — once, when the frame or another tile's
 * buildings are baked.
 */
let spawn: CityFrame | null = null;

function spawnFrame(): CityFrame {
  if (!spawn) {
    const src = cityMeshSourceFiles(SITE, TILES[0]);
    if (!existsSync(at(src.city))) {
      fail(`missing source file ${src.city}${HINT}`);
    }
    spawn = cityFrame(TILES[0], readJson<CityJsonDocument>(at(src.city)));
  }
  return spawn;
}

function parseCity(tile: string): BakedCityMesh {
  const src = cityMeshSourceFiles(SITE, tile);
  if (!existsSync(at(src.city))) {
    fail(`missing source file ${src.city}${HINT}`);
  }
  const doc = readJson<CityJsonDocument>(at(src.city));
  const roofColours = existsSync(at(src.roofColor))
    ? readJson<RoofColours>(at(src.roofColor))
    : undefined;
  const osmDoc = existsSync(at(src.osmBuild))
    ? readJson<{ context?: FacadeMaterial; objects?: OsmBuildingLut }>(
        at(src.osmBuild)
      )
    : undefined;
  const osmLut = withLandmarks(osmDoc?.objects, landmarkFile(tile));
  const scan = existsSync(at(src.smallBuild))
    ? readJson<FeatureCollection<SmallBuildingFeature>>(at(src.smallBuild))
        .features
    : undefined;
  const gaps = existsSync(at(src.structures))
    ? readJson<FeatureCollection<StructureFeature>>(at(src.structures)).features
    : undefined;
  const measured = existsSync(at(src.measuredRoofs))
    ? readJson<FeatureCollection<MeasuredRoofFeature>>(at(src.measuredRoofs))
        .features
    : undefined;
  const plinths = existsSync(at(src.plinths))
    ? readJson<FeatureCollection<PlinthFeature>>(at(src.plinths)).features
    : undefined;
  const doors = existsSync(at(src.doors))
    ? readJson<FeatureCollection<DoorFeature>>(at(src.doors)).features
    : undefined;
  const dormers = existsSync(at(src.dormers))
    ? readJson<FeatureCollection<DormerFeature>>(at(src.dormers)).features
    : undefined;
  const shopfronts = existsSync(at(src.shopfronts))
    ? Object.values(
        readJson<ShopfrontFile>(at(src.shopfronts)).buildings
      ).flat()
    : undefined;
  const windows = existsSync(at(src.windows))
    ? Object.values(readJson<WindowFile>(at(src.windows)).buildings).flat()
    : undefined;
  return bakeCityMesh(
    tile,
    doc,
    roofColours,
    tile === TILES[0] ? null : spawnFrame().matrix,
    osmLut,
    scan,
    osmDoc?.context ?? "render",
    gaps,
    measured,
    { doors, dormers, plinths, shopfronts, windows }
  );
}

/** The shared offset and CRS, cached with the spawn tile's CityJSON. */
const frame = parse<{ cx: number; cy: number; epsg: number }>(
  await cached(
    siteWide("frame.json"),
    cacheKey(
      [at(cityMeshSourceFiles(SITE, TILES[0]).city)],
      ["scripts/bake-city-mesh.ts"]
    ),
    () => {
      const { offset, epsg } = spawnFrame();
      return utf8({ ...offset, epsg });
    }
  )
);
const offset = { cx: frame.cx, cy: frame.cy };

/** Bun's libdeflate: at the same level about twice as fast as zlib here and
 *  a little smaller (the site's glTF: 3.0 s vs 6.5 s, 52.96 vs 53.13 MB). */
function gz(bytes: Uint8Array): Uint8Array {
  // The glb writers build on plain ArrayBuffers; Bun's types only take those.
  return Bun.gzipSync(bytes as Uint8Array<ArrayBuffer>, {
    level: 9,
    library: "libdeflate",
  });
}

/** A tile's buildings: footprints JSON + glTF, both from one parse. */
async function bakeCity(
  tile: string
): Promise<{ file: string; footprints: string; maxZ: number }> {
  const src = cityMeshSourceFiles(SITE, tile);
  const inputs = [
    at(src.city),
    at(src.roofColor),
    at(src.osmBuild),
    at(src.smallBuild),
    at(src.structures),
    at(src.landmarks),
    at(src.measuredRoofs),
    at(src.doors),
    at(src.plinths),
    at(src.dormers),
    at(src.shopfronts),
    at(src.windows),
  ];
  const bake = [
    "scripts/bake-city-mesh.ts",
    "scripts/tile-glb.ts",
    "scripts/measured-roofs.ts",
  ];
  const key = cacheKey(inputs, bake, offset);
  let mesh: ReturnType<typeof cityMesh> | null = null;
  const built = () => {
    mesh ??= cityMesh(parseCity(tile));
    return mesh;
  };
  const footprintsFile = `footprints_${tile}.json`;
  const footprints = publish(
    footprintsFile,
    await cached(footprintsFile, key, () => utf8(built().footprints))
  );
  const { maxZ } = parse<{ maxZ: number }>(
    await cached(`city_${tile}.json`, key, () =>
      utf8({ maxZ: built().maxElevation })
    )
  );
  const svf = sideFiles.get(tile)?.svf;
  const facades = sideFiles.get(tile)?.facades;
  const extras: CityExtras = {
    kind: "city",
    tileId: tile,
    // The facades' ambient light reads the terrain's sky-view raster.
    ...(svf ? { svf } : {}),
    // ...and their relief and tone what street photos saw of them.
    ...(facades ? { facades } : {}),
  };
  const name = `city_${tile}.glb.gz`;
  const glb = await cached(
    name,
    cacheKey(inputs, bake, offset, extras),
    async () =>
      gz(
        await writeMeshGlb({
          ...built().input,
          name: "city",
          extras: { ...extras },
        })
      )
  );
  return { file: publish(name, glb), footprints, maxZ };
}

/** The files a tile's shaped ground is baked from. */
function terrainInputs(tile: string): string[] {
  const source = dgmSourceFiles(SITE, tile);
  return [
    at(source.tif),
    at(source.tfw),
    at(wallSourceFile(SITE, tile)),
    at(stairSourceFile(SITE, tile)),
    at(terraceSourceFile(SITE, tile)),
    at(kerbSourceFile(SITE, tile)),
  ];
}

/** A tile's DGM read at `size` (`"native"`: its own resolution). */
async function tileDgm(tile: string, size: number | "native"): Promise<Dgm> {
  const source = dgmSourceFiles(SITE, tile);
  const tfw = at(source.tfw);
  const buf = readFileSync(at(source.tif));
  return readDgm(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    existsSync(tfw) ? readFileSync(tfw, "utf8") : null,
    size
  );
}

/** What a tile's ground is shaped with besides its walls. */
function groundFeatures(tile: string): TerrainFeatures {
  return {
    passages: passagesIn(tile),
    stairs: stairLines(SITE, tile),
    terraces: terraces(SITE, tile),
  };
}

/** A tile's fine ground: a TIN over the native DGM (bake-terrain-tin.ts),
 *  unless the DGM has holes; then the grid. */
async function bakeFineGround(tile: string): Promise<FineGround> {
  const walls = wallLines(SITE, tile);
  const tin = fineTin(
    await tileDgm(tile, "native"),
    walls,
    groundFeatures(tile),
    FINE_TIN_MAX_ERROR
  );
  if (tin) {
    return { kind: "tin", tin };
  }
  log(`${tile}: the DGM has NoData, the fine level stays a grid`);
  const dgm = await tileDgm(tile, TERRAIN_LEVELS[0].n);
  return { kind: "grid", grid: shapeGrid(dgm, walls, groundFeatures(tile)) };
}

/**
 * Where a tile's fine ground lies in the cache (ground-pack.ts), baked first
 * when it is not there. Cached apart from the fine level's glTF, which
 * stands its walls, kerbs, stairs and fences on every tile's fine ground:
 * a process baking some of the site's tiles (prepare-sites.ts' warmers)
 * reads the others' grounds instead of refining their TINs again.
 */
const groundFiles = new Map<string, Promise<string>>();
function groundFile(tile: string): Promise<string> {
  let file = groundFiles.get(tile);
  if (!file) {
    file = cachedFile(
      `ground_${tile}.bin`,
      cacheKey(terrainInputs(tile), GROUND_BAKE, offset, passagesIn(tile)),
      async () => {
        const t0 = performance.now();
        const packed = packGround(await bakeFineGround(tile));
        log(`ground ${tile}: built in ${since(t0)} ms`);
        return packed;
      }
    );
    groundFiles.set(tile, file);
  }
  return file;
}

/** A tile's shaped terrain at one level (memoised until the tile is baked:
 *  `dropTerrain`). The fine level is the cached ground meshed (`groundFile`),
 *  the coarse one the resampled grid. */
const terrains = new Map<
  string,
  Promise<TerrainMesh & { bounds: TerrainBounds }>
>();
function shapedTerrain(
  tile: string,
  level: 0 | 1
): Promise<TerrainMesh & { bounds: TerrainBounds }> {
  const memo = `${tile}:${level}`;
  let built = terrains.get(memo);
  if (!built) {
    built = (async () => {
      if (level === 0) {
        const ground = unpackGround(readFileSync(await groundFile(tile)));
        return ground.kind === "tin"
          ? {
              ...tinMesh(ground.tin, offset, FINE_TIN_MAX_ERROR),
              bounds: ground.tin.bounds,
            }
          : { ...gridMesh(ground.grid, offset), bounds: ground.grid.bounds };
      }
      const dgm = await tileDgm(tile, TERRAIN_LEVELS[level].n);
      const mesh = terrainMesh(
        dgm,
        wallLines(SITE, tile),
        offset,
        groundFeatures(tile)
      );
      return { ...mesh, bounds: dgm.bounds };
    })();
    terrains.set(memo, built);
  }
  return built;
}

/** Frees a baked tile's shaped terrain (its meshes' arrays). */
function dropTerrain(tile: string): void {
  terrains.delete(`${tile}:0`);
  terrains.delete(`${tile}:1`);
}

/** Each tile's fine ground height, read from the cache when first asked
 *  for (the index over a TIN is ~10 MB, kept). */
const heights = new Map<string, (x: number, y: number) => number | null>();
function heightOver(
  tile: string,
  path: string
): (x: number, y: number) => number | null {
  let heightAt = heights.get(tile);
  if (!heightAt) {
    const ground = unpackGround(readFileSync(path));
    heightAt =
      ground.kind === "tin"
        ? tinHeightAt(ground.tin)
        : gridHeightAt(ground.grid);
    heights.set(tile, heightAt);
  }
  return heightAt;
}

/** Ground height over the whole site: the fine, shaped ground of the tile
 *  holding the point — what the walker stands on at runtime. `tin` is true
 *  when every tile's fine level is a TIN (nothing burned to the wall line,
 *  so the walls snap to the measured step). Every tile's ground is cached
 *  first, one at a time; a tile's heights are read once a point asks. */
let groundTimed = false;
async function siteGround(): Promise<{
  heightAt: (x: number, y: number) => number | null;
  tin: boolean;
}> {
  const t0 = performance.now();
  const fine: { bounds: TerrainBounds; path: string; tin: boolean }[] = [];
  for (const t of TILES) {
    const path = await groundFile(t);
    const { bounds, kind } = readGroundHeader(path);
    fine.push({ bounds, path, tin: kind === "tin" });
  }
  if (!groundTimed) {
    groundTimed = true;
    log(`site ground: ${since(t0)} ms`);
  }
  return {
    heightAt: (x, y) => {
      const i = fine.findIndex((g) => ownsPoint(g.bounds, x, y));
      return i < 0 ? null : heightOver(TILES[i], fine[i].path)(x, y);
    },
    tin: fine.every((g) => g.tin),
  };
}

/** The fine level's own nodes beside the grid: the stairs it owns, its
 *  walls, its kerb stones and its fences, standing on every tile's shaped
 *  ground. Gates cut the fences and the freestanding walls. */
async function fineChildren(
  tile: string,
  bounds: TerrainExtras["bounds"]
): Promise<NonNullable<Parameters<typeof writeMeshGlb>[0]["children"]>> {
  const ground = await siteGround();
  const stairs = stairMesh(stairLines(SITE, tile), offset, bounds, {
    groundAt: ground.heightAt,
    walls: wallLines(SITE, tile).map((w) => w.coords),
  });
  const gates = gatePoints(SITE, tile);
  const cut = cutWallGates(wallLines(SITE, tile), gates);
  const walls = wallMesh(cut.walls, ground.heightAt, offset, {
    snapToStep: ground.tin,
  });
  const kerbs = kerbMesh(kerbLines(SITE, tile), ground.heightAt, offset);
  const fences = fenceMesh(
    fenceLines(SITE, tile),
    gates,
    ground.heightAt,
    offset,
    cut.leaves
  );
  return [stairs, walls, kerbs, fences].filter((m) => m !== null);
}

/** The fine level's allotment colonies (plan 028) and road markings (plan
 *  026) and both levels' baked light (plan 033): only the rasters the tile
 *  has. */
function paintAndLight(
  names: Published,
  level: 0 | 1,
  crop: ColonyCrop | undefined
): Partial<TerrainExtras> {
  return {
    ...(level === 0 && names.cultivatedRaster && crop
      ? {
          cultivated: names.cultivatedRaster,
          cultivatedCrop: crop,
          ...(names.cultivatedLow
            ? { cultivatedLow: names.cultivatedLow }
            : {}),
        }
      : {}),
    ...(level === 0 && names.markings && names.markingsTable
      ? {
          markings: names.markings,
          markingsTable: names.markingsTable,
          ...(names.markingsLow ? { markingsLow: names.markingsLow } : {}),
        }
      : {}),
    ...(names.svf ? { svf: names.svf } : {}),
    ...(names.horizon ? { horizon: names.horizon } : {}),
  };
}

/**
 * The trees the tile's coarse level draws (lib/city/coarse-crowns.ts,
 * scripts/coarse-crowns.ts): the fine level's own placement of the tile's
 * trees on its own ground, a third of them. Pre-gzipped like the packed
 * canopy.
 */
async function publishCrowns(tile: string): Promise<string | undefined> {
  const a = tileArtifacts(tile);
  const side = (kind: TileArtifactKind) => {
    const path = at(sideFileSource(SITE, a[kind].file));
    return existsSync(path) ? path : undefined;
  };
  const sources = {
    canopy: side("canopy"),
    canopyx: side("canopyx"),
    cultivated: side("cultivated"),
    monuments: side("monuments"),
    ndvi: side("ndvi"),
    city: existsSync(at(cityMeshSourceFiles(SITE, tile).city))
      ? at(cityMeshSourceFiles(SITE, tile).city)
      : undefined,
    sheds: existsSync(at(cityMeshSourceFiles(SITE, tile).smallBuild))
      ? at(cityMeshSourceFiles(SITE, tile).smallBuild)
      : undefined,
    trees: side("trees"),
    vegrows: side("vegrows"),
  };
  if (
    !(sources.canopy || sources.canopyx || sources.trees || sources.vegrows)
  ) {
    return undefined;
  }
  const inputs = [
    ...Object.values(sources).filter((p): p is string => p !== undefined),
    ...terrainInputs(tile),
  ];
  const [minX, minY] = tileExtentOf(SITE.tiles[TILES.indexOf(tile)]);
  const file = a.crowns.file;
  const bytes = await cached(
    file,
    cacheKey(
      inputs,
      ["scripts/coarse-crowns.ts", ...GROUND_BAKE],
      offset,
      passagesIn(tile)
    ),
    async () => {
      const fine = await shapedTerrain(tile, 0);
      return gz(
        await bakeCoarseCrowns(sources, {
          bounds: fine.bounds,
          heightAt: fine.heightAt,
          offset,
          origin: [minX, minY],
        })
      );
    }
  );
  return publish(file, bytes);
}

/** A tile's terrain at one level: glTF + its extent and elevation range. */
async function bakeTerrain(
  tile: string,
  level: 0 | 1
): Promise<{
  file: string;
  ground?: number[];
  maxZ: number;
  minZ: number;
}> {
  const source = dgmSourceFiles(SITE, tile);
  if (!existsSync(at(source.tif))) {
    fail(`missing source file ${source.tif}${HINT}`);
  }
  const names = sideFiles.get(tile) ?? {};
  if (level === 1) {
    const crowns = await publishCrowns(tile);
    if (crowns) {
      names.crowns = crowns;
    }
  }
  const { n } = TERRAIN_LEVELS[level];
  // The fine level's walls stand on the neighbours' ground too.
  const inputs =
    level === 0 ? TILES.flatMap(terrainInputs) : terrainInputs(tile);
  const stem = `terrain_${tile}_l${level}`;
  const described = {
    kind: "terrain" as const,
    tileId: tile,
    level,
    n,
    // the coarse level reads its 1024² raster on every tier
    // (lib/city/tile.ts COARSE_RASTER_PX)
    landcover: (level === 0 ? names.landcover : names.landcoverCoarse) ?? "",
    landcoverLow:
      (level === 0 ? names.landcoverLow : names.landcoverCoarse) ?? "",
    ...(names.ndvi ? { ndvi: names.ndvi } : {}),
    ...(level === 0 && names.surface ? { surface: names.surface } : {}),
    ...(level === 0 && names.edges ? { edges: names.edges } : {}),
    ...(names.sport && names.sportTable
      ? { sport: names.sport, sportTable: names.sportTable }
      : {}),
    ...paintAndLight(names, level, colonyCrops.get(tile)),
    ...(level === 0
      ? { dressing: pickFiles(names, DRESSING_KINDS) }
      : { coarse: pickFiles(names, COARSE_DRESSING_KINDS) }),
  };
  // The passages come from every tile's lines and decks (line-levels.ts);
  // the fine level's walls, kerbs, stairs and fences stand on every tile's
  // fine ground, and so on every tile's passages.
  const opened = level === 0 ? passages : passagesIn(tile);
  const bake = [
    ...GROUND_BAKE,
    "scripts/tile-glb.ts",
    // fineChildren: the gates cut the walls
    "lib/city/fences.ts",
    "lib/city/tile.ts",
  ];
  const key = cacheKey(inputs, bake, offset, described, opened);
  const meta = parse<{
    bounds: TerrainExtras["bounds"];
    ground?: number[];
    maxZ: number;
    minZ: number;
    tin?: TerrainExtras["tin"];
  }>(
    await cached(
      `${stem}.json`,
      cacheKey(inputs, bake, offset, described, opened, "ground"),
      async () => {
        const m = await shapedTerrain(tile, level);
        return utf8({
          bounds: m.bounds,
          minZ: m.minElevation,
          maxZ: m.maxElevation,
          ...(level === 1 ? { ground: groundSamples(m) } : {}),
          ...(m.tin ? { tin: m.tin } : {}),
        });
      }
    )
  );
  const extras: TerrainExtras = {
    ...described,
    bounds: meta.bounds,
    minElevation: meta.minZ,
    ...(meta.tin ? { tin: meta.tin } : {}),
  };
  const name = `${stem}.glb.gz`;
  const glb = await cached(name, key, async () =>
    gz(
      await writeMeshGlb({
        ...(await shapedTerrain(tile, level)).input,
        name: "terrain",
        extras: { ...extras },
        // The fine level carries the tile's stairs and walls, baked from the
        // same files the ground was shaped with.
        children: level === 0 ? await fineChildren(tile, meta.bounds) : [],
      })
    )
  );
  return {
    file: publish(name, glb),
    ground: meta.ground,
    minZ: meta.minZ,
    maxZ: meta.maxZ,
  };
}

/** The ground's heights on a coarse grid over the tile (the valley haze's
 *  relief: lib/city/valley-fog.ts). */
function groundSamples(m: {
  bounds: TerrainBounds;
  heightAt: (x: number, y: number) => number | null;
}): number[] {
  const [x0, y0, x1, y1] = m.bounds;
  const out: number[] = [];
  const n = 32;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const h = m.heightAt(
        x0 + ((i + 0.5) / n) * (x1 - x0),
        y0 + ((j + 0.5) / n) * (y1 - y0)
      );
      if (h !== null) {
        out.push(Math.round(h * 10) / 10);
      }
    }
  }
  return out;
}

/** A warmer's last line: what it cached, how long it took, its peak. */
function warmed(what: string): never {
  log(
    `warmed ${what} in ${since(started)} ms, peak RSS ${(process.resourceUsage().maxRSS / 1024 ** 2).toFixed(2)} GiB (published nothing)`
  );
  process.exit(0);
}

if (MODE.kind === "ground") {
  for (const tile of MODE.tiles) {
    await groundFile(tile);
    Bun.gc(true);
  }
  warmed(`the fine ground of ${MODE.tiles.join(", ")}`);
}

const baked: BakedTile[] = [];
const footprintFiles = new Map<string, string>();
const groundHeights: number[] = [];
for (const [i, tile] of TILES.entries()) {
  if (!OWN.has(tile)) {
    continue;
  }
  let t0 = performance.now();
  const city = await bakeCity(tile);
  const cityMs = since(t0);
  footprintFiles.set(tile, city.footprints);
  t0 = performance.now();
  const fine = await bakeTerrain(tile, 0);
  const fineMs = since(t0);
  t0 = performance.now();
  const coarse = await bakeTerrain(tile, 1);
  log(`${tile}: city ${cityMs} ms, fine ${fineMs} ms, coarse ${since(t0)} ms`);
  groundHeights.push(...(coarse.ground ?? []));
  const minZ = Math.min(fine.minZ, coarse.minZ);
  const maxZ = Math.max(fine.maxZ, coarse.maxZ, city.maxZ);
  baked.push({
    id: tile,
    bounds: tileExtentOf(SITE.tiles[i]),
    city: city.file,
    terrain: { 0: fine.file, 1: coarse.file },
    zRange: [
      Number.isFinite(minZ) ? minZ : 0,
      Number.isFinite(maxZ) ? maxZ : 1,
    ],
  });
  // A tile's meshes are hundreds of MB of typed arrays that Bun's lazy
  // collector let pile up over the loop: a cold Dresden reached ~7 GB,
  // more than a 4-core, 8 GB build machine running two sites side by side
  // holds. Dropped and collected after each tile, the loop stays near one
  // tile's peak.
  dropTerrain(tile);
  Bun.gc(true);
}
if (WARMING) {
  warmed(`${baked.map((t) => t.id).join(", ")} (buildings + terrain)`);
}
log(`baked ${TILES.length} tiles (buildings + terrain at two levels)`);

// --- 3. tilesets ------------------------------------------------------------------

// Who publishes each source, and each tile's edition of it: the inquiry
// card's "Quelle" lines (ADR 0042), from the hand-kept record.
/** The site's provenance record; a site without one (freshly fetched)
 *  builds with an empty record — the cards then name sources without
 *  editions. A record that is there but unreadable still fails. */
function readProvenance(): ProvenanceRecord {
  const path = at(`${siteDataDir(SITE)}/provenance.json`);
  if (!existsSync(path)) {
    log(
      `${SITE.id}: no provenance.json — the cards name sources without editions`
    );
    return {};
  }
  return readJson<ProvenanceRecord>(path);
}
const provenanceFile = publish(
  PROVENANCE_FILE,
  utf8(
    siteProvenance(
      readProvenance(),
      baked.map((t) => t.id),
      SITE
    )
  )
);
// The trams' timetable, site-wide (pipeline/bake/transit.py): optional.
const tramSource = at(tramTimetableSource(siteDataDir(SITE)));
const trams = existsSync(tramSource)
  ? publish(TRAM_TIMETABLE_FILE, readFileSync(tramSource))
  : undefined;

const extras: TilesetExtras = {
  site: SITE.id,
  landmarks: siteLandmarks(
    TILES.map(landmarkFile).filter((f): f is LandmarkFile => f !== undefined)
  ),
  epsg: frame.epsg,
  ...(groundHeights.length > 0 ? { ground: groundRelief(groundHeights) } : {}),
  offset,
  provenance: provenanceFile,
  tiles: baked.map((t) => ({
    id: t.id,
    bounds: t.bounds,
    footprints: footprintFiles.get(t.id) ?? "",
    minimap: sideFiles.get(t.id)?.landcoverSmall ?? "",
    bridges: sideFiles.get(t.id)?.bridge,
    ask: pickFiles(sideFiles.get(t.id) ?? {}, ASK_KINDS),
  })),
  ...(trams ? { trams } : {}),
};
publish(TILESET_FILE, utf8(buildTileset(baked, extras)));
publish(
  TILESET_SPAWN_FILE,
  utf8(
    buildTileset(baked.slice(0, 1), {
      ...extras,
      tiles: extras.tiles.slice(0, 1),
    })
  )
);

// --- the map picture ------------------------------------------------------------
// The site's land cover in the viewer's palette as one map
// (scripts/bake-wissen-hero.ts): the start page's card for the site and the
// knowledge base's hero, both sized by next/image. Not a viewer artifact:
// optional.

const HERO_FILE = SITE_MAP_FILE;
const rasters = TILES.map((tile) =>
  at(sideFileSource(SITE, tileArtifacts(tile).landcover.file))
);
if (rasters.every((path) => existsSync(path))) {
  // bake-wissen-hero.ts imports the palette (lib/city/landcover.ts)
  const hero = await cached(
    siteWide(HERO_FILE),
    cacheKey(rasters, ["scripts/bake-wissen-hero.ts"]),
    () => bakeWissenHero(SITE.tiles, rasters, 1600)
  );
  publish(HERO_FILE, hero);
} else {
  log("land-cover raster missing, skipping the map picture");
}

// --- the city in numbers ------------------------------------------------------------
// The start page's orderings (lib/city/site-stats.ts): shares of the land
// cover, crowns per km², the buildings' heights and footprint share, the
// relief, the landmarks. Not hashed: prepare-sites folds it into the index.

const statSources = TILES.flatMap((tile) => {
  const kinds = tileArtifacts(tile);
  return [
    at(sideFileSource(SITE, kinds.landcover.file)),
    at(sideFileSource(SITE, kinds.canopy.file)),
    at(sideFileSource(SITE, kinds.canopyx.file)),
    at(cityMeshSourceFiles(SITE, tile).city),
    at(cityMeshSourceFiles(SITE, tile).landmarks),
    // the scan's sheds and the structures join the footprints
    at(cityMeshSourceFiles(SITE, tile).smallBuild),
    at(cityMeshSourceFiles(SITE, tile).structures),
  ];
});
const stats = await cached(
  siteWide(SITE_STATS_FILE),
  cacheKey(
    statSources,
    ["lib/city/site-stats.ts", "lib/city/tile.ts"],
    extras.ground ?? null,
    // the footprints' published names hash their content
    [...footprintFiles.values()]
  ),
  async () => utf8(await siteStats())
);
writeFileSync(join(OUT_DIR, SITE_STATS_FILE), stats);
keep.add(SITE_STATS_FILE);

async function siteStats(): Promise<SiteStats> {
  const histogram: number[] = [];
  let crowns = 0;
  let footprint = 0;
  let landmarks = 0;
  const heights: number[] = [];
  for (const tile of TILES) {
    const kinds = tileArtifacts(tile);
    const classes = at(sideFileSource(SITE, kinds.landcover.file));
    if (existsSync(classes)) {
      const { data } = await sharp(classes)
        .removeAlpha()
        .toColourspace("b-w")
        .resize(512, 512, { kernel: "nearest" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (const c of data) {
        histogram[c] = (histogram[c] ?? 0) + 1;
      }
    }
    for (const kind of ["canopy", "canopyx"] as const) {
      const src = at(sideFileSource(SITE, kinds[kind].file));
      if (existsSync(src)) {
        crowns += readJson<{ features: unknown[] }>(src).features.length;
      }
    }
    heights.push(
      ...buildingHeights(
        readJson<CityJsonDocument>(at(cityMeshSourceFiles(SITE, tile).city))
      )
    );
    const prints = footprintFiles.get(tile);
    if (prints) {
      footprint += footprintArea(
        readJson<[number, number][][][]>(join(OUT_DIR, prints))
      );
    }
    landmarks += landmarkFile(tile)?.landmarks.length ?? 0;
  }
  const areaKm2 = TILES.length * 4;
  const relief = extras.ground ? extras.ground[1] - extras.ground[0] : 0;
  const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    areaKm2,
    buildingsPerKm2: round(heights.length / areaKm2, 1),
    builtShare: round(footprint / (areaKm2 * 1e6)),
    crownsPerKm2: round(crowns / areaKm2, 1),
    ...Object.fromEntries(
      Object.entries(landcoverShares(histogram)).map(([k, v]) => [k, round(v)])
    ),
    landmarks,
    medianHeightM: round(quantile(heights, 0.5), 1),
    reliefM: round(relief, 1),
    tallestM: round(quantile(heights, 1), 1),
  } as SiteStats;
}

// --- 4. manifest + prune -------------------------------------------------------------

writeFileSync(
  join(OUT_DIR, MANIFEST_FILE),
  `${JSON.stringify(manifest, null, 2)}\n`
);
let pruned = 0;
for (const entry of readdirSync(OUT_DIR)) {
  if (!keep.has(entry)) {
    rmSync(join(OUT_DIR, entry), { recursive: true });
    pruned++;
  }
}
log(
  `${Object.keys(manifest.files).length} artifacts in public/data/${SITE.id} (${published} new, ${pruned} pruned)`
);
// resourceUsage's maxRSS is in KiB
log(
  `done in ${since(started)} ms, peak RSS ${(process.resourceUsage().maxRSS / 1024 ** 2).toFixed(2)} GiB`
);
