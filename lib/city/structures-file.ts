/**
 * `data/<site>/dlm/structures_<tile>.geojson`: what the surface model shows
 * and LoD2 lacks, confirmed by OSM (ODbL): a column (chimney, tower, mast,
 * water tower, communications tower, lighthouse) as its axis point, or a
 * whole building or a roof on posts (`roof`: a platform roof, a carport) as
 * its outline. Written by pipeline/bake/structures.py (step `structures`);
 * a city-mesh bake input, not served, read by scripts/prepare/city.ts,
 * scripts/prepare/side-bakes.ts and scripts/coarse-crowns.ts
 * (lib/city/features.ts `StructureFeature`, whose ranges features.test.ts
 * holds). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import {
  featureCollection,
  featureOf,
  point2,
  pointGeometry,
  polygonGeometry,
} from "./bake-file";
import type { BakeFile } from "./bake-file";
import { STRUCTURE_KINDS } from "./features";
import { measuredSurface } from "./measured-roofs-file";

/** A height field: heights (m) above `z` on a north-up grid from its
 *  north-west corner (x, y), row by row; -1 outside it. */
const heightField = z.strictObject({
  cols: z.int().positive(),
  /** per cell, where its walls end below `z` (≤ 0): the LoD2 roof under
   *  the cell; without it every wall ends at `z` */
  floor: z.array(z.number()).optional(),
  res: z.number(),
  rows: z.int().positive(),
  x: z.number(),
  y: z.number(),
  z: z.array(z.number()),
});

/** One part of a missing building's shaped roof: a measured roof's part
 *  (lib/city/measured-roofs-file.ts) without the object id. */
const structureRoofPart = z.strictObject({
  coordinates: z.array(z.array(point2)),
  surface: measuredSurface.optional(),
  z: z.number(),
});

const structureProps = z.strictObject({
  /** a building OSM lifts off the ground (a bridge between two, an
   *  overhang): its floor, m over `z`; absent: on the ground */
  base: z.number().optional(),
  /** a relief's height field */
  grid: heightField.optional(),
  /** its height above `z`, measured (m) */
  h: z.number(),
  kind: z.enum(STRUCTURE_KINDS),
  name: z.string().optional(),
  /** a relief: the LoD2 object it sits on (and whose look it wears) */
  of: z.string().optional(),
  /** a measured building's roof in the shape the surface model shows
   *  (structures.py `shaped_roof`, as roofs.py rebuilds a LoD2 roof): each
   *  part's outline, its roof at `z` metres (absolute) and a face's
   *  `surface`; absent: the flat roof at `h` */
  parts: z.array(structureRoofPart).optional(),
  /** a column's foot radius (m) */
  r: z.number().optional(),
  /** a column's top radius (m) */
  rt: z.number().optional(),
  /** a building's height from OSM (`height`, else `building:levels`), where
   *  the surface model was flown before it stood (`osm`); absent: measured */
  src: z.literal("osm").optional(),
  /** the lowest ground (m) */
  z: z.number(),
});

const structuresFile = featureCollection(
  featureOf(z.union([pointGeometry, polygonGeometry]), structureProps)
);

export type HeightField = z.infer<typeof heightField>;
export type StructureRoofPart = z.infer<typeof structureRoofPart>;
export type StructureProps = z.infer<typeof structureProps>;

export const STRUCTURES_FILE: BakeFile<typeof structuresFile> = {
  file: "lib/city/structures-file.ts",
  schema: structuresFile,
  step: "structures",
  writer: "pipeline/bake/structures.py",
};
