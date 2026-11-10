/**
 * Prepares one site for the browser (`bun scripts/prepare-data.ts <site>`;
 * scripts/prepare-sites.ts runs it for every ready site): bakes its tiles into an OGC 3D Tiles
 * tileset (lib/city/tileset.ts) and publishes everything under
 * content-hashed names. Four steps:
 *
 *  1. **Side files** — each tile's rasters and feature collections
 *     (lib/city/tile.ts, `tileArtifacts`): the site's files under data/<site>/dlm/
 *     as they are, plus the 2048² class raster downsampled from the 4096²
 *     one (downsample-raster.ts).
 *  2. **Content** — per tile, the buildings (CityJSON → glTF with a
 *     per-object table, bake-city-mesh.ts) and the terrain at two levels
 *     (DGM → glTF, bake-tiles.ts: the fine level an error-bounded TIN over
 *     the native DGM, bake-terrain-tin.ts), each glTF naming its side files in
 *     `extras`. Pre-gzipped (`.glb.gz`): static hosts do not compress binary
 *     types, and the viewer inflates natively (DecompressionStream).
 *  3. **Tilesets** — the tree over all tiles, and one over the spawn tile
 *     alone (the `lite` profile).
 *  4. **Publish** — `manifest.json` maps logical → hashed names; it is the
 *     one file served `no-cache` (next.config.ts), everything else is
 *     immutable. Files the manifest no longer references are pruned.
 *
 * This file is the order of the steps; each step's bakes live in a module
 * of scripts/prepare/, which their bake entries name (bake-entries.ts).
 * Baked outputs are cached in `.cache/prepare-data/` (gitignored; on Vercel
 * `.next/cache/prepare-data/`, which its build cache keeps, and behind it
 * the cache every branch shares, shared-cache.ts) under a key of their
 * inputs' contents, every module the artifact's own bake imports
 * (bake-sources.ts, walked from that bake's entry), the plumbing
 * (prepare/context.ts), the site's own config, the names they reference and
 * the locked versions of the packages those modules import, so a rerun is
 * cheap, a changed bake never serves a stale cache, and an edit to another
 * site, to this file or to what only the viewer reads (or a bump of a
 * package only it imports) re-bakes nothing. So nothing here may shape a
 * cached artifact: what a bake reads, it reads in its own module or takes
 * as a value its key carries.
 * Writes public/data/<site>/ (gitignored), the folder the route /<site>
 * streams from.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { hitOf, knowledgeOf } from "../lib/city/ask-knowledge";
import type { Knowledge } from "../lib/city/ask-knowledge";
import { PLATE_N } from "../lib/city/ground-plate";
import type { PlateExtras } from "../lib/city/ground-plate";
import { siteLandmarks } from "../lib/city/landmarks";
import type { LandmarkFile } from "../lib/city/landmarks";
import {
  MURALS_FILE,
  muralCredit,
  muralFileSource,
  muralsSource,
  parseMurals,
} from "../lib/city/murals";
import type { MuralExtras } from "../lib/city/murals";
import { PROVENANCE_FILE, siteProvenance } from "../lib/city/provenance";
import type { ProvenanceRecord } from "../lib/city/provenance";
import { tileExtentOf } from "../lib/city/site";
import {
  WALKS_DIR,
  WALKS_FILE,
  stopPlaces,
  walkBundle,
  walkPhotoFile,
} from "../lib/city/walks";
import type { Walk, WalkBundle, WalksExtras } from "../lib/city/walks";
import { groundRelief } from "../lib/city/valley-fog";
import type { ValleyRim } from "../lib/city/valley-fog";
import {
  ASK_KINDS,
  pickFiles,
  sideFileSource,
  siteDataDir,
} from "../lib/city/tile";
import {
  buildTileset,
  TILESET_FILE,
  TILESET_SPAWN_FILE,
} from "../lib/city/tileset";
import type { BakedTile, TilesetExtras } from "../lib/city/tileset";
import {
  LANDMARK_FACTS_FILE,
  landmarkFactsSource,
} from "../lib/city/landmark-facts";
import type { LandmarkFactsExtras } from "../lib/city/landmark-facts";
import { LANDMARK_FACTS_FILE_SPEC } from "../lib/city/landmark-facts-file";
import { MURALS_FILE_SPEC } from "../lib/city/murals-file";
import { TRAMS_FILE } from "../lib/city/tram-timetable-file";
import { HORIZON_LEGEND_FILE } from "../lib/city/horizon-legend-file";
import { parseBakeFile } from "../lib/city/bake-file";
import type { BakeFile } from "../lib/city/bake-file";
import {
  TRAM_TIMETABLE_FILE,
  tramTimetableSource,
} from "../lib/city/tram-timetable";
import {
  MODE,
  OWN,
  SITE,
  TILES,
  WARMING,
  at,
  log,
  parse,
  publish,
  publisher,
  readJson,
  settleShared,
  since,
  started,
  utf8,
} from "./prepare/context";
import { landmarkFile } from "./prepare/landmarks";
import { publishSideFiles, sideFiles } from "./prepare/side-files";
import { frame, offset } from "./prepare/frame";
import { groundFile } from "./prepare/ground";
import { bakeCity } from "./prepare/city";
import { bakeTerrain, dropTerrain } from "./prepare/terrain";
import { bakePlate } from "./prepare/plate";
import { publishHero } from "./prepare/hero";
import { publishStats } from "./prepare/stats";
import { publishStadtwissen } from "./prepare/stadtwissen";

/** The valley's rim around each tile, where the sky-view bake read the
 *  land beyond the site (pipeline/bake/glo30.py `rims`, in the horizon
 *  legend): the valley haze's depth (lib/city/valley-fog.ts). */
