/**
 * The map picture of scripts/prepare-data.ts: the site's land cover in the
 * viewer's palette. Its bake's entries name this module (bake-entries.ts
 * `hero`).
 */
import { existsSync } from "node:fs";
import { sideFileSource, tileArtifacts } from "../../lib/city/tile";
import { SITE_MAP_FILE } from "../../lib/city/site-index";
import { BAKE_ENTRIES } from "../bake-entries";
import { bakeWissenHero } from "../bake-wissen-hero";
import {
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  log,
  publish,
  siteWide,
} from "./context";

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
