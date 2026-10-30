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
 * bakes' keys carry: the frame (`offset`), the lines' beds and passages
 * (`bedsIn`, `shapedBy`, digested into the keys) and the side files'
 * published names (in the glTF `extras`). A bake that imports one walks
 * nothing beyond it, so a change to the buildings' bake (the frame's) does
 * not re-bake the grounds; each still walks its own imports for its own
 * artifact (`frame`, `lineLevels`, the side files' entries). A function
 * added to one that a bake calls for its bytes, not for a keyed value,
 * belongs in that bake's module instead.
 */
export const KEY_VALUES = [
  "scripts/prepare/frame.ts",
  "scripts/prepare/lines.ts",
  "scripts/prepare/side-files.ts",
] as const;

/** Where no key's walk goes on (bake-sources.ts `moduleGraph`). */
export const KEY_STOPS: readonly string[] = [...KEY_PLUMBING, ...KEY_VALUES];

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
  colonies: ["scripts/prepare/side-files.ts", "scripts/crop-raster.ts"],
  /** the canopy points packed (and thinned under roofs and sheds) */
  canopy: [
    "scripts/prepare/side-files.ts",
    "lib/city/point-pack.ts",
    "lib/city/roof-trees.ts",
    "lib/city/small-buildings.ts",
    "lib/city/site.ts",
  ],
  /** the site's line levels (ADR 0041) */
  lineLevels: ["scripts/prepare/lines.ts", "scripts/line-levels.ts"],
  /** a class raster downsampled; the artifact table names its size */
  classRaster: [
    "scripts/prepare/side-files.ts",
    "scripts/downsample-raster.ts",
    "lib/city/tile.ts",
  ],
  /** the spawn tile's frame (the recenter offset) */
  frame: ["scripts/prepare/frame.ts", "scripts/bake-city-mesh.ts"],
  /** a tile's buildings, on the ground's heights and the tracks' tops */
  city: [
    "scripts/prepare/city.ts",
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
  hero: ["scripts/prepare/site-wide.ts", "scripts/bake-wissen-hero.ts"],
  /** the city in numbers (the start page) */
  siteStats: [
    "scripts/prepare/site-wide.ts",
    "lib/city/site-stats.ts",
    "lib/city/tile.ts",
  ],
} as const satisfies Record<string, readonly string[]>;
