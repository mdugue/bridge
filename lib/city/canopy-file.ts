/**
 * `data/<site>/dlm/canopy_<tile>.geojson`: one tree per crown peak of the
 * surface model (DOM1 − DGM1), with its measured height. Written by
 * pipeline/bake/canopy.py (step `canopy`); read by the build's tree table
 * (scripts/dressing-sources.ts, scripts/bake-dressing.ts), never served
 * (lib/city/features.ts `CanopyFeature`). Coordinates and heights have one
 * decimal: the tree table's records are decimetres
 * (lib/city/tree-table.ts; tree-table.test.ts holds every committed file
 * to it). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { crsMember, featureOf, pointGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const canopyProps = z.strictObject({
  /** its crown reaches over a carriageway */
  c: z.literal(1).optional(),
  /** its height over the ground (m) */
  h: z.number(),
  /** an evergreen */
  l: z.literal("e").optional(),
  /** … which the leaf-off orthophoto showed, not its forest's kind */
  ls: z.literal("dop").optional(),
  /** an evergreen whose crown is a pine's */
  pine: z.literal(1).optional(),
  /** a tree of a mapped row, at its crown peak */
  row: z.literal(1).optional(),
});

const canopyFile = z.strictObject({
  crs: crsMember,
  features: z.array(featureOf(pointGeometry, canopyProps)),
  /** the tile's mapped tree rows the bake stood trees along: with this
   *  member the viewer's build plants none of its own */
  rows: z.strictObject({ lines: z.number(), trees: z.number() }).optional(),
  type: z.literal("FeatureCollection"),
});

export type CanopyFile = z.infer<typeof canopyFile>;

export const CANOPY_FILE: BakeFile<typeof canopyFile> = {
  file: "lib/city/canopy-file.ts",
  schema: canopyFile,
  step: "canopy",
  writer: "pipeline/bake/canopy.py",
};
