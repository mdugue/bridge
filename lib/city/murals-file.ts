/**
 * `data/<site>/murals/murals.json`: the murals drawn on their walls, after
 * Commons photos. Written by pipeline/bake/murals.py (site step `murals`,
 * the drawing's fields by its `write_drawing`); read by
 * scripts/prepare-data.ts, which publishes it,
 * and by the viewer through lib/city/murals.ts (`parseMurals`). The one
 * schema of the file (ADR 0059).
 */
import { z } from "zod";
import { point2 } from "./bake-file";
import type { BakeFile } from "./bake-file";

/** a size in pixels */
const pixels = z.tuple([z.int().positive(), z.int().positive()]);
const channel = z.int().min(0).max(255);

/** A photo's Commons credit. */
const muralPhoto = z.strictObject({
  author: z.string(),
  licence: z.string(),
  /** the Commons title, `File:…` */
  title: z.string(),
  /** its Commons page */
  url: z.string(),
});

const mural = z.strictObject({
  /** above sea level (m) */
  bottom: z.number(),
  /** the LoD2 building it hangs on (`buildingId` in the city's table):
   *  it goes when the building does */
  building: z.string(),
  /** how the photo shows it: all of it, or the band of a line's whole
   *  length that it shows (pipeline/bake/murals.py `choose`) */
  how: z.enum(["band", "whole"]),
  /** OSM's id: `n…` a node, `w…` a way */
  id: z.string(),
  /** the pen's colour (sRGB, 0–255) */
  ink: z.tuple([channel, channel, channel]),
  kind: z.string(),
  /** the pen lines' WebP (its red: 255 paper, 0 ink): its file name in
   *  the committed folder, its published name once prepare-data has
   *  published it */
  lines: z.string(),
  name: z.string(),
  /** along the wall, a few cm in front of it, the wall's outside on its
   *  right (projected metres) */
  path: z.array(point2).min(2),
  /** the photo the drawing was made after */
  photo: muralPhoto,
  /** the pen lines' width and height (pixels) */
  px: pixels,
  /** its width along the wall and its height (m) */
  size: point2,
  /** the tile whose buildings hold its wall */
  tile: z.string(),
  top: z.number(),
  /** the wash's WebP (sRGB), named as `lines` is, and its size (pixels) */
  wash: z.string(),
  washPx: pixels,
});

const muralFile = z.strictObject({
  attribution: z.string(),
  murals: z.array(mural),
});

export type MuralPhoto = z.infer<typeof muralPhoto>;
export type Mural = z.infer<typeof mural>;
export type MuralFile = z.infer<typeof muralFile>;

export const MURALS_FILE_SPEC: BakeFile<typeof muralFile> = {
  file: "lib/city/murals-file.ts",
  schema: muralFile,
  step: "murals",
  writer: "pipeline/bake/murals.py",
};
