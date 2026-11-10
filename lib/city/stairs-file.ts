/**
 * `data/<site>/dlm/stairs_<tile>.geojson`: OSM's `highway=steps` flights
 * (ODbL), the axis running bottom → top. Written by pipeline/bake/stairs.py
 * (step `stairs`); a terrain bake input, not served, read by
 * scripts/tile-sources.ts (lib/city/features.ts `StairFeature`, whose ranges
 * features.test.ts holds). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { featureCollection, featureOf, lineGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const flags = z.tuple([z.boolean(), z.boolean()]);

const stairProps = z.strictObject({
  /** what it is made of (its surface, else the site's majority) */
  mat: z.string().optional(),
  /** its step count */
  n: z.int(),
  /** handrails to draw, left and right of the climb */
  rail: flags.optional(),
  /** its width (m) */
  w: z.number(),
  /** an OSM wall or building along the left and the right side */
  walled: flags.optional(),
  /** the two landing heights (m) */
  z: z.tuple([z.number(), z.number()]),
});

const stairsFile = featureCollection(featureOf(lineGeometry, stairProps));

export type StairProps = z.infer<typeof stairProps>;

export const STAIRS_FILE: BakeFile<typeof stairsFile> = {
  file: "lib/city/stairs-file.ts",
  schema: stairsFile,
  step: "stairs",
  writer: "pipeline/bake/stairs.py",
};
