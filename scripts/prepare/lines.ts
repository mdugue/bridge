/**
 * The site's rail and tram lines for scripts/prepare-data.ts: their levels
 * solved over whole lines (scripts/line-levels.ts), the passages and beds
 * they shape the ground with, and each tile's rail, tram and platform
 * files published with them. Every ground and building bake that reads
 * the beds or passages imports this module, so it is in their keys.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  AreaFeature,
  FeatureCollection,
  RailFeature,
  TramFeature,
} from "../../lib/city/features";
import { AxisIndex, clearOfTracks } from "../../lib/city/platform-clearance";
import type { Passage } from "../../lib/city/passages";
import { BED_SIDE_M, type Bed } from "../../lib/city/track-beds";
import type { DeckPoly } from "../../lib/city/decks";
import type { LevelLine } from "../../lib/city/levels";
import { tileExtentOf } from "../../lib/city/site";
import { sideFileSource } from "../../lib/city/tile";
import { BAKE_ENTRIES } from "../bake-entries";
import {
  levelInputs,
  type SiteLevels,
  siteBeds,
  siteLineLevels,
  sitePassages,
  railFeatures,
  siteTrackAxes,
  siteDecks,
  underDecks,
} from "../line-levels";
import {
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  log,
  parse,
  publish,
  readJson,
  since,
  utf8,
} from "./context";

/** The levels of the site's rail and tram lines, solved over whole lines on
 *  every tile's DGM (scripts/line-levels.ts): each tile's file publishes
 *  with them. */
const levelsStarted = performance.now();
const lineLevels = parse<SiteLevels>(
  await cached(
    `line-levels-${SITE.id}.json`,
    cacheKey(levelInputs(SITE), BAKE_ENTRIES.lineLevels),
    async () => utf8(await siteLineLevels(SITE))
  )
);
log(`line levels: ${since(levelsStarted)} ms`);

/** The passages the lines open through the fill under the decks
 *  (lib/city/passages.ts): the terrain bake opens each in the tiles it
 *  touches. */
const passages = sitePassages(SITE, lineLevels);

/** The beds the lines lie on (lib/city/track-beds.ts): the terrain bake
 *  lays the ground under each at its profile, off the decks. */
const beds = siteBeds(SITE, lineLevels);
/** The site's decks: no bed is burned under one (`underDeck`), so each
 *  tile's ground keys on those that reach into it (`shapedBy`): a deck
 *  moved keeps the levels, but not the ground under it. */
const decks = siteDecks(SITE);
export const underDeck = underDecks(decks);
/** How far beyond a tile's extent a deck still shapes its ground: a bed
 *  reaches `half + BED_SIDE_M` out (`bedsIn`), and the burn stays on the
 *  tile's grid; a margin past both. */
const DECK_REACH_M = 50;

/** The decks that reach into a tile's extent (the decks are in the
 *  levels' zero frame: x = E, z = −N). */
function decksIn(tile: string): DeckPoly[] {
  const [x0, y0, x1, y1] = extentOf(tile);
  const r = DECK_REACH_M;
  return decks.filter(
    (d) =>
      d.maxX >= x0 - r &&
      d.minX <= x1 + r &&
      -d.minZ >= y0 - r &&
      -d.maxZ <= y1 + r
  );
}

/** A tile's extent (EPSG). */
function extentOf(tile: string): [number, number, number, number] {
  return tileExtentOf(SITE.tiles[TILES.indexOf(tile)]);
}

/** The beds that reach into a tile's extent (with their slopes), once
 *  per tile. */
const tileBeds = new Map<string, Bed[]>();
export function bedsIn(tile: string): Bed[] {
  let found = tileBeds.get(tile);
  if (!found) {
    const [x0, y0, x1, y1] = extentOf(tile);
    found = beds.filter((b) => {
      const r = b.half + BED_SIDE_M;
      return b.coords.some(
        ([x, y]) => x >= x0 - r && x <= x1 + r && y >= y0 - r && y <= y1 + r
      );
    });
    tileBeds.set(tile, found);
  }
  return found;
}

/** A digest of what shapes a ground, for its cache keys (hashed once:
 *  the site's beds run to megabytes). */
export function shapeDigest(shapes: unknown): string {
  return createHash("sha256").update(JSON.stringify(shapes)).digest("hex");
}

/** What shapes a tile's ground besides its own files, for its cache keys:
 *  the passages, beds and decks reaching into it. */
const tileShapes = new Map<string, string>();
export function shapedBy(tile: string): string {
  let digest = tileShapes.get(tile);
  if (digest === undefined) {
    digest = shapeDigest([passagesIn(tile), bedsIn(tile), decksIn(tile)]);
    tileShapes.set(tile, digest);
  }
  return digest;
}

/** What shapes every tile's ground: the fine level stands on all of it. */
export const siteShapes = shapeDigest([passages, beds, decks]);

/** The passages that reach into a tile's extent. */
export function passagesIn(tile: string): Passage[] {
  const [x0, y0, x1, y1] = extentOf(tile);
  return passages.filter((p) =>
    p.coords.some(
      ([x, y]) =>
        x >= x0 - p.half &&
        x <= x1 + p.half &&
        y >= y0 - p.half &&
        y <= y1 + p.half
    )
  );
}

/**
 * A tile's rail or tram file with each line's runs off the ground (`lv`,
 * lib/city/levels.ts) and its profile (`lz`, lib/city/line-profile.ts), so
 * the layer draws it on the level its whole run says, within the grade and
 * vertical curve a track keeps, rather than on the ground sample by sample.
 */
export function publishLevels(
  tile: string,
  line: LevelLine,
  file: string
): string {
  const src = at(sideFileSource(SITE, file));
  const solved = lineLevels[tile]?.[line] ?? {};
  if (line === "tram" && Object.keys(solved).length === 0) {
    return publish(file, readFileSync(src));
  }
  const doc = readJson<FeatureCollection<RailFeature | TramFeature>>(src);
  // the rail lines as the levels were solved on (a DLM line's stretches
  // over a platform dropped, line-levels.ts `railFeatures`)
  const lines =
    line === "rail" ? railFeatures(SITE, tile) : (doc.features ?? []);
  const features = lines.map((f, i) =>
    solved[i] ? { ...f, properties: { ...f.properties, ...solved[i] } } : f
  );
  return publish(file, utf8({ ...doc, features }));
}

/** Every drawn track of the site, for the platforms beside them. */
let trackAxes: AxisIndex | undefined;

/**
 * A tile's platform file with every outline cut back to its edge distance
 * from the drawn tracks (lib/city/platform-clearance.ts): OSM's platforms
 * beside the Basis-DLM's tracks stood over a rail where the two lie a
 * metre apart.
 */
export function publishPlatforms(file: string): string {
  const src = at(sideFileSource(SITE, file));
  trackAxes ??= new AxisIndex(siteTrackAxes(SITE, lineLevels));
  const doc = readJson<FeatureCollection<AreaFeature>>(src);
  let cut = 0;
  const features = (doc.features ?? []).flatMap((f): AreaFeature[] => {
    const g = f.geometry;
    if (g?.type !== "Polygon" && g?.type !== "MultiPolygon") {
      return [f];
    }
    const clear = clearOfTracks(g, trackAxes as AxisIndex);
    if (clear === g) {
      return [f];
    }
    cut++;
    return clear ? [{ ...f, geometry: clear }] : [];
  });
  if (cut > 0) {
    log(`${file}: ${cut} platforms cut back from the tracks`);
  }
  return publish(file, utf8({ ...doc, features }));
}
