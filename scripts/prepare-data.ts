/**
 * Prepares the site for the browser: bakes its tiles into an OGC 3D Tiles
 * tileset (lib/city/tileset.ts) and publishes everything under
 * content-hashed names. Four steps:
 *
 *  1. **Side files** — each tile's rasters and feature collections
 *     (lib/city/tile.ts, `tileArtifacts`): committed files under data/dlm/
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
 * Baked outputs are cached in `.cache/prepare-data/` (gitignored) under a
 * key of their inputs, the bake's own sources and the names they reference,
 * so a rerun is cheap and a changed bake never serves a stale cache.
 * Runs ahead of `dev` and `build`; public/data/ is gitignored.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Matrix4 } from "three";
import type { RoofColorLut } from "../lib/city/building-tint";
import type { OsmBuildingLut } from "../lib/city/city-mesh";
import type {
  CanopyFeature,
  FeatureCollection,
  KerbFeature,
  SmallBuildingFeature,
  StairFeature,
  GateFeature,
  TerraceFeature,
  WallFileFeature,
} from "../lib/city/features";
import {
  cutWallGates,
  type FenceLine,
  type FenceType,
  type GatePoint,
} from "../lib/city/fences";
import type { Point2 } from "../lib/city/polyline";
import { tileExtentOf } from "../lib/city/site";
import { treesOffStructures } from "../lib/city/small-buildings";
import {
  type StairLine,
  stairLineOf,
  type Terrace,
  terraceOf,
} from "../lib/city/stairs";
import type { WallLine } from "../lib/city/terrain-conflate";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import type { WallRibbon } from "../lib/city/walls";
import {
  cityMeshSourceFiles,
  type DataManifest,
  dgmSourceFiles,
  kerbSourceFile,
  MANIFEST_FILE,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  wallSourceFile,
  tileIds,
} from "../lib/city/tile";
import {
  ownsPoint,
  type BakedTile,
  buildTileset,
  type CityExtras,
  type DressingFiles,
  TERRAIN_LEVELS,
  type TerrainExtras,
  TILESET_FILE,
  TILESET_SPAWN_FILE,
  type TileSoundFiles,
  type TilesetExtras,
} from "../lib/city/tileset";
import type { CityJsonDocument } from "../lib/city/types";
import { currentSite } from "../sites";
import { type BakedCityMesh, bakeCityMesh } from "./bake-city-mesh";
import {
  cityMesh,
  fenceMesh,
  kerbMesh,
  readDgm,
  stairMesh,
  type TerrainMesh,
  terrainMesh,
  tinTerrainMesh,
  wallMesh,
} from "./bake-tiles";
import { FINE_TIN_MAX_ERROR } from "./bake-terrain-tin";
import { bakeWissenHero } from "./bake-wissen-hero";
import { type ColonyCrop, cropColonyRaster } from "./crop-raster";
import { downsampleClassRaster } from "./downsample-raster";
import { writeMeshGlb } from "./tile-glb";

const OUT_DIR = join(process.cwd(), "public/data");
const CACHE_DIR = join(process.cwd(), ".cache/prepare-data");
const SITE = currentSite();
const TILES = tileIds(SITE);

function fail(message: string): never {
  process.stderr.write(`prepare-data: ${message}\n`);
  process.exit(1);
}

function log(message: string): void {
  process.stdout.write(`prepare-data: ${message}\n`);
}

const at = (path: string) => join(process.cwd(), path);
const utf8 = (value: unknown) =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`);
const parse = <T>(bytes: Uint8Array): T =>
  JSON.parse(new TextDecoder().decode(bytes)) as T;
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T;

// --- publish ------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const manifest: DataManifest = { version: 1, files: {} };
const keep = new Set<string>([MANIFEST_FILE]);
let published = 0;

/** `name.ext` → `name.<8 hex of sha1>.ext` (`.glb.gz` keeps both). */
function hashedName(file: string, content: Uint8Array): string {
  const hash = createHash("sha1").update(content).digest("hex").slice(0, 8);
  const ext = file.match(/(\.glb\.gz|\.[^.]+)$/u)?.[0] ?? "";
  return `${basename(file, ext)}.${hash}${ext}`;
}

