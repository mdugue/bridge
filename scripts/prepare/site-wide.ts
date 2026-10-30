/**
 * The site-wide side products of scripts/prepare-data.ts: the map picture
 * and the city in numbers. Their bakes' entries name this module
 * (bake-entries.ts `hero`, `siteStats`).
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildingHeights,
  footprintArea,
  landcoverShares,
  quantile,
  SITE_STATS_FILE,
  type SiteStats,
} from "../../lib/city/site-stats";
import {
  cityMeshSourceFiles,
  sideFileSource,
  tileArtifacts,
} from "../../lib/city/tile";
import { SITE_MAP_FILE } from "../../lib/city/site-index";
import type { CityJsonDocument } from "../../lib/city/types";
import { BAKE_ENTRIES } from "../bake-entries";
import { bakeWissenHero } from "../bake-wissen-hero";
import {
  OUT_DIR,
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  log,
  publish,
  publisher,
  readJson,
  siteWide,
  utf8,
} from "./context";
import { landmarkFile } from "./side-files";

// --- the map picture ------------------------------------------------------------
// The site's land cover in the viewer's palette as one map
// (scripts/bake-wissen-hero.ts): the start page's card for the site and the
// knowledge base's hero, both sized by next/image. Not a viewer artifact:
// optional.

export async function publishHero(): Promise<void> {
  const rasters = TILES.map((tile) =>
    at(sideFileSource(SITE, tileArtifacts(tile).landcover.file))
  );
  if (!rasters.every((path) => existsSync(path))) {
    log("land-cover raster missing, skipping the map picture");
    return;
  }
  // bake-wissen-hero.ts imports the palette (lib/city/landcover.ts)
  const hero = await cached(
    siteWide(SITE_MAP_FILE),
    cacheKey(rasters, BAKE_ENTRIES.hero),
    () => bakeWissenHero(SITE.tiles, rasters, 1600)
  );
  publish(SITE_MAP_FILE, hero);
}

// --- the city in numbers ------------------------------------------------------------
// The start page's orderings (lib/city/site-stats.ts): shares of the land
// cover, crowns per km², the buildings' heights and footprint share, the
// relief, the landmarks. Not hashed: prepare-sites folds it into the index.

/** The stats, from the tiles' footprints as published (tile → name) and
 *  the site's relief (the tileset's `ground`, [low, high]). */
export async function publishStats(
  footprintFiles: ReadonlyMap<string, string>,
  ground: readonly number[] | undefined
): Promise<void> {
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
      BAKE_ENTRIES.siteStats,
      ground ?? null,
      // the footprints' published names hash their content
      [...footprintFiles.values()]
    ),
    async () => utf8(await siteStats(footprintFiles, ground))
  );
  publisher.publishPlain(SITE_STATS_FILE, stats);
}

async function siteStats(
  footprintFiles: ReadonlyMap<string, string>,
  ground: readonly number[] | undefined
): Promise<SiteStats> {
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
  const relief = ground ? ground[1] - ground[0] : 0;
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
