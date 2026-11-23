/**
 * `data/<site>/dlm/doors_<tile>.geojson`: OSM's entrances (ODbL) snapped
 * onto the nearest footprint edge of a LoD2 object. Written by
 * pipeline/bake/doors.py (step `doors`); a city-mesh bake input, not
 * served, read by scripts/prepare/city.ts and scripts/ground-joins.ts
 * (lib/city/features.ts `DoorFeature`, whose ranges features.test.ts
 * holds). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { featureCollection, featureOf, pointGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const doorProps = z.strictObject({
  /** the door's height (m) */
  h: z.number(),
  /** its `entrance=*` value */
  kind: z.string(),
  /** the wall's outward normal */
  nx: z.number(),
  ny: z.number(),
  /** the LoD2 object whose wall it stands on */
  of: z.string(),
  /** the door's width (m) */
  w: z.number(),
  /** the ground under its sill (m) */
  z: z.number(),
});

const doorsFile = featureCollection(featureOf(pointGeometry, doorProps));

export type DoorProps = z.infer<typeof doorProps>;

export const DOORS_FILE: BakeFile<typeof doorsFile> = {
  file: "lib/city/doors-file.ts",
  schema: doorsFile,
  step: "doors",
  writer: "pipeline/bake/doors.py",
};