/** Publishes one artifact and returns the name it is served under. */
function publish(logical: string, content: Uint8Array): string {
  const hashed = hashedName(logical, content);
  manifest.files[logical] = hashed;
  keep.add(hashed);
  const dest = join(OUT_DIR, hashed);
  if (!existsSync(dest)) {
    writeFileSync(dest, content);
    published++;
  }
  return hashed;
}

// --- cache --------------------------------------------------------------------

/** The bake's own sources: a change to any of them re-bakes everything. */
const BAKE_SOURCES = [
  "scripts/prepare-data.ts",
  "scripts/bake-tiles.ts",
  "scripts/bake-terrain-tin.ts",
  "lib/city/terrain-tin.ts",
  "lib/city/wall-snap.ts",
  "scripts/bake-city-mesh.ts",
  "scripts/tile-glb.ts",
  "scripts/downsample-raster.ts",
  "scripts/crop-raster.ts",
  "lib/city/city-mesh.ts",
  "lib/city/building-tint.ts",
  "lib/city/minimap.ts",
  "lib/city/small-buildings.ts",
  "lib/city/terrain-geometry.ts",
  "lib/city/terrain-conflate.ts",
  "lib/city/stairs.ts",
  "lib/city/walls.ts",
  "lib/city/kerbs.ts",
  "lib/city/fences.ts",
  "lib/city/polyline.ts",
  "lib/city/ground-clamp.ts",
  "lib/city/tileset.ts",
].map(at);

/** A cache key over input files (by mtime + size) and any extra values. */
function cacheKey(inputs: string[], ...extra: unknown[]): string {
  const h = createHash("sha1");
  for (const path of [...inputs, ...BAKE_SOURCES]) {
    if (existsSync(path)) {
      const { mtimeMs, size } = statSync(path);
      h.update(`${path}:${mtimeMs}:${size};`);
    }
  }
  h.update(JSON.stringify(extra));
  return h.digest("hex").slice(0, 12);
}

/** The cached bytes for `key`, or the baked ones (then cached). */
async function cached(
  name: string,
  key: string,
  bake: () => Promise<Uint8Array> | Uint8Array
): Promise<Uint8Array> {
  const path = join(CACHE_DIR, `${key}.${name}`);
  if (existsSync(path)) {
    return readFileSync(path);
  }
  const bytes = await bake();
  mkdirSync(CACHE_DIR, { recursive: true });
  // One entry per name: drop this artifact's stale keys.
  for (const entry of readdirSync(CACHE_DIR)) {
    if (entry.endsWith(`.${name}`)) {
      rmSync(join(CACHE_DIR, entry));
    }
  }
  writeFileSync(path, bytes);
  return bytes;
}

// --- 1. side files --------------------------------------------------------------

/** tile → artifact kind → published name (absent optional files: missing) */
const sideFiles = new Map<string, Partial<Record<string, string>>>();
/** tile → where its published colony raster lies in the tile */
const colonyCrops = new Map<string, ColonyCrop>();

/**
 * The colony raster cropped to its colonies, and the half-resolution twin
 * phones read (`cultivatedLow`); a tile without a colony publishes neither.
 */
