/**
 * `data/<site>/dlm/shopfronts_<tile>.json`: a tile's shopfronts, per
 * Building gml:id (Mapillary CC BY-SA 4.0, the canopies from DOM1 under the
 * provider's licence). Written by pipeline/bake/shopfronts.py (step
 * `shopfronts`); a city-mesh bake input, not served, read by
 * scripts/prepare/city.ts and scripts/ground-joins.ts (features.test.ts
 * holds its ranges). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { point2 } from "./bake-file";
import type { BakeFile } from "./bake-file";

/**
 * One wall's shopfront: the LoD2 object `oid` and its wall `wi` as facades.py
 * numbers them, the wall's base points `a` → `b` (EPSG; `s` runs from `a`),
 * its length, outward normal and the lowest ground in front of each end
 * (`z`). `src: "photo"`: the bays and the sign band measured in street
 * panoramas, the ground floor's top where measured (metres above the
 * ground); `src: "canopy"`: no photo measured this wall, but a canopy runs
 * on from a measured one of the same object. `row`: a glazed shop row, glass
 * from pier to pier. `canopy`: where the surface model shows a canopy over
 * the shopfront, its depth out of the wall `d` and its top above the ground
 * `h`.
 */
const shopfrontWall = z.strictObject({
  a: point2,
  b: point2,
  bays: z.array(point2).optional(),
  canopy: z
    .array(z.strictObject({ at: point2, d: z.number(), h: z.number() }))
    .optional(),
  gf_top: z.number().optional(),
  imgs: z.int().optional(),
  L: z.number(),
  n: point2,
  oid: z.string(),
  row: z.boolean().optional(),
  seqs: z.int().optional(),
  sign: z
    .strictObject({ at: z.array(point2), z: point2.optional() })
    .optional(),
  src: z.enum(["canopy", "photo"]),
  wi: z.int(),
  z: point2.optional(),
});

const shopfrontsFile = z.strictObject({
  attribution: z.string(),
  bin_m: z.number(),
  buildings: z.record(z.string(), z.array(shopfrontWall)),
});

export type ShopfrontWall = z.infer<typeof shopfrontWall>;
export type ShopfrontFile = z.infer<typeof shopfrontsFile>;

export const SHOPFRONTS_FILE: BakeFile<typeof shopfrontsFile> = {
  file: "lib/city/shopfronts-file.ts",
  schema: shopfrontsFile,
  step: "shopfronts",
  writer: "pipeline/bake/shopfronts.py",
};
