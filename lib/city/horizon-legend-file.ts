/**
 * `data/<site>/dlm/horizon_<tile>.json`: the horizon raster's legend
 * (azimuths, bands, angle scales, credit) and, where GLO-30 stood in
 * beyond the site, the valley's rim around the tile's low ground. Written
 * by pipeline/bake/skyview.py `legend` (step `skyview`, the rim from
 * glo30.py `rims`); read by scripts/prepare-data.ts for the valley haze's
 * depth (lib/city/valley-fog.ts). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { point2 } from "./bake-file";
import type { BakeFile } from "./bake-file";

const band = z.strictObject({
  degPerUnit: z.number().positive(),
  farM: z.number().positive(),
  name: z.enum(["far", "near"]),
  nearM: z.number().positive(),
  /** the array texture's layers it fills, [first, end) */
  planes: z.tuple([z.number().int(), z.number().int()]),
  /** the far band only, where GLO-30 stood in: how far its terrain reaches */
  terrainFarM: z.number().positive().optional(),
});

const horizonLegend = z.strictObject({
  attribution: z.string(),
  azimuthsDeg: z.array(z.number()),
  bands: z.tuple([band, band]),
  /** prose for whoever reads the bake */
  beyond: z.string(),
  footprints: z.string(),
  layout: z.string(),
  observer: z.string(),
  px: z.number().int().positive(),
  /** where GLO-30 stood in beyond the site (glo30.py `rims`) */
  valley: z
    .strictObject({
      /** the low ground the rim is measured from */
      at: point2,
      floorM: z.number(),
      reachM: z.number().positive(),
      /** per azimuth, the rim's height (m); null where the sector holds no
       *  ground */
      rimM: z.array(z.number().nullable()),
    })
    .optional(),
});

export type HorizonLegend = z.infer<typeof horizonLegend>;

export const HORIZON_LEGEND_FILE: BakeFile<typeof horizonLegend> = {
  file: "lib/city/horizon-legend-file.ts",
  schema: horizonLegend,
  step: "skyview",
  writer: "pipeline/bake/skyview.py",
};
