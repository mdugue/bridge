/**
 * The side files step 1 of scripts/prepare-data.ts bakes (side-files.ts
 * publishes the rest as they are): the colony crops, the downsampled
 * class rasters and the sky view's blocks. Their entries name this module
 * (bake-entries.ts `colonies`, `classRaster`, `svfBlocks`), which imports
 * no other step: a change to the lines re-bakes none of them.
 */
import { readFileSync } from "node:fs";
import type { BlockFormat } from "../../lib/city/block-raster";
import { sideFileSource, tileArtifacts } from "../../lib/city/tile";
import { decodeGreyPng } from "../../lib/city/png-raster";
import { BAKE_ENTRIES } from "../bake-entries";
import { publishedBlockFile } from "../block-encode";
import type { Grey } from "../block-encode";
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

/**
 * The sky view's GPU blocks (plan 091 phase 2's trial): the committed PNG
 * encoded as BC4 and as EAC R11 with its mip chain
 * (scripts/block-encode.ts), pre-gzipped like the glTF (static hosts do
 * not compress binary types), published beside the PNG. The viewer reads
 * them only behind `?svf=blocks`.
 */
export async function publishSvfBlocks(
  tile: string
): Promise<{ svfBc4: string; svfEac: string }> {
  const artifacts = tileArtifacts(tile);
  const src = at(sideFileSource(SITE, artifacts.svf.file));
  const key = cacheKey([src], BAKE_ENTRIES.svfBlocks);
  let decoding: Promise<Grey> | null = null;
  const grey = async () => {
    decoding ??= decodeGreyPng(readFileSync(src));
    return await decoding;
  };
  const encoded = async (format: BlockFormat, file: string) =>
    publish(
      file,
      await cached(file, key, async () =>
        publishedBlockFile(await grey(), format)
      )
    );
  return {
    svfBc4: await encoded("bc4", artifacts.svfBc4.file),
    svfEac: await encoded("eac", artifacts.svfEac.file),
  };
}
