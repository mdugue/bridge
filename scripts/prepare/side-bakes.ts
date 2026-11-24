/**
 * The side files step 1 of scripts/prepare-data.ts bakes (side-files.ts
 * publishes the rest as they are): the colony crops and the downsampled
 * class rasters. Their entries name this module (bake-entries.ts
 * `colonies`, `classRaster`), which imports no other step: a change to
 * the lines re-bakes none of them.
 */
import { sideFileSource, tileArtifacts } from "../../lib/city/tile";
import { BAKE_ENTRIES } from "../bake-entries";
import { cropColonyRaster } from "../crop-raster";
import type { ColonyCrop } from "../crop-raster";
import {
  downsampleClassRaster,
  downsampleInterleaved,
} from "../downsample-raster";
import {
  SITE,
  at,
  cacheKey,
  cached,
  log,
  parse,
  publish,
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
  const lowFile = tileArtifacts(tile).cultivatedLow.file;
  const cropFile = file.replace(/\.png$/u, ".crop.json");
  let cropping: ReturnType<typeof cropColonyRaster> | null = null;
  const cut = async () => {
    cropping ??= cropColonyRaster(src);
    return await cropping;
  };
  const crop = parse(
    await cached(cropFile, key, async () => {
      const cropped = await cut();
      return utf8(cropped?.crop ?? null);
    })
  ) as ColonyCrop | null;
  if (!crop) {
    log(`no colony on ${tile}, skipping ${file}`);
    return null;
  }
  const full = await cached(file, key, async () => {
    const cropped = await cut();
    return cropped?.full ?? new Uint8Array();
  });
  const low = await cached(lowFile, key, async () => {
    const cropped = await cut();
    return cropped?.low ?? new Uint8Array();
  });
  // the full raster first: the manifest lists the files in publish order
  const cultivatedRaster = publish(file, full);
  return { crop, cultivatedLow: publish(lowFile, low), cultivatedRaster };
}

/** A raster downsampled to the size the artifact table names
 *  (lib/city/tile.ts), published: a class raster, or one of `channels`
 *  interleaved bytes a texel. */
export async function publishClassRaster(
  file: string,
  src: string,
  raster: number,
  channels?: 2 | 4
): Promise<string> {
  const key = cacheKey([src], BAKE_ENTRIES.classRaster, channels ?? 1);
  const bytes = await cached(file, key, async () =>
    channels
      ? await downsampleInterleaved(src, raster, channels)
      : await downsampleClassRaster(src, raster)
  );
  return publish(file, bytes);
}
