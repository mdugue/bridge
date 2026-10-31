/**
 * The bake modules each cached artifact of scripts/prepare-data.ts is made
 * by: its cache key walks every module these import (bake-sources.ts
 * `moduleGraph`), so a change to any of them re-bakes that artifact and
 * nothing else. The rule (AGENTS.md, Hard rules, Data): a module
 * prepare-data calls to make an artifact is one of its entries or is
 * imported from one — bake-entries.test.ts holds every module
 * prepare-data imports to being in some bake's key.
 */

/**
 * The plumbing every bake module imports (the site, the mode, the log, the
 * cache, the publisher): every key carries it whole (prepare/context.ts
 * `COMMON_SOURCES`), but no key walks its imports, which reach every site's
 * config (the site registry) and the cache's own machinery.
 * bake-entries.test.ts holds it to importing only those.
 */
export const KEY_PLUMBING = ["scripts/prepare/context.ts"] as const;

/**
 * The step modules whose exports reach other bakes only as values those
 * bakes' keys carry: the frame (`offset`; the buildings' bake, which also
 * reads `spawnFrame`, lists frame.ts among its entries) and the side
 * files' published names (in the glTF `extras`). A bake that imports one leaves it out of its key,
 * with what only it imports, so a change to the buildings' bake (the
 * frame's) does not re-bake the grounds; the frame still walks its own
 * imports where it is an entry (`frame`, `city`), and the side files bake nothing
 * themselves (side-bakes.ts does). bake-entries.test.ts pins what each
 * exports: a function a bake would call for its bytes belongs in that
 * bake's module.
 */
export const KEY_VALUES = [
  "scripts/prepare/frame.ts",
  "scripts/prepare/side-files.ts",
] as const;

/** This table: every step module imports it for its row, and each row
 *  reaches its key as the modules it walks, so a row's edit re-bakes that
 *  row's artifact alone. */
const KEY_TABLE = "scripts/bake-entries.ts";

/** What no key holds or walks past, unless it is the key's own entry
 *  (bake-sources.ts `moduleGraph`); the plumbing reaches every key whole
 *  instead. */
export const KEY_STOPS: readonly string[] = [
  ...KEY_PLUMBING,
  ...KEY_VALUES,
  KEY_TABLE,
];

/** The modules a tile's shaped ground is baked by (`shapedTerrain`): the
 *  DGM reader and meshers, the TIN's tolerance, the stair, terrace and wall
 *  sources, the passages the site's lines open, the levels' grid sizes and
 *  the tile's extent — and the cache entry the fine ground is read back
 *  from (`groundFile`): every artifact made from it keys on its reader. */
const GROUND = [
  "scripts/prepare/ground.ts",
  "scripts/bake-tiles.ts",
  "scripts/bake-terrain-tin.ts",
  "scripts/ground-pack.ts",
  "scripts/tile-sources.ts",
  "scripts/line-levels.ts",
  "lib/city/tileset.ts",
  "lib/city/site.ts",
];

export const BAKE_ENTRIES = {
  /** a tile's colony raster, cropped to its colonies, and its phone twin */
  colonies: ["scripts/prepare/side-bakes.ts", "scripts/crop-raster.ts"],
  /** the canopy points packed (and thinned under roofs and sheds) */
  canopy: [
    "scripts/prepare/side-bakes.ts",
    "lib/city/point-pack.ts",
    "lib/city/roof-trees.ts",
    "lib/city/small-buildings.ts",
    "lib/city/site.ts",
  ],
  /** the site's line levels (ADR 0041) */
  lineLevels: ["scripts/prepare/lines.ts", "scripts/line-levels.ts"],
  /** a class raster downsampled; the artifact table names its size */
  classRaster: [
    "scripts/prepare/side-bakes.ts",
    "scripts/downsample-raster.ts",
    "lib/city/tile.ts",
  ],
  /** the spawn tile's frame (the recenter offset) */
  frame: ["scripts/prepare/frame.ts", "scripts/bake-city-mesh.ts"],
  /** a tile's buildings, on the ground's heights and the tracks' tops */
  city: [
    "scripts/prepare/city.ts",
    // the spawn tile's frame every other tile is placed in (`spawnFrame`)
    "scripts/prepare/frame.ts",
    "scripts/prepare/landmarks.ts",
    "scripts/bake-city-mesh.ts",
    "scripts/tile-glb.ts",
    "scripts/measured-roofs.ts",
    // the ground's heights
    "scripts/bake-tiles.ts",
    "scripts/ground-pack.ts",
    // the tops the tracks run on
    "lib/city/track-formation.ts",
  ],
  /** a tile's fine ground (its TIN and heights) */
  ground: GROUND,
  /** a tile's coarse crowns */
  coarseCrowns: [
    "scripts/prepare/terrain.ts",
    "scripts/coarse-crowns.ts",
    ...GROUND,
  ],
  /** a terrain level's glTF (fineChildren: the gates cut the walls) */
  terrain: [
    "scripts/prepare/terrain.ts",
    ...GROUND,
    "scripts/tile-glb.ts",
    "lib/city/fences.ts",
    "lib/city/tile.ts",
  ],
  /** the ground plate under every tile without terrain */
  plate: [
    "scripts/prepare/plate.ts",
    ...GROUND,
    "lib/city/ground-plate.ts",
    "lib/city/png-raster.ts",
  ],
  /** the /wissen map picture; it imports the palette */
  hero: ["scripts/prepare/hero.ts", "scripts/bake-wissen-hero.ts"],
  /** a tile's Stadtwissen directory (ADR 0055) */
  stadtwissen: [
    "scripts/prepare/stadtwissen.ts",
    "scripts/bake-stadtwissen.ts",
    "scripts/prepare/landmarks.ts",
  ],
  /** the city in numbers (the start page) */
  siteStats: [
    "scripts/prepare/stats.ts",
    "scripts/prepare/landmarks.ts",
    "lib/city/site-stats.ts",
    "lib/city/tile.ts",
  ],
} as const satisfies Record<string, readonly string[]>;
