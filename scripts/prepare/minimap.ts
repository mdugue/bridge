/**
 * The minimap's picture of scripts/prepare-data.ts: the site's land cover,
 * bridge decks and buildings as one image (scripts/bake-minimap.ts), named
 * in the tileset's extras (lib/city/minimap.ts `MinimapExtras`). Its
 * bake's entries name this module (bake-entries.ts `minimap`).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readFootprints } from "../../lib/city/footprint-pack";
import type { FootprintPack } from "../../lib/city/footprint-pack";
import { MINIMAP_FILE, mapBridges } from "../../lib/city/minimap";
import type { MinimapExtras } from "../../lib/city/minimap";
import { sideFileSource, tileArtifacts } from "../../lib/city/tile";
import { BAKE_ENTRIES } from "../bake-entries";
import { MINIMAP_PX, bakeMinimap, extentOf } from "../bake-minimap";
import {
  OUT_DIR,
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  fail,
  log,
  publish,
  readJson,
  siteWide,
} from "./context";

/** A tile's buildings, from its footprints as published. */
function packOf(file: string): FootprintPack {
  const pack = readFootprints(
    Bun.gunzipSync(readFileSync(path.join(OUT_DIR, file)))
  );
  return pack ?? fail(`${file}: not a footprint file`);
}

/**
 * The picture as the tileset names it, from the tiles' footprints as
 * published (tile → name); none where a tile has no land cover yet (a
 * freshly fetched site), and the minimap then shows the paper alone.
 */
export async function publishMinimap(
  footprintFiles: ReadonlyMap<string, string>
): Promise<MinimapExtras["map"]> {
  const rasters = TILES.map((tile) =>
    at(sideFileSource(SITE, tileArtifacts(tile).landcover.file))
  );
  if (!rasters.every((file) => existsSync(file))) {
    log("land-cover raster missing, skipping the minimap's picture");
    return undefined;
  }
  const bridges = TILES.map((tile) =>
    at(sideFileSource(SITE, tileArtifacts(tile).bridge.file))
  ).filter((file) => existsSync(file));
  const prints = TILES.flatMap((tile) => footprintFiles.get(tile) ?? []);
  const picture = await cached(
    siteWide(MINIMAP_FILE),
    cacheKey(
      [...rasters, ...bridges],
      BAKE_ENTRIES.minimap,
      // the footprints' published names hash their content
      prints,
      MINIMAP_PX
    ),
    async () =>
      new Uint8Array(
        await bakeMinimap({
          cells: SITE.tiles,
          decks: bridges.flatMap((file) => mapBridges(readJson(file))),
          packs: prints.map(packOf),
          rasters,
        })
      )
  );
  return { bounds: extentOf(SITE.tiles), file: publish(MINIMAP_FILE, picture) };
}
