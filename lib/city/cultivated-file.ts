/**
 * `data/<site>/dlm/cultivated_<tile>.geojson`: allotment colonies and
 * their parcels, orchards and their trees, vineyards and their rows (OSM,
 * ODbL; measured in the surface model and the orthophoto). Written by
 * pipeline/bake/cultivated.py (step `cultivated`); served to the viewer
 * for its vine rows (lib/city/features.ts `CultivatedFeature`) and read by
 * the build's tree table for the orchards' trees
 * (scripts/dressing-sources.ts). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import {
  featureCollection,
  featureOf,
  lineGeometry,
  multiPolygonGeometry,
  pointGeometry,
  polygonGeometry,
} from "./bake-file";
import type { BakeFile } from "./bake-file";

const cultivatedProps = z.strictObject({
  /** a tree's crown width (m) */
  d: z.number().optional(),
  /** a vineyard's row bearing (degrees) */
  dir: z.number().optional(),
  /** an orchard's or a tree's genus */
  g: z.string().optional(),
  /** a vineyard's row spacing (m) */
  gap: z.number().optional(),
  /** a tree's height (m) */
  h: z.number().optional(),
  k: z.enum(["colony", "orchard", "parcel", "row", "tree", "vineyard"]),
  /** an evergreen tree */
  l: z.literal("e").optional(),
  /** where a measure came from */
  src: z
    .enum(["axis", "contour", "dom", "dop", "fall", "grid", "osm"])
    .optional(),
});

const cultivatedFile = featureCollection(
  featureOf(
    z.union([
      lineGeometry,
      multiPolygonGeometry,
      pointGeometry,
      polygonGeometry,
    ]),
    cultivatedProps
  )
);

export type CultivatedFile = z.infer<typeof cultivatedFile>;

export const CULTIVATED_FILE: BakeFile<typeof cultivatedFile> = {
  file: "lib/city/cultivated-file.ts",
  schema: cultivatedFile,
  step: "cultivated",
  writer: "pipeline/bake/cultivated.py",
};
