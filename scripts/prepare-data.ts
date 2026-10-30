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
import { existsSync, readFileSync } from "node:fs";
import { PLATE_N, type PlateExtras } from "../lib/city/ground-plate";
import { type LandmarkFile, siteLandmarks } from "../lib/city/landmarks";
import {
  PROVENANCE_FILE,
  type ProvenanceRecord,
  siteProvenance,
} from "../lib/city/provenance";
import { tileExtentOf } from "../lib/city/site";
import { groundRelief, type ValleyRim } from "../lib/city/valley-fog";
import {
  ASK_KINDS,
  pickFiles,
  sideFileSource,
  siteDataDir,
} from "../lib/city/tile";
import {
  type BakedTile,
  buildTileset,
  TILESET_FILE,
  TILESET_SPAWN_FILE,
  type TilesetExtras,
} from "../lib/city/tileset";
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
  publish,
  publisher,
  readJson,
  sharedStats,
  since,
  started,
  utf8,
} from "./prepare/context";
import {
  landmarkFile,
  publishSideFiles,
  sideFiles,
} from "./prepare/side-files";
import { frame, offset } from "./prepare/frame";
import { groundFile } from "./prepare/ground";
import { bakeCity } from "./prepare/city";
import { bakeTerrain, dropTerrain } from "./prepare/terrain";
import { bakePlate } from "./prepare/plate";
import { publishHero, publishStats } from "./prepare/site-wide";

/** The valley's rim around each tile, where the sky-view bake read the
 *  land beyond the site (pipeline/bake/glo30.py `rims`, in the horizon
 *  legend): the valley haze's depth (lib/city/valley-fog.ts). */
function valleyRims(): ValleyRim[] {
  return TILES.flatMap((tile) => {
    const legend = at(sideFileSource(SITE, `horizon_${tile}.json`));
    if (!existsSync(legend)) {
      return [];
    }
    const valley = readJson<{ valley?: Partial<ValleyRim> }>(legend).valley;
    return typeof valley?.floorM === "number" && Array.isArray(valley.rimM)
      ? [{ floorM: valley.floorM, rimM: valley.rimM }]
      : [];
  });
}

/** A warmer's last line: what it cached, how long it took, its peak. */
function warmed(what: string): never {
  sharedStats();
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
  warmed(`the fine ground of ${MODE.tiles.join(", ")}`);
}

const baked: BakedTile[] = [];
const footprintFiles = new Map<string, string>();
const groundHeights: number[] = [];
for (const [i, tile] of TILES.entries()) {
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
  warmed(`${baked.map((t) => t.id).join(", ")} (buildings + terrain)`);
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
  return readJson<ProvenanceRecord>(path);
}
const provenanceFile = publish(
  PROVENANCE_FILE,
  utf8(
    siteProvenance(
      readProvenance(),
      baked.map((t) => t.id),
      SITE
    )
  )
);
// The trams' timetable, site-wide (pipeline/bake/transit.py): optional.
const tramSource = at(tramTimetableSource(siteDataDir(SITE)));
const trams = existsSync(tramSource)
  ? publish(TRAM_TIMETABLE_FILE, readFileSync(tramSource))
  : undefined;

const extras: TilesetExtras & PlateExtras = {
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
sharedStats();
// resourceUsage's maxRSS is in KiB
log(
  `done in ${since(started)} ms, peak RSS ${(process.resourceUsage().maxRSS / 1024 ** 2).toFixed(2)} GiB`
);
