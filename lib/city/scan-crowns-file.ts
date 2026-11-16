/**
 * `data/<site>/dlm/canopyx_<tile>.geojson`: the laser scan's crown peaks
 * outside the canopy mask, each with its height and its crown's radius,
 * already thinned against the tree register. Written by
 * pipeline/bake/lowveg.py (step `lowveg`, tiles with a laser scan); read
 * by the build's tree table (scripts/dressing-sources.ts), never served
 * (lib/city/features.ts `CanopyExtraFeature`). One decimal, as the canopy
 * (lib/city/canopy-file.ts). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { featureCollection, featureOf, pointGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const scanCrownProps = z.strictObject({
  /** its height over the ground (m) */
  h: z.number(),
  /** its crown's radius (m) */
  r: z.number(),
});

const scanCrownsFile = featureCollection(
  featureOf(pointGeometry, scanCrownProps)
);

export type ScanCrownsFile = z.infer<typeof scanCrownsFile>;

export const SCAN_CROWNS_FILE: BakeFile<typeof scanCrownsFile> = {
  file: "lib/city/scan-crowns-file.ts",
  schema: scanCrownsFile,
  step: "lowveg",
  writer: "pipeline/bake/lowveg.py",
};