function valleyRims(): ValleyRim[] {
  return TILES.flatMap((tile) => {
    const legend = at(sideFileSource(SITE, `horizon_${tile}.json`));
    if (!existsSync(legend)) {
      return [];
    }
    const { valley } = parseBakeFile(
      HORIZON_LEGEND_FILE,
      readJson(legend),
      legend
    );
    return valley ? [{ floorM: valley.floorM, rimM: valley.rimM }] : [];
  });
}

/** A warmer's last line: what it cached, how long it took, its peak. */
async function warmed(what: string): Promise<never> {
  await settleShared();
  log(
    `warmed ${what} in ${since(started)} ms, peak RSS ${(process.resourceUsage().maxRSS / 1024 ** 2).toFixed(2)} GiB (published nothing)`
  );
  process.exit(0);
}

await publishSideFiles();

if (MODE.kind === "ground") {
  for (const tile of MODE.tiles) {
    await groundFile(tile);
    Bun.gc(true);
  }
  await warmed(`the fine ground of ${MODE.tiles.join(", ")}`);
}

const baked: BakedTile[] = [];
const footprintFiles = new Map<string, string>();
const groundHeights: number[] = [];
for (let i = 0; i < TILES.length; i += 1) {
  const tile = TILES[i];
  if (!OWN.has(tile)) {
    continue;
  }
  let t0 = performance.now();
  const city = await bakeCity(tile);
  const cityMs = since(t0);
  footprintFiles.set(tile, city.footprints);
  t0 = performance.now();
  const fine = await bakeTerrain(tile, 0);
  const fineMs = since(t0);
  t0 = performance.now();
  const coarse = await bakeTerrain(tile, 1);
  log(`${tile}: city ${cityMs} ms, fine ${fineMs} ms, coarse ${since(t0)} ms`);
  groundHeights.push(...(coarse.ground ?? []));
  const minZ = Math.min(fine.minZ, coarse.minZ);
  const maxZ = Math.max(fine.maxZ, coarse.maxZ, city.maxZ);
  baked.push({
    id: tile,
    bounds: tileExtentOf(SITE.tiles[i]),
    city: city.file,
    cityFar: city.far,
    terrain: { 0: fine.file, 1: coarse.file },
    zRange: [
      Number.isFinite(minZ) ? minZ : 0,
      Number.isFinite(maxZ) ? maxZ : 1,
    ],
  });
  // A tile's meshes are hundreds of MB of typed arrays that Bun's lazy
  // collector let pile up over the loop: a cold Dresden reached ~7 GB,
  // more than a 4-core, 8 GB build machine running two sites side by side
  // holds. Dropped and collected after each tile, the loop stays near one
  // tile's peak.
  dropTerrain(tile);
  Bun.gc(true);
}
if (WARMING) {
  await warmed(`${baked.map((t) => t.id).join(", ")} (buildings + terrain)`);
}
log(`baked ${TILES.length} tiles (buildings + terrain at two levels)`);

