/**
 * Step 1 of scripts/prepare-data.ts: each tile's side files, published as
 * they are or baked (the colony crops, the packed canopy, the downsampled
 * class rasters). Their bakes' entries name this module (bake-entries.ts
 * `colonies`, `canopy`, `classRaster`).
 */
import { existsSync, readFileSync } from "node:fs";
import type {
  CanopyFeature,
  FeatureCollection,
  SmallBuildingFeature,
  StructureFeature,
} from "../../lib/city/features";
import { tileExtentOf } from "../../lib/city/site";
import {
  canopyStride,
  packPoints,
  pointOf,
  ROWS_MEASURED,
} from "../../lib/city/point-pack";
import {
  gapRoofs,
  lod2Roofs,
  type RoofFootprint,
  treesOffRoofs,
} from "../../lib/city/roof-trees";
import { treesOffStructures } from "../../lib/city/small-buildings";
import {
  cityMeshSourceFiles,
  type TileArtifact,
  type TileArtifactKind,
  sideFileSource,
  tileArtifacts,
} from "../../lib/city/tile";
import type { CityJsonDocument } from "../../lib/city/types";
import type { LandmarkFile } from "../../lib/city/landmarks";
import { BAKE_ENTRIES } from "../bake-entries";
import { type ColonyCrop, cropColonyRaster } from "../crop-raster";
import { downsampleClassRaster } from "../downsample-raster";
import {
  HINT,
  MODE,
  OWN,
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  fail,
  gz,
  log,
  parse,
  publish,
  readJson,
  since,
  utf8,
} from "./context";
import { publishLevels, publishPlatforms } from "./lines";

// --- 1. side files --------------------------------------------------------------

/** A tile's landmarks (pipeline/bake/landmarks.py), or none. */
export function landmarkFile(tile: string): LandmarkFile | undefined {
  const path = at(cityMeshSourceFiles(SITE, tile).landmarks);
  return existsSync(path) ? readJson<LandmarkFile>(path) : undefined;
}

/** Artifact kind → published name (absent optional files: missing), plus
 *  the phones' colony raster publishColonies derives beside
 *  `cultivatedRaster`. */
export type Published = Partial<
  Record<TileArtifactKind | "cultivatedLow", string>
>;

/** tile → artifact kind → published name */
export const sideFiles = new Map<string, Published>();
/** tile → where its published colony raster lies in the tile */
export const colonyCrops = new Map<string, ColonyCrop>();

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
  const key = cacheKey([src], BAKE_ENTRIES.colonies);
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

/** Each tile's roofs, LoD2's and those of the buildings and roofs on posts
 *  it lacks (structures.py), read once for its canopy and scan crowns. */
const tileRoofs = new Map<string, RoofFootprint[]>();
function roofsOf(tile: string): RoofFootprint[] {
  let roofs = tileRoofs.get(tile);
  if (!roofs) {
    const city = at(cityMeshSourceFiles(SITE, tile).city);
    const gaps = at(cityMeshSourceFiles(SITE, tile).structures);
    roofs = [
      ...(existsSync(city) ? lod2Roofs(readJson<CityJsonDocument>(city)) : []),
      ...(existsSync(gaps)
        ? gapRoofs(
            readJson<FeatureCollection<StructureFeature>>(gaps).features ?? []
          )
        : []),
    ];
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
  const key = cacheKey(
    [src, sheds, city, at(cityMeshSourceFiles(SITE, tile).structures)],
    BAKE_ENTRIES.canopy
  );
  const bytes = await cached(packed, key, () => {
    const doc = readJson<FeatureCollection<CanopyFeature> & { rows?: unknown }>(
      src
    );
    const trees = doc.features ?? [];
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
      log(`${file}: ${offSheds - features.length} points on a roof dropped`);
    }
    const points = features.map(pointOf);
    const stride = canopyStride(points, file.startsWith("canopyx_"));
    // the canopy bake's tree rows (canopy.py `rows`): the viewer plants none
    const flags = doc.rows === undefined ? 0 : ROWS_MEASURED;
    return gz(packPoints(points, [minX, minY], stride, flags));
  });
  return publish(packed, bytes);
}

/** Publishes every side file of the tiles this run bakes, into `sideFiles`.
 *  A ground warmer needs none; a tile warmer its own tiles'. */
export async function publishSideFiles(): Promise<void> {
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
      if (
        kind === "platform" &&
        existsSync(at(sideFileSource(SITE, artifact.file)))
      ) {
        names[kind] = publishPlatforms(artifact.file);
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
        const key = cacheKey([src], BAKE_ENTRIES.classRaster);
        const bytes = await cached(artifact.file, key, () =>
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
}