async function publishColonies(
  tile: string,
  file: string,
  names: Partial<Record<string, string>>
): Promise<void> {
  const src = at(`data/dlm/${file}`);
  const key = cacheKey([src]);
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

/**
 * The canopy (DOM1) or the laser-scan crowns without the points that stand
 * in or within 0.5 m of one of the tile's scan structures: DOM1 reads a
 * shed's roof as a 3–4 m tree (lib/city/small-buildings.ts). Here, not in
 * the canopy bake, because the structures are baked after the canopy.
 */
async function publishCanopy(tile: string, file: string): Promise<string> {
  const src = at(`data/dlm/${file}`);
  const sheds = at(cityMeshSourceFiles(tile).smallBuild);
  const bytes = await cached(file, cacheKey([src, sheds]), () => {
    const doc = readJson<FeatureCollection<CanopyFeature>>(src);
    if (!existsSync(sheds)) {
      return readFileSync(src);
    }
    const trees = doc.features ?? [];
    const structures =
      readJson<FeatureCollection<SmallBuildingFeature>>(sheds).features ?? [];
    const features = treesOffStructures(trees, structures);
    log(
      `${file}: ${trees.length - features.length} points in a scan structure dropped`
    );
    return utf8({ ...doc, features });
  });
  return publish(file, bytes);
}

for (const tile of TILES) {
  const names: Partial<Record<string, string>> = {};
  for (const [kind, artifact] of Object.entries(tileArtifacts(tile))) {
    if (
      kind === "cultivatedRaster" &&
      existsSync(at(`data/dlm/${artifact.file}`))
    ) {
      await publishColonies(tile, artifact.file, names);
      continue;
    }
    if (
      (kind === "canopy" || kind === "canopyx") &&
      existsSync(at(`data/dlm/${artifact.file}`))
    ) {
      names[kind] = await publishCanopy(tile, artifact.file);
      continue;
    }
    if (artifact.bakedFrom) {
      const src = at(`data/dlm/${artifact.bakedFrom.file}`);
      if (!existsSync(src)) {
        fail(`missing source file data/dlm/${artifact.bakedFrom.file}`);
      }
      const { raster } = artifact.bakedFrom;
      const bytes = await cached(artifact.file, cacheKey([src]), () =>
        downsampleClassRaster(src, raster)
      );
      names[kind] = publish(artifact.file, bytes);
      continue;
    }
    const src = at(`data/dlm/${artifact.file}`);
    if (existsSync(src)) {
      names[kind] = publish(artifact.file, readFileSync(src));
    } else if (artifact.required) {
      fail(`missing source file data/dlm/${artifact.file}`);
    } else {
      // The loader treats a missing optional artifact as "feature off".
      log(`optional source absent, skipping ${artifact.file}`);
    }
  }
  sideFiles.set(tile, names);
}

// --- 2. content -----------------------------------------------------------------

/**
 * Every tile is recentered on one offset: the spawn tile's CityJSON loader
 * matrix, reused for the rest (the frame snapshots are recorded in).
 */
let sharedMatrix: Matrix4 | null = null;

function parseCity(tile: string): BakedCityMesh {
  const src = cityMeshSourceFiles(tile);
  if (!existsSync(at(src.city))) {
    fail(`missing source file ${src.city}`);
  }
  if (!sharedMatrix && tile !== TILES[0]) {
    parseCity(TILES[0]);
  }
  const doc = readJson<CityJsonDocument>(at(src.city));
  const roofLut = existsSync(at(src.roofColor))
    ? readJson<{ roofs?: RoofColorLut }>(at(src.roofColor)).roofs
    : undefined;
  const osmLut = existsSync(at(src.osmBuild))
    ? readJson<{ objects?: OsmBuildingLut }>(at(src.osmBuild)).objects
    : undefined;
  const scan = existsSync(at(src.smallBuild))
    ? readJson<FeatureCollection<SmallBuildingFeature>>(at(src.smallBuild))
        .features
    : undefined;
  const baked = bakeCityMesh(tile, doc, roofLut, sharedMatrix, osmLut, scan);
  sharedMatrix ??= baked.matrix;
  return baked;
}

/** The shared offset and CRS, cached with the spawn tile's CityJSON. */
const frame = parse<{ cx: number; cy: number; epsg: number }>(
  await cached(
    "frame.json",
    cacheKey([at(cityMeshSourceFiles(TILES[0]).city)]),
    () => {
      const baked = parseCity(TILES[0]);
      return utf8({ ...baked.offset, epsg: baked.epsg });
    }
  )
);
const offset = { cx: frame.cx, cy: frame.cy };

const gz = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 });

