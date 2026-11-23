/**
 * `data/<site>/dop/roofcolor_<tile>.json`: the roofs' colours read from
 * the orthophoto's sunlit texels (linear RGB). Written by
 * pipeline/bake/roof_colour.py `run` (step `roof-colour`); read by
 * scripts/prepare/city.ts for the city bake (lib/city/building-tint.ts
 * says what each member means). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import type { BakeFile } from "./bake-file";

const linear = z.number().nonnegative();
const rgb = z.tuple([linear, linear, linear]);
/** `[key, key2, r, g, b]`: two numbers that find the face, part or
 *  appended roof (and check it), then its colour */
const row = z.tuple([z.number(), z.number(), linear, linear, linear]);

const roofColours = z.strictObject({
  /** per LoD2 object: its faces whose own colour differs from it,
   *  `[geometry, surface, r, g, b]` */
  faces: z.record(z.string(), z.array(row)),
  /** the structures beyond LoD2 the build appends, `[index, z, r, g, b]` */
  gaps: z.array(row),
  /** the run's measurements, for whoever reads the bake (free in content) */
  meta: z.looseObject({ tile: z.string() }),
  /** per LoD2 object: its rebuilt roof's parts whose own colour differs,
   *  `[part, z, r, g, b]` */
  parts: z.record(z.string(), z.array(row)),
  /** per LoD2 object: its roof's colour */
  roofs: z.record(z.string(), rgb),
  /** the laser scan's sheds the build appends, `[index, z, r, g, b]` */
  scan: z.array(row),
});

export type RoofColours = z.infer<typeof roofColours>;

export const ROOF_COLOURS_FILE: BakeFile<typeof roofColours> = {
  file: "lib/city/roof-colours-file.ts",
  schema: roofColours,
  step: "roof-colour",
  writer: "pipeline/bake/roof_colour.py",
};
