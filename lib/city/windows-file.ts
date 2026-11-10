/**
 * `data/<site>/dlm/windows_<tile>.json`: a tile's facade traits, per
 * Building gml:id, and the window model where one is drawn (Mapillary
 * CC BY-SA 4.0). Written by pipeline/bake/windows.py (step `windows`,
 * `phase` by pipeline/bake/window_axes.py); a city-mesh bake input, not
 * served, read by scripts/prepare/city.ts (lib/city/windows.ts says how the
 * clay draws it; features.test.ts holds its ranges). The one schema of the
 * file (ADR 0059).
 */
import { z } from "zod";
import { point2 } from "./bake-file";
import type { BakeFile } from "./bake-file";

/** What windows.py models on a wall (metres). */
const facadeModel = z.strictObject({
  /** the axes' spacing along the wall */
  axis: z.number(),
  /** a set-off surround round each window */
  frame: z.boolean().optional(),
  /** a regular grid, or a loose one (the axes a little off) */
  grid: z.enum(["loose", "regular"]),
  /** the window's height */
  h: z.number(),
  /** flat lisenes between the axes (not drawn: no agreement) */
  lisene: z.boolean().optional(),
  /** much fine texture in the plaster: ornament */
  orn: z.boolean().optional(),
  /** where an axis stands: metres from the wall's start `a`, in [0, axis)
   *  — where the drives that saw the wall registered onto each other
   *  (pipeline/bake/window_axes.py); else the axes are centred */
  phase: z.number().optional(),
  /** a band of horizontal joints recurring at the storey under the
   *  windows (not drawn: it did not agree between two drives) */
  sill: z.boolean().optional(),
  /** the window's width */
  w: z.number(),
});

/** What the street photos read of a wall's glass (pipeline/bake/
 *  facade_glass.py, windows.py `wall_glass`). */
const wallGlass = z.strictObject({
  /** enough of the readings say glass: a curtain wall */
  glass: z.boolean(),
  /** the readings */
  n: z.int().min(2),
  /** their median probability of glass, ‰ */
  p: z.int().min(0).max(1000),
});

/** A measured wall: its frame as in shopfronts_<tile>.json, the traits, and
 *  the model where one is drawn. A wall the photos read as glass has no
 *  model; one no panorama measured has its glass alone (no traits, `imgs`
 *  0). */
const windowWall = z.strictObject({
  a: point2,
  b: point2,
  /** the drives that registered onto each other (window_axes.py), where
   *  the model has a `phase` */
  drives: z.int().optional(),
  eave: z.number(),
  glass: wallGlass.optional(),
  imgs: z.int(),
  L: z.number(),
  model: facadeModel.optional(),
  n: point2,
  oid: z.string(),
  seqs: z.int(),
  traits: z.record(z.string(), z.number()),
  wi: z.int(),
  z: point2.optional(),
});

const windowFile = z.strictObject({
  attribution: z.string(),
  buildings: z.record(z.string(), z.array(windowWall)),
  /** per feature [Spearman ρ between two sequences, walls] on this tile */
  reliability: z.record(z.string(), z.tuple([z.number().nullable(), z.int()])),
});

export type FacadeModel = z.infer<typeof facadeModel>;
export type WallGlass = z.infer<typeof wallGlass>;
export type WindowWall = z.infer<typeof windowWall>;
export type WindowFile = z.infer<typeof windowFile>;

export const WINDOWS_FILE: BakeFile<typeof windowFile> = {
  file: "lib/city/windows-file.ts",
  schema: windowFile,
  step: "windows",
  writer: "pipeline/bake/windows.py",
};
