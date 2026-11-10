/**
 * `data/<site>/dlm/dormers_<tile>.geojson`: the dormers and chimneys the
 * surface model shows on LoD2 roofs (DOM1, the provider's licence). Written
 * by pipeline/bake/dormers.py (step `dormers`); a city-mesh bake input, not
 * served, read by scripts/prepare/city.ts (lib/city/features.ts
 * `DormerFeature`, whose ranges features.test.ts holds). The one schema of
 * the file (ADR 0059).
 */
import { z } from "zod";
import { featureCollection, featureOf, pointGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const dormerProps = z.strictObject({
  /** the roof's downslope direction */
  ax: z.number(),
  ay: z.number(),
  /** its depth along the slope (m) */
  d: z.number(),
  /** a chimney: the same record on any roof, its box `w` × `d` along
   *  `ax`, `ay` (on a level roof its footprint's longer side), from the
   *  roof up to `top` */
  k: z.literal("chimney").optional(),
  /** the LoD2 object it sits on */
  of: z.string(),
  /** the roof's slope (degrees) */
  slope: z.number(),
  /** a shed dormer's roof's fall (degrees, down the slope); `top` is then
   *  where that roof meets the main roof, the line it falls from */
  tf: z.number().optional(),
  /** its measured top (m) */
  top: z.number(),
  /** its width across the slope (m) */
  w: z.number(),
  /** the roof's height at its centre (m) */
  z: z.number(),
});

const dormersFile = featureCollection(featureOf(pointGeometry, dormerProps));

export type DormerProps = z.infer<typeof dormerProps>;

export const DORMERS_FILE: BakeFile<typeof dormersFile> = {
  file: "lib/city/dormers-file.ts",
  schema: dormersFile,
  step: "dormers",
  writer: "pipeline/bake/dormers.py",
};
