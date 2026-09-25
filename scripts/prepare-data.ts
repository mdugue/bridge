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
 *     (DGM → glTF, bake-tiles.ts), each glTF naming its side files in
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
import type {
  StairFeature,
  TerraceFeature,
  WallFeature,
} from "../lib/city/features";
import { tileExtentOf } from "../lib/city/site";
import {
  type StairLine,
  stairLineOf,
  type Terrace,
  terraceOf,
} from "../lib/city/stairs";
import type { WallLine } from "../lib/city/terrain-conflate";
import {
  cityMeshSourceFiles,
  type DataManifest,
  dgmSourceFiles,
  MANIFEST_FILE,
  stairSourceFile,
  terraceSourceFile,
  tileArtifacts,
  tileIds,
} from "../lib/city/tile";
import {
  type BakedTile,
  buildTileset,
  type CityExtras,
  type DressingFiles,
  TERRAIN_LEVELS,
  type TerrainExtras,
  TILESET_FILE,
  TILESET_SPAWN_FILE,
  type TilesetExtras,
} from "../lib/city/tileset";
import type { CityJsonDocument } from "../lib/city/types";
import { currentSite } from "../sites";
import { type BakedCityMesh, bakeCityMesh } from "./bake-city-mesh";
import { cityMesh, readDgm, stairMesh, terrainMesh } from "./bake-tiles";
import { bakeWissenHero } from "./bake-wissen-hero";
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
  "scripts/bake-city-mesh.ts",
  "scripts/tile-glb.ts",
  "scripts/downsample-raster.ts",
  "lib/city/city-mesh.ts",
  "lib/city/building-tint.ts",
  "lib/city/minimap.ts",
  "lib/city/terrain-geometry.ts",
  "lib/city/terrain-conflate.ts",
  "lib/city/stairs.ts",
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

for (const tile of TILES) {
  const names: Partial<Record<string, string>> = {};
  for (const [kind, artifact] of Object.entries(tileArtifacts(tile))) {
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
  const baked = bakeCityMesh(tile, doc, roofLut, sharedMatrix);
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
  const inputs = [at(src.city), at(src.roofColor)];
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
  const extras: CityExtras = { kind: "city", tileId: tile };
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

/** The tile's OSM walls as the lines the terrain conflation burns in. */
function wallLines(tile: string): WallLine[] {
  const path = at(`data/dlm/${tileArtifacts(tile).walls.file}`);
  if (!existsSync(path)) {
    return [];
  }
  const { features } = readJson<{ features: WallFeature[] }>(path);
  return features.flatMap((f) =>
    f.geometry?.type === "LineString"
      ? [{ coords: f.geometry.coordinates, kind: f.properties?.kind ?? "wall" }]
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

/** The fine level's stairs node, if the tile owns any flight. */
function stairChildren(
  level: 0 | 1,
  tile: string,
  bounds: TerrainExtras["bounds"]
): NonNullable<Parameters<typeof writeMeshGlb>[0]["children"]> {
  const stairs =
    level === 0 ? stairMesh(stairLines(tile), offset, bounds) : null;
  return stairs ? [stairs] : [];
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
    lamps: pick("lamps"),
    platform: pick("platform"),
    rail: pick("rail"),
    railarea: pick("railarea"),
    vegrows: pick("vegrows"),
    walls: pick("walls"),
  };
}

/** A tile's terrain at one level: glTF + its extent and elevation range. */
async function bakeTerrain(
  tile: string,
  level: 0 | 1
): Promise<{ file: string; maxZ: number; minZ: number }> {
  const source = dgmSourceFiles(tile);
  const tif = at(source.tif);
  const tfw = at(source.tfw);
  if (!existsSync(tif)) {
    fail(`missing source file ${source.tif}`);
  }
  const names = sideFiles.get(tile) ?? {};
  const { n } = TERRAIN_LEVELS[level];
  const artifacts = tileArtifacts(tile);
  const inputs = [
    tif,
    tfw,
    at(`data/dlm/${artifacts.walls.file}`),
    at(stairSourceFile(tile)),
    at(terraceSourceFile(tile)),
  ];
  const stem = `terrain_${tile}_l${level}`;
  const described = {
    kind: "terrain" as const,
    tileId: tile,
    level,
    n,
    landcover: (level === 0 ? names.landcover : names.landcoverLow) ?? "",
    landcoverLow: names.landcoverLow ?? "",
    ...(names.ndvi ? { ndvi: names.ndvi } : {}),
    ...(level === 0 ? { dressing: dressingOf(names) } : {}),
  };
  const key = cacheKey(inputs, offset, described);
  let mesh: ReturnType<typeof terrainMesh> | null = null;
  let bounds: TerrainExtras["bounds"] = [0, 0, 0, 0];
  const built = async () => {
    if (!mesh) {
      const buf = readFileSync(tif);
      const dgm = await readDgm(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        existsSync(tfw) ? readFileSync(tfw, "utf8") : null,
        n
      );
      bounds = dgm.bounds;
      mesh = terrainMesh(dgm, wallLines(tile), offset, {
        stairs: stairLines(tile),
        terraces: terraces(tile),
      });
    }
    return mesh;
  };
  const meta = parse<{
    bounds: TerrainExtras["bounds"];
    maxZ: number;
    minZ: number;
  }>(
    await cached(`${stem}.json`, key, async () => {
      const m = await built();
      return utf8({ bounds, minZ: m.minElevation, maxZ: m.maxElevation });
    })
  );
  const extras: TerrainExtras = {
    ...described,
    bounds: meta.bounds,
    minElevation: meta.minZ,
  };
  const name = `${stem}.glb.gz`;
  const glb = await cached(name, key, async () =>
    gz(
      await writeMeshGlb({
        ...(await built()).input,
        name: "terrain",
        extras: { ...extras },
        // The fine level carries the tile's stairs, baked from the same
        // flights the ground was shaped for.
        children: stairChildren(level, tile, meta.bounds),
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
