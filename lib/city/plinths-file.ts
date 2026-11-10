/**
 * `data/<site>/dlm/plinths_<tile>.geojson`: a building's plinth on the
 * street side of its LoD2 walls (LoD2 + DGM1): level pieces of the wall's
 * open stretches, each walked with the street to its right (a→b). Written by
 * pipeline/bake/plinths.py (step `plinths`), which carries no `attribution`
 * member; a city-mesh bake input, not served, read by
 * scripts/prepare/city.ts and scripts/ground-joins.ts (lib/city/features.ts
 * `PlinthFeature`, whose ranges features.test.ts holds). The one schema of
 * the file (ADR 0059).
 */
import { z } from "zod";
import { crsMember, featureOf, multiLineGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const plinthProps = z.strictObject({
  /** the lowest ground under each line (m) */
  g: z.array(z.number()),
  /** the LoD2 object it belongs to */
  of: z.string(),
  /** each line's top (m) */
  top: z.array(z.number()),
});

const plinthsFile = z.strictObject({
  crs: crsMember,
  features: z.array(featureOf(multiLineGeometry, plinthProps)),
  type: z.literal("FeatureCollection"),
});

export type PlinthProps = z.infer<typeof plinthProps>;

export const PLINTHS_FILE: BakeFile<typeof plinthsFile> = {
  file: "lib/city/plinths-file.ts",
  schema: plinthsFile,
  step: "plinths",
  writer: "pipeline/bake/plinths.py",
};
