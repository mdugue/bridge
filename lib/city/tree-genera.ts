/**
 * What a tree is, apart from how the year colours it: the genus table the
 * bakes index, and a tree's own offset in the year. Facts of the data —
 * the build's tree table reads them (scripts/bake-dressing.ts) — kept
 * apart from the phenology and its colours (lib/city/tree-season.ts,
 * which hands them on), so a change of a season's look re-bakes nothing.
 * No THREE, no DOM.
 */

/**
 * The genus table, in the bake's order (pipeline/bake/tree_archetypes.py
 * GENERA, written into every trees_<tile>.geojson as `genera`;
 * features.test.ts checks the committed files against this list). A tree's
 * `gn` indexes it. Append only. 0 is "other deciduous", the generic curve
 * the canopy, the tree rows and any tree without a known genus follow.
 */
export const TREE_GENERA = [
  "",
  "Acer",
  "Acer rubrum",
  "Tilia",
  "Quercus",
  "Quercus rubra",
  "Fraxinus",
  "Aesculus",
  "Prunus",
  "Platanus",
  "Robinia",
  "Carpinus",
  "Crataegus",
  "Gleditsia",
  "Sophora",
  "Ulmus",
  "Betula",
  "Malus",
  "Liquidambar",
  "Populus",
  "Ailanthus",
  "Salix",
  "Alnus",
  "Koelreuteria",
  "Sorbus",
  "Liriodendron",
  "Catalpa",
  "Corylus",
  "Pyrus",
  "Ginkgo",
  "Ostrya",
  "Fagus",
  "Castanea",
  "Juglans",
  "Celtis",
  "Larix",
  "Metasequoia",
  "Taxodium",
] as const;
export type TreeGenus = (typeof TREE_GENERA)[number];

/** Largest per-tree offset (days) of the phenology: a street turns over
 *  about a week and a half, not in one night. */
export const SEASON_JITTER_DAYS = 6;

/** A tree's phenology offset (days, ±SEASON_JITTER_DAYS) from a stable
 *  [0, 1) hash of it. */
export function seasonJitter(u: number): number {
  return (u - 0.5) * 2 * SEASON_JITTER_DAYS;
}