/** A tile's buildings: footprints JSON + glTF, both from one parse. */
async function bakeCity(
  tile: string
): Promise<{ file: string; footprints: string; maxZ: number }> {
  const src = cityMeshSourceFiles(tile);
  const inputs = [
    at(src.city),
    at(src.roofColor),
    at(src.osmBuild),
    at(src.smallBuild),
  ];
  const key = cacheKey(inputs, offset);
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
  const extras: CityExtras = {
    kind: "city",
    tileId: tile,
    // The facades' ambient light reads the terrain's sky-view raster.
    ...(svf ? { svf } : {}),
  };
  const name = `city_${tile}.glb.gz`;
  const glb = await cached(name, cacheKey(inputs, offset, extras), async () =>
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

/** The tile's kerb lines (the smoothed DLM road edge), for the kerb stones
 *  the fine level carries. */
function kerbLines(tile: string): Point2[][] {
  const path = at(kerbSourceFile(tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: KerbFeature[] }>(path);
  return features.flatMap((f) =>
    f.geometry?.type === "LineString" ? [f.geometry.coordinates] : []
  );
}

/** Everything the tile's walls file carries: walls, fences, gates. */
function wallFile(tile: string): WallFileFeature[] {
  const path = at(wallSourceFile(tile));
  return existsSync(path)
    ? readJson<{ features: WallFileFeature[] }>(path).features
    : [];
}

/** The tile's OSM walls: the lines the terrain conflation burns in, and the
 *  ribbons the fine level carries. Not the fences: they never shape the
 *  ground. */
function wallLines(tile: string): (WallLine & WallRibbon)[] {
  return wallFile(tile).flatMap((f) =>
    f.geometry?.type === "LineString" && f.properties?.kind !== "fence"
      ? [
          {
            coords: f.geometry.coordinates,
            kind: f.properties?.kind ?? "wall",
            h: (f.properties as { h?: number } | null)?.h ?? 2,
          },
        ]
      : []
  );
}

const FENCE_TYPES = new Set<FenceType>(["mesh", "picket", "rail", "railing"]);

/** The tile's OSM fences and railings, standing on their lines. */
function fenceLines(tile: string): FenceLine[] {
  return wallFile(tile).flatMap((f) => {
    if (f.geometry?.type !== "LineString" || f.properties?.kind !== "fence") {
      return [];
    }
    const p = f.properties as { h?: number; type?: string };
    const type = FENCE_TYPES.has(p.type as FenceType)
      ? (p.type as FenceType)
      : "railing";
    return [{ coords: f.geometry.coordinates, h: p.h ?? 1.2, type }];
  });
}

/** The gates on the tile's wall and fence lines (a neighbour's too, where
 *  its gap reaches over the seam). */
function gatePoints(tile: string): GatePoint[] {
  const isGate = (f: WallFileFeature): f is GateFeature =>
    f.geometry?.type === "Point" && f.properties?.kind === "gate";
  return wallFile(tile)
    .filter(isGate)
    .flatMap((f) =>
      f.properties
        ? [
            {
              at: f.geometry.coordinates,
              on: f.properties.on,
              w: f.properties.w,
              ...(f.properties.type ? { type: f.properties.type } : {}),
              ...(f.properties.seam ? { seam: true } : {}),
            },
          ]
        : []
    );
}

/** The tile's OSM stairs: the terrain bake shapes the ground under them and
 *  writes them into the fine level's glTF. */
function stairLines(tile: string): StairLine[] {
  const path = at(stairSourceFile(tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: StairFeature[] }>(path);
  return features.flatMap((f) => stairLineOf(f) ?? []);
}

/** The raised areas the terrain bake lifts to their level. */
function terraces(tile: string): Terrace[] {
  const path = at(terraceSourceFile(tile));
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: TerraceFeature[] }>(path);
  return features.flatMap((f) => terraceOf(f) ?? []);
}

function dressingOf(names: Partial<Record<string, string>>): DressingFiles {
  const pick = (kind: keyof DressingFiles) => names[kind] ?? "";
  return {
    bridge: pick("bridge"),
    canopy: pick("canopy"),
    furniture: pick("furniture"),
    lamps: pick("lamps"),
    monuments: pick("monuments"),
    platform: pick("platform"),
    rail: pick("rail"),
    railarea: pick("railarea"),
    vegrows: pick("vegrows"),
    // Only the tiles that have them name them: an absent file is a feature
    // off, never a request that can only 404.
    ...(names.trees ? { trees: names.trees } : {}),
    ...(names.lowveg ? { lowveg: names.lowveg } : {}),
    ...(names.canopyx ? { canopyx: names.canopyx } : {}),
    ...(names.cultivated ? { cultivated: names.cultivated } : {}),
    ...(names.tram ? { tram: names.tram } : {}),
    ...(names.riverside ? { riverside: names.riverside } : {}),
  };
}

/** What the hidden soundscape fetches of a tile while it plays (plan 035):
 *  only the files the tile has. */
function soundFilesOf(names: Partial<Record<string, string>>): TileSoundFiles {
  const kinds = ["monuments", "soundmarks", "surface", "svf", "tram"] as const;
  return Object.fromEntries(
    kinds.flatMap((k) => (names[k] ? [[k, names[k]]] : []))
  );
}

/** The files a tile's shaped ground is baked from. */
function terrainInputs(tile: string): string[] {
  const source = dgmSourceFiles(tile);
  return [
    at(source.tif),
    at(source.tfw),
    at(wallSourceFile(tile)),
    at(stairSourceFile(tile)),
    at(terraceSourceFile(tile)),
    at(kerbSourceFile(tile)),
  ];
}

/** A tile's shaped terrain at one level (memoised: the fine levels of every
 *  tile are also the ground the walls stand on). The fine level is a TIN
 *  over the native DGM (bake-terrain-tin.ts), unless the DGM has holes; the
 *  coarse one the resampled grid. */
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
      const source = dgmSourceFiles(tile);
      const tif = at(source.tif);
      const tfw = at(source.tfw);
      const buf = readFileSync(tif);
      const read = (size: number | "native") =>
        readDgm(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          existsSync(tfw) ? readFileSync(tfw, "utf8") : null,
          size
        );
      const features = { stairs: stairLines(tile), terraces: terraces(tile) };
      if (level === 0) {
        const dgm = await read("native");
        const tin = tinTerrainMesh(
          dgm,
          wallLines(tile),
          offset,
          features,
          FINE_TIN_MAX_ERROR
        );
        if (tin) {
          return { ...tin, bounds: dgm.bounds };
        }
        log(`${tile}: the DGM has NoData, the fine level stays a grid`);
      }
      const dgm = await read(TERRAIN_LEVELS[level].n);
      const mesh = terrainMesh(dgm, wallLines(tile), offset, features);
      return { ...mesh, bounds: dgm.bounds };
    })();
    terrains.set(memo, built);
  }
  return built;
}

