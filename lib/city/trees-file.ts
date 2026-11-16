/**
 * `data/<site>/dlm/trees_<tile>.geojson`: the individually known trees —
 * a city's tree register and the OSM `natural=tree` nodes it does not
 * cover — with height, crown width, archetype, genus, trunk and planting
 * year. Written by pipeline/bake/trees.py (step `trees`); read by the
 * build's tree table (scripts/dressing-sources.ts) and the tree facts
 * (scripts/prepare/side-files.ts), never served (lib/city/features.ts
 * `TreeFeature`, which adds what only the build knows: an orchard's
 * trees). One decimal for coordinates, heights and widths: the tree
 * table's records are decimetres (lib/city/tree-table.ts). The one schema
 * of the file (ADR 0059).
 */
import { z } from "zod";
import { crsMember, featureOf, pointGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const treeProps = z.strictObject({
  /** the archetype (lib/city/tree-inventory.ts TREE_ARCHETYPES) */
  a: z.number(),
  /** a foliage colour: 1 purple, 2 golden */
  c: z.number().optional(),
  /** the crown's width (m) */
  d: z.number(),
  /** it stands in forest or copse: it vetoes no canopy tree */
  f: z.literal(1).optional(),
  /** a globe cultivar */
  g: z.literal(1).optional(),
  /** the genus, an index into `genera` */
  gn: z.number().optional(),
  /** the height (m) */
  h: z.number(),
  /** deciduous or evergreen */
  l: z.enum(["d", "e"]),
  /** an OSM tree, not the register's */
  s: z.literal("osm").optional(),
  /** the trunk's diameter at breast height (cm) */
  t: z.number().optional(),
  /** the planting year */
  y: z.number().optional(),
});

const treesFile = z.strictObject({
  archetypes: z.array(z.string()),
  attribution: z.string(),
  crs: crsMember,
  features: z.array(featureOf(pointGeometry, treeProps)),
  genera: z.array(z.string()),
  type: z.literal("FeatureCollection"),
});

export type TreesFile = z.infer<typeof treesFile>;

export const TREES_FILE: BakeFile<typeof treesFile> = {
  file: "lib/city/trees-file.ts",
  schema: treesFile,
  step: "trees",
  writer: "pipeline/bake/trees.py",
};
