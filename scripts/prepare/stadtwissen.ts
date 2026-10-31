/**
 * What the twin knows, readable without the scene (scripts/bake-stadtwissen.ts,
 * lib/city/stadtwissen.ts, ADR 0055): each tile's directory of named,
 * addressed and listed buildings, cached, and the site's index — its
 * landmarks with the committed Wikidata excerpt, the sources — built
 * uncached every run. For the walks' author and an agent's tools; the
 * viewer never loads it. Its bake's entries name this module
 * (bake-entries.ts `stadtwissen`).
 */
import { existsSync } from "node:fs";
import type { SourceInfo, SourceKey } from "../../lib/city/provenance";
import {
  STADTWISSEN_FILE,
  type StadtwissenIndex,
  WIKIDATA_FACTS_FILE,
  type WikidataFile,
  type WissenTile,
} from "../../lib/city/stadtwissen";
import {
  cityMeshSourceFiles,
  sideFileSource,
  siteDataDir,
  tileArtifacts,
} from "../../lib/city/tile";
import { BAKE_ENTRIES } from "../bake-entries";
import { stadtwissenIndex, stadtwissenTile } from "../bake-stadtwissen";
import {
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  publish,
  readJson,
  utf8,
} from "./context";
import { landmarkFile } from "./landmarks";

/** One tile's directory, cached on the buildings, their OSM facts, the
 *  landmarks and the monuments it is read from: its published name and
 *  its content. */
async function tileFile(
  tile: string
): Promise<{ file: string; directory: WissenTile }> {
  const src = cityMeshSourceFiles(SITE, tile);
  const monuments = at(
    sideFileSource(SITE, tileArtifacts(tile).monuments.file)
  );
  const inputs = [at(src.city), at(src.osmBuild), at(src.landmarks), monuments];
  const name = `stadtwissen_${tile}.json`;
  const bytes = await cached(
    name,
    cacheKey(inputs, BAKE_ENTRIES.stadtwissen),
    () =>
      utf8(
        stadtwissenTile({
          tile,
          city: readJson(at(src.city)),
          osm: existsSync(at(src.osmBuild))
            ? readJson<{ objects: Record<string, never> }>(at(src.osmBuild))
                .objects
            : {},
          landmarks: landmarkFile(tile),
          monuments: existsSync(monuments) ? readJson(monuments) : undefined,
        })
      )
  );
  return {
    file: publish(name, bytes),
    directory: JSON.parse(Buffer.from(bytes).toString("utf8")) as WissenTile,
  };
}

/** Publishes the baked tiles' directories and the site's index, and
 *  hands both back (the walks' places are read from them). */
export async function publishStadtwissen(
  tiles: readonly string[],
  epsg: number,
  sources: Readonly<Record<SourceKey, SourceInfo>>
): Promise<{ index: StadtwissenIndex; tiles: WissenTile[] }> {
  const wissenTiles: StadtwissenIndex["tiles"] = [];
  const directories: WissenTile[] = [];
  for (const tile of tiles) {
    const { file, directory } = await tileFile(tile);
    wissenTiles.push({ id: tile, file });
    directories.push(directory);
  }
  const wikidata = at(`${siteDataDir(SITE)}/${WIKIDATA_FACTS_FILE}`);
  const index = stadtwissenIndex({
    site: SITE.id,
    epsg,
    tiles: wissenTiles,
    sources: {
      lod2: sources.lod2,
      osm: sources.osm,
      wikidata: sources.wikidata,
    },
    landmarks: TILES.flatMap((tile) => {
      const file = landmarkFile(tile);
      return file ? [{ tile, file }] : [];
    }),
    wikidata: existsSync(wikidata)
      ? readJson<WikidataFile>(wikidata)
      : undefined,
  });
  publish(STADTWISSEN_FILE, utf8(index));
  return { index, tiles: directories };
}
