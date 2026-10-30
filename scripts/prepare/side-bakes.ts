/**
 * The side files step 1 of scripts/prepare-data.ts bakes (side-files.ts
 * publishes the rest as they are): the colony crops, the packed canopy and
 * the downsampled class rasters. Their entries name this module
 * (bake-entries.ts `colonies`, `canopy`, `classRaster`), which imports no
 * other step: a change to the lines re-bakes none of them.
 */
import { existsSync } from "node:fs";
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
import { cityMeshSourceFiles, sideFileSource } from "../../lib/city/tile";
import type { CityJsonDocument } from "../../lib/city/types";
import { BAKE_ENTRIES } from "../bake-entries";
import { type ColonyCrop, cropColonyRaster } from "../crop-raster";
import { downsampleClassRaster } from "../downsample-raster";
import {
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  gz,
  log,
  parse,
  publish,
  readJson,
  utf8,
} from "./context";

/**
 * The colony raster cropped to its colonies, and the half-resolution twin
 * phones read (`cultivatedLow`), with their published names; a tile
 * without a colony publishes neither.
 */
export async function publishColonies(
  tile: string,
  file: string
): Promise<{
  crop: ColonyCrop;
  cultivatedRaster: string;
  cultivatedLow: string;
} | null> {
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
    return null;
  }
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
  return {
    crop,
    cultivatedLow: publish(lowFile, low),
    cultivatedRaster: publish(file, full),
  };
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
export async function publishCanopy(
  tile: string,
  file: string
): Promise<string> {
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

/** A class raster downsampled to the size the artifact table names
 *  (lib/city/tile.ts), published. */
export async function publishClassRaster(
  file: string,
  src: string,
  raster: number
): Promise<string> {
  const key = cacheKey([src], BAKE_ENTRIES.classRaster);
  const bytes = await cached(file, key, () =>
    downsampleClassRaster(src, raster)
  );
  return publish(file, bytes);
}
