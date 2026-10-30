/**
 * The bake modules each cached artifact of scripts/prepare-data.ts is made
 * by: its cache key walks every module these import (bake-sources.ts
 * `moduleGraph`), so a change to any of them re-bakes that artifact and
 * nothing else. The rule (AGENTS.md, Hard rules, Data): a module
 * prepare-data calls to make an artifact is one of its entries or is
 * imported from one — bake-entries.test.ts holds every module
 * prepare-data imports to being in some bake's key.
 */

/** The modules a tile's shaped ground is baked by (`shapedTerrain`): the
 *  DGM reader and meshers, the TIN's tolerance, the stair, terrace and wall
 *  sources, the passages the site's lines open, the levels' grid sizes and
 *  the tile's extent — and the cache entry the fine ground is read back
 *  from (`groundFile`): every artifact made from it keys on its reader. */
const GROUND = [
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
  colonies: ["scripts/crop-raster.ts"],
  /** the canopy points packed (and thinned under roofs and sheds) */
  canopy: [
    "lib/city/point-pack.ts",
    "lib/city/roof-trees.ts",
    "lib/city/small-buildings.ts",
    "lib/city/site.ts",
  ],
  /** the site's line levels (ADR 0041) */
  lineLevels: ["scripts/line-levels.ts"],
  /** a class raster downsampled; the artifact table names its size */
  classRaster: ["scripts/downsample-raster.ts", "lib/city/tile.ts"],
  /** the spawn tile's frame (the recenter offset) */
  frame: ["scripts/bake-city-mesh.ts"],
  /** a tile's buildings, on the ground's heights and the tracks' tops */
  city: [
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
  coarseCrowns: ["scripts/coarse-crowns.ts", ...GROUND],
  /** a terrain level's glTF (fineChildren: the gates cut the walls) */
  terrain: [
    ...GROUND,
    "scripts/tile-glb.ts",
    "lib/city/fences.ts",
    "lib/city/tile.ts",
  ],
  /** the ground plate under every tile without terrain */
  plate: [...GROUND, "lib/city/ground-plate.ts", "lib/city/png-raster.ts"],
  /** the /wissen map picture; it imports the palette */
  hero: ["scripts/bake-wissen-hero.ts"],
  /** the city in numbers (the start page) */
  siteStats: ["lib/city/site-stats.ts", "lib/city/tile.ts"],
} as const satisfies Record<string, readonly string[]>;
