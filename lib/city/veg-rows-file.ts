/**
 * `data/<site>/dlm/vegrows_<tile>.geojson`: the Basis-DLM's tree rows and
 * hedges as lines. Written by pipeline/bake/landcover.py (step `landcover`); served to
 * the viewer for its hedges (lib/city/features.ts `VegRowFeature`) and
 * read by the build's tree table for the rows no surface model measured
 * (scripts/dressing-sources.ts). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { crsMember, featureOf, lineGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const vegRowProps = z.strictObject({
  kind: z.enum(["hedge", "treerow"]),
});

const vegRowsFile = z.strictObject({
  crs: crsMember,
  features: z.array(featureOf(lineGeometry, vegRowProps)),
  type: z.literal("FeatureCollection"),
});

export type VegRowsFile = z.infer<typeof vegRowsFile>;

export const VEG_ROWS_FILE: BakeFile<typeof vegRowsFile> = {
  file: "lib/city/veg-rows-file.ts",
  schema: vegRowsFile,
  step: "landcover",
  writer: "pipeline/bake/landcover.py",
};