const plateFile = await bakePlate(baked);
log(`ground plate: ${plateFile}`);

// --- 3. tilesets ------------------------------------------------------------------

// Who publishes each source, and each tile's edition of it: the inquiry
// card's "Quelle" lines (ADR 0042), from the hand-kept record.
/** The site's provenance record; a site without one (freshly fetched)
 *  builds with an empty record — the cards then name sources without
 *  editions. A record that is there but unreadable still fails. */
function readProvenance(): ProvenanceRecord {
  const path = at(`${siteDataDir(SITE)}/provenance.json`);
  if (!existsSync(path)) {
    log(
      `${SITE.id}: no provenance.json — the cards name sources without editions`
    );
    return {};
  }
  return readJson(path) as ProvenanceRecord;
}
const provenance = siteProvenance(
  readProvenance(),
  baked.map((t) => t.id),
  SITE
);
const provenanceFile = publish(PROVENANCE_FILE, utf8(provenance));
/** A site-wide file a bake hands over, checked against its schema every
 *  run (ADR 0059: a mismatch ends the build) and published as the bytes
 *  it read. */
function publishParsed(name: string, path: string, spec: BakeFile): string {
  const bytes = readFileSync(path);
  parseBakeFile(spec, parse(bytes), path);
  return publish(name, bytes);
}
// The trams' timetable, site-wide (pipeline/bake/transit.py): optional.
const tramSource = at(tramTimetableSource(siteDataDir(SITE)));
// The landmarks' facts, site-wide (pipeline/bake/landmark_facts.py): what
// the nameplate says under a landmark's name; optional.
const factsSource = at(landmarkFactsSource(siteDataDir(SITE)));
const landmarkFacts = existsSync(factsSource)
  ? publishParsed(LANDMARK_FACTS_FILE, factsSource, LANDMARK_FACTS_FILE_SPEC)
  : undefined;
const trams = existsSync(tramSource)
  ? publishParsed(TRAM_TIMETABLE_FILE, tramSource, TRAMS_FILE)
  : undefined;
// The murals on their walls, site-wide (pipeline/bake/murals.py): optional,
// each drawing's pen lines and wash under their own published names, the
// file naming them so.
const muralsDir = siteDataDir(SITE);
const muralsPath = at(muralsSource(muralsDir));
// a malformed mural fails the build (ADR 0059), never vanishes
const muralFile = existsSync(muralsPath)
  ? parseBakeFile(MURALS_FILE_SPEC, readJson(muralsPath), muralsPath)
  : null;
const muralPath = (name: string) => at(muralFileSource(muralsDir, name));
const murals = (parseMurals(muralFile) ?? [])
  .filter(
    (m) => existsSync(muralPath(m.lines)) && existsSync(muralPath(m.wash))
  )
  .map((m) => ({
    ...m,
    lines: publish(
      `mural-${m.id}.lines.webp`,
      readFileSync(muralPath(m.lines))
    ),
    wash: publish(`mural-${m.id}.wash.webp`, readFileSync(muralPath(m.wash))),
  }));
const muralsFile =
  murals.length > 0
    ? publish(
        MURALS_FILE,
        utf8({ attribution: muralFile?.attribution ?? "", murals })
      )
    : undefined;

// --- the walks --------------------------------------------------------------------
// Erzählte Spaziergänge (lib/city/walks.ts, ADR 0055): the site's written
// walks, checked and bundled into one file the HUD loads when it lists them.

