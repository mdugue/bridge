/**
 * `data/<site>/dlm/landmarks_<tile>.json`: the tile's landmarks Wikidata
 * knows, matched to their LoD2 objects (Wikidata CC0, OSM ODbL). Written by
 * pipeline/bake/landmarks.py `run` (step `landmarks`); read by
 * scripts/prepare/landmarks.ts (the city, the Stadtwissen, the site's
 * landmarks), scripts/fetch-stadtwissen.ts and scripts/windows-report.ts.
 * The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import { wikidataId } from "./bake-file";
import type { BakeFile } from "./bake-file";
import { WALL_MATERIALS } from "./osm-buildings-file";

const landmarkEntry = z.strictObject({
  /** drawn height above `z` (m), the LoD2 objects' top */
  h: z.number().optional(),
  /** Wikidata's height (m), when it has one */
  height: z.number().optional(),
  /** Wikidata item id (Q…) */
  id: wikidataId,
  /** Wikipedia articles about it: how notable it is */
  links: z.int().nonnegative(),
  /** the wall material Wikidata names for it (landmarks.py `material_of`) */
  material: z.enum(WALL_MATERIALS).optional(),
  name: z.string(),
  /** the LoD2 CityObject ids that are the landmark */
  objects: z.array(z.string()),
  /** where Wikidata places it, in the site's projected CRS */
  x: z.number(),
  y: z.number(),
  /** the ground under its objects (m) */
  z: z.number().optional(),
});

const landmarkFile = z.strictObject({
  attribution: z.string(),
  landmarks: z.array(landmarkEntry),
});

export type LandmarkEntry = z.infer<typeof landmarkEntry>;
export type LandmarkFile = z.infer<typeof landmarkFile>;

export const LANDMARKS_FILE: BakeFile<typeof landmarkFile> = {
  file: "lib/city/landmarks-file.ts",
  schema: landmarkFile,
  step: "landmarks",
  writer: "pipeline/bake/landmarks.py",
};
