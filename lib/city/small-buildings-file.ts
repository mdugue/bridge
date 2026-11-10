/**
 * `data/<site>/dlm/smallbuild_<tile>.geojson`: the small structures the
 * laser scan saw and LoD2 lacks. Written by pipeline/bake/small_buildings.py
 * (step `small-buildings`); a city-mesh bake input, not served, read by
 * scripts/prepare/city.ts, scripts/prepare/side-bakes.ts,
 * scripts/coarse-crowns.ts and scripts/ground-joins.ts (lib/city/features.ts
 * `SmallBuildingFeature`, whose ranges features.test.ts holds). The one
 * schema of the file (ADR 0059).
 */
import { z } from "zod";
import { featureCollection, featureOf, polygonGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const smallBuildingProps = z.strictObject({
  /** its top above `z` (m) */
  h: z.number(),
  /** a pent roof: the height above `z` at each of the ring's first four
   *  corners (m) */
  hc: z.array(z.number()).optional(),
  /** the lowest ground under it (m) */
  z: z.number(),
});

const smallBuildingsFile = featureCollection(
  featureOf(polygonGeometry, smallBuildingProps)
);

export type SmallBuildingProps = z.infer<typeof smallBuildingProps>;

export const SMALL_BUILDINGS_FILE: BakeFile<typeof smallBuildingsFile> = {
  file: "lib/city/small-buildings-file.ts",
  schema: smallBuildingsFile,
  step: "small-buildings",
  writer: "pipeline/bake/small_buildings.py",
};