const walksDir = at(`${siteDataDir(SITE)}/${WALKS_DIR}`);
const walkFiles = existsSync(walksDir)
  ? readdirSync(walksDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
  : [];
/** A walk with each stop's refs as places (`places`): the ones the
 *  baked Stadtwissen knows by name. */
function withPlaces(walk: Walk, knowledge: Knowledge): Walk {
  return {
    ...walk,
    stops: walk.stops.map((stop) => {
      const places = stopPlaces(stop, (id) => hitOf(knowledge, id));
      return places.length > 0 ? { ...stop, places } : stop;
    }),
  };
}

/** A walk with each stop's photo published beside it (`photo.src`). The
 *  walks are checked as written (walkBundle), credits included; a stop
 *  whose copy is missing then shows none, so a preview still builds — the
 *  walks' unit test fails until it is committed. */
function withPhotos(walk: Walk): Walk {
  return {
    ...walk,
    stops: walk.stops.map((stop) => {
      if (!stop.photo) {
        return stop;
      }
      const file = nodePath.join(walksDir, walkPhotoFile(walk.id, stop.id));
      if (!existsSync(file)) {
        log(
          `${walk.id}/${stop.id}: no photo copy, shown without (bun scripts/walks.ts ${SITE.id} photos)`
        );
        const { photo: _missing, ...rest } = stop;
        return rest;
      }
      const src = publish(
        `walk-photo_${walk.id}--${stop.id}.webp`,
        readFileSync(file)
      );
      return { ...stop, photo: { ...stop.photo, src } };
    }),
  };
}
/** The checked bundle with its photos published and its refs as places
 *  (checked before: a sentence about the photo stays right when only the
 *  copy is missing). */
function publishedWalks(bundle: WalkBundle, knowledge: Knowledge): WalkBundle {
  return {
    ...bundle,
    walks: bundle.walks.map((w) => withPlaces(withPhotos(w), knowledge)),
  };
}

// The Stadtwissen before the walks: a stop's refs become places the card
// can pick by name (lib/city/walks.ts `stopPlaces`).
const wissen = await publishStadtwissen(
  baked.map((t) => t.id),
  frame.epsg,
  provenance.sources
);
// (read only where there are walks: Berlin has none)
const knowledge =
  walkFiles.length > 0 ? knowledgeOf(wissen.index, wissen.tiles) : null;
const walks = knowledge
  ? publish(
      WALKS_FILE,
      utf8(
        publishedWalks(
          walkBundle(
            SITE.id,
            walkFiles.map(
              (name) => readJson(nodePath.join(walksDir, name)) as Walk
            )
          ),
          knowledge
        )
      )
    )
  : undefined;

type SiteExtras = TilesetExtras &
  PlateExtras &
  LandmarkFactsExtras &
  MuralExtras &
  WalksExtras;

const extras: SiteExtras = {
  site: SITE.id,
  landmarks: siteLandmarks(
    TILES.map(landmarkFile).filter((f): f is LandmarkFile => f !== undefined)
  ),
  epsg: frame.epsg,
  ...(groundHeights.length > 0
    ? { ground: groundRelief(groundHeights, valleyRims()) }
    : {}),
  offset,
  provenance: provenanceFile,
  plate: {
    file: plateFile,
    n: PLATE_N,
    tiles: baked.map((t) => ({ id: t.id, bounds: t.bounds })),
  },
  tiles: baked.map((t) => ({
    id: t.id,
    bounds: t.bounds,
    footprints: footprintFiles.get(t.id) ?? "",
    minimap: sideFiles.get(t.id)?.landcoverSmall ?? "",
    bridges: sideFiles.get(t.id)?.bridge,
    ask: pickFiles(sideFiles.get(t.id) ?? {}, ASK_KINDS),
  })),
  ...(trams ? { trams } : {}),
  ...(walks ? { walks } : {}),
  ...(landmarkFacts ? { landmarkFacts } : {}),
  ...(muralsFile
    ? { murals: { credits: murals.map(muralCredit), file: muralsFile } }
    : {}),
};
publish(TILESET_FILE, utf8(buildTileset(baked, extras)));
publish(
  TILESET_SPAWN_FILE,
  utf8(
    buildTileset(baked.slice(0, 1), {
      ...extras,
      tiles: extras.tiles.slice(0, 1),
    })
  )
);

await publishHero();
await publishStats(footprintFiles, extras.ground);

// --- 4. manifest + prune -------------------------------------------------------------

const { artifacts, written, pruned } = publisher.finish();
log(
  `${artifacts} artifacts in public/data/${SITE.id} (${written} new, ${pruned} pruned)`
);
await settleShared();
// resourceUsage's maxRSS is in KiB
log(
  `done in ${since(started)} ms, peak RSS ${(process.resourceUsage().maxRSS / 1024 ** 2).toFixed(2)} GiB`
);
// a request the shared cache gave up on may still hold a socket open
process.exit(0);