/** Ground height over the whole site: the fine, shaped ground of the tile
 *  holding the point — what the walker stands on at runtime. `tin` is true
 *  when every tile's fine level is a TIN (nothing burned to the wall line,
 *  so the walls snap to the measured step). */
async function siteGround(): Promise<{
  heightAt: (x: number, y: number) => number | null;
  tin: boolean;
}> {
  const fine = await Promise.all(TILES.map((t) => shapedTerrain(t, 0)));
  return {
    heightAt: (x, y) =>
      fine.find((g) => ownsPoint(g.bounds, x, y))?.heightAt(x, y) ?? null,
    tin: fine.every((g) => g.tin !== undefined),
  };
}

/** The fine level's own nodes beside the grid: the stairs it owns, its
 *  walls, its kerb stones and its fences, standing on every tile's shaped
 *  ground. Gates cut the fences and the freestanding walls. */
async function fineChildren(
  tile: string,
  bounds: TerrainExtras["bounds"]
): Promise<NonNullable<Parameters<typeof writeMeshGlb>[0]["children"]>> {
  const stairs = stairMesh(stairLines(tile), offset, bounds);
  const ground = await siteGround();
  const gates = gatePoints(tile);
  const cut = cutWallGates(wallLines(tile), gates);
  const walls = wallMesh(cut.walls, ground.heightAt, offset, {
    snapToStep: ground.tin,
  });
  const kerbs = kerbMesh(kerbLines(tile), ground.heightAt, offset);
  const fences = fenceMesh(
    fenceLines(tile),
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
  names: Partial<Record<string, string>>,
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

/** A tile's terrain at one level: glTF + its extent and elevation range. */
async function bakeTerrain(
  tile: string,
  level: 0 | 1
): Promise<{ file: string; maxZ: number; minZ: number }> {
  const source = dgmSourceFiles(tile);
  if (!existsSync(at(source.tif))) {
    fail(`missing source file ${source.tif}`);
  }
  const names = sideFiles.get(tile) ?? {};
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
    landcover: (level === 0 ? names.landcover : names.landcoverLow) ?? "",
    landcoverLow: names.landcoverLow ?? "",
    ...(names.ndvi ? { ndvi: names.ndvi } : {}),
    ...(level === 0 && names.surface ? { surface: names.surface } : {}),
    ...(level === 0 && names.edges ? { edges: names.edges } : {}),
    ...(names.sport && names.sportTable
      ? { sport: names.sport, sportTable: names.sportTable }
      : {}),
    ...paintAndLight(names, level, colonyCrops.get(tile)),
    ...(level === 0 ? { dressing: dressingOf(names) } : {}),
  };
  const key = cacheKey(inputs, offset, described);
  const meta = parse<{
    bounds: TerrainExtras["bounds"];
    maxZ: number;
    minZ: number;
    tin?: TerrainExtras["tin"];
  }>(
    await cached(`${stem}.json`, key, async () => {
      const m = await shapedTerrain(tile, level);
      return utf8({
        bounds: m.bounds,
        minZ: m.minElevation,
        maxZ: m.maxElevation,
        ...(m.tin ? { tin: m.tin } : {}),
      });
    })
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
  return { file: publish(name, glb), minZ: meta.minZ, maxZ: meta.maxZ };
}

const baked: BakedTile[] = [];
const footprintFiles = new Map<string, string>();
for (const [i, tile] of TILES.entries()) {
  const city = await bakeCity(tile);
  footprintFiles.set(tile, city.footprints);
  const fine = await bakeTerrain(tile, 0);
  const coarse = await bakeTerrain(tile, 1);
  const minZ = Math.min(fine.minZ, coarse.minZ);
  const maxZ = Math.max(fine.maxZ, coarse.maxZ, city.maxZ);
  baked.push({
    id: tile,
    bounds: tileExtentOf(SITE, SITE.tiles[i]),
    city: city.file,
    terrain: { 0: fine.file, 1: coarse.file },
    zRange: [
      Number.isFinite(minZ) ? minZ : 0,
      Number.isFinite(maxZ) ? maxZ : 1,
    ],
  });
}
log(`baked ${TILES.length} tiles (buildings + terrain at two levels)`);

// --- 3. tilesets ------------------------------------------------------------------

const extras: TilesetExtras = {
  site: SITE.id,
  epsg: frame.epsg,
  offset,
  tiles: baked.map((t) => ({
    id: t.id,
    bounds: t.bounds,
    footprints: footprintFiles.get(t.id) ?? "",
    minimap: sideFiles.get(t.id)?.landcoverLow ?? "",
    sound: soundFilesOf(sideFiles.get(t.id) ?? {}),
  })),
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

// --- the /wissen picture ------------------------------------------------------------
// The block's land cover in the viewer's palette as one map
// (scripts/bake-wissen-hero.ts) for the knowledge-base pages, which let
// next/image size it. Not a viewer artifact: optional.

const HERO_FILE = "wissen-hero.webp";
const rasters = TILES.map((tile) =>
  at(`data/dlm/${tileArtifacts(tile).landcover.file}`)
);
if (rasters.every((path) => existsSync(path))) {
  const heroSources = [
    ...rasters,
    at("scripts/bake-wissen-hero.ts"),
    at("lib/city/landcover.ts"),
  ];
  const hero = await cached(HERO_FILE, cacheKey(heroSources), () =>
    bakeWissenHero(
      TILES,
      (tile) => rasters[TILES.indexOf(tile)],
      1600,
      SITE.tileKm
    )
  );
  publish(HERO_FILE, hero);
} else {
  log("land-cover raster missing, skipping the /wissen picture");
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
  `${Object.keys(manifest.files).length} artifacts in public/data (${published} new, ${pruned} pruned)`
);
