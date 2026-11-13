/**
 * `data/<site>/dlm/roofs_<tile>.geojson`: a LoD2 roof that misses DOM1,
 * rebuilt in the shape the scan shows (the provider's licence): one part of
 * the object `id`, outline and courtyards in plan. Written by
 * pipeline/bake/roofs.py (step `roofs`); a city-mesh bake input, not served,
 * read by scripts/prepare/city.ts, which scripts/measured-roofs.ts stands
 * each part for (lib/city/features.ts `MeasuredRoofFeature`, whose ranges
 * features.test.ts holds). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import {
  featureCollection,
  featureOf,
  point2,
  polygonGeometry,
} from "./bake-file";
import type { BakeFile } from "./bake-file";

/** One plane of a face drawn as planes (pipeline/bake/roof_facets.py): its
 *  rings in plan (the outline first, each closed) and its `plane` [a, b,
 *  c]: the height a + b·(x − `x`) + c·(y − `y`) in metres from the part's
 *  `z`, `x` and `y` the surface's. Two facets share a border point for
 *  point; together they cover the part's outline. */
export const measuredFacet = z.strictObject({
  plane: z.tuple([z.number(), z.number(), z.number()]),
  rings: z.array(z.array(point2)).min(1),
});

/** A measured roof face's surface (pipeline/bake/roofs.py `surface`): the
 *  heights in centimetres from its part's `z`, on a north-up grid of `res`
 *  metre cells from its north-west corner (`x`, `y`), row by row from the
 *  north; it reaches two cells past the part's outline. A face drawn as
 *  flanks or planes carries them as `facets` too, which the build draws in
 *  place of the grid: its ridges, hips and valleys straight lines. */
export const measuredSurface = z.strictObject({
  cols: z.int().positive(),
  dz: z.array(z.int()),
  facets: z.array(measuredFacet).min(1).optional(),
  res: z.number(),
  rows: z.int().positive(),
  x: z.number(),
  y: z.number(),
});

const measuredRoofProps = z.strictObject({
  /** its LoD2 CityObject key */
  id: z.string(),
  /** a face (a pitched roof, a vault, a dome); `z` is then its median */
  surface: measuredSurface.optional(),
  /** its roof (m, absolute) */
  z: z.number(),
});

const measuredRoofsFile = featureCollection(
  featureOf(polygonGeometry, measuredRoofProps)
);

export type MeasuredSurface = z.infer<typeof measuredSurface>;
export type MeasuredRoofProps = z.infer<typeof measuredRoofProps>;

export const MEASURED_ROOFS_FILE: BakeFile<typeof measuredRoofsFile> = {
  file: "lib/city/measured-roofs-file.ts",
  schema: measuredRoofsFile,
  step: "roofs",
  writer: "pipeline/bake/roofs.py",
};
