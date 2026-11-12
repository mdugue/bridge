/**
 * Step 1 of scripts/prepare-data.ts: each tile's side files, published as
 * they are, with the lines' levels (lines.ts), or baked (side-bakes.ts).
 * A value module (bake-entries.ts `KEY_VALUES`): the buildings and the
 * terrain hand its published names on to the tileset (lib/city/tileset.ts
 * `CityFiles`, `TerrainFiles`); no key carries them and none walks it.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseBakeFile } from "../../lib/city/bake-file";
import { FACADES_FILE } from "../../lib/city/facades-file";
import { sideFileSource, tileArtifacts } from "../../lib/city/tile";
import type { TileArtifact, TileArtifactKind } from "../../lib/city/tile";
import type { ColonyCrop } from "../crop-raster";
import {
  HINT,
  MODE,
  OWN,
  SITE,
  TILES,
  at,
  fail,
  log,
  publish,
  since,
} from "./context";
import { publishLevels, publishPlatforms } from "./lines";
import {
  publishCanopy,
  publishClassRaster,
  publishColonies,
} from "./side-bakes";

// --- 1. side files --------------------------------------------------------------

/** Artifact kind → published name (absent optional files: missing). */
export type Published = Partial<Record<TileArtifactKind, string>>;

/** tile → artifact kind → published name */
export const sideFiles = new Map<string, Published>();
/** tile → where its published colony raster lies in the tile */
export const colonyCrops = new Map<string, ColonyCrop>();

/** A side file's bytes as published; the viewer reads the facades' file, so
 *  the build answers for it (ADR 0059). */
function checkedBytes(
  kind: TileArtifactKind,
  source: string,
  src: string
): Buffer {
  const bytes = readFileSync(src);
  if (kind === "facades") {
    parseBakeFile(FACADES_FILE, JSON.parse(bytes.toString()), source);
  }
  return bytes;
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
      // A `built` row has no committed source and this loop does not
      // publish it: the coarse crowns are baked from the tree files on the
      // fine ground (`publishCrowns`), the phones' colony raster is cropped
      // with the colony raster (`publishColonies`).
      if (artifact.built) {
        continue;
      }
      if (
        kind === "cultivatedRaster" &&
        existsSync(at(sideFileSource(SITE, artifact.file)))
      ) {
        const colonies = await publishColonies(tile, artifact.file);
        if (colonies) {
          colonyCrops.set(tile, colonies.crop);
          names.cultivatedRaster = colonies.cultivatedRaster;
          names.cultivatedLow = colonies.cultivatedLow;
        }
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
        names[kind] = await publishPlatforms(artifact.file);
        continue;
      }
      if (artifact.bakedFrom) {
        const source = sideFileSource(SITE, artifact.bakedFrom.file);
        const src = at(source);
        if (!existsSync(src)) {
          fail(`missing source file ${source}${HINT}`);
        }
        names[kind] = await publishClassRaster(
          artifact.file,
          src,
          artifact.bakedFrom.raster
        );
        continue;
      }
      const source = sideFileSource(SITE, artifact.file);
      const src = at(source);
      if (existsSync(src)) {
        names[kind] = publish(artifact.file, checkedBytes(kind, source, src));
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
