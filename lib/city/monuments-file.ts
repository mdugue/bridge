/**
 * `data/<site>/dlm/monuments_<tile>.geojson`: fountains, statues, memorial
 * stones and columns — the Basis-DLM's monument points conflated with
 * OSM's (ODbL), measured in DOM1. Written by pipeline/bake/monuments.py
 * `run` (step `monuments`); served to the viewer (lib/city/features.ts
 * `MonumentFeature`, whose rules features.test.ts holds) and read by
 * scripts/prepare/stadtwissen.ts and scripts/bake-stadtwissen.ts. The one
 * schema of the file (ADR 0059).
 */
import { z } from "zod";
import { crsMember, point2, wikidataId } from "./bake-file";
import type { BakeFile } from "./bake-file";
import type { FountainStyle, MonumentForm, MonumentKind } from "./features";

/** lib/city/features.ts `MonumentKind`; held equal by bake-files.test.ts. */
export const MONUMENT_KINDS = [
  "column",
  "fountain",
  "statue",
  "stone",
] as const satisfies readonly MonumentKind[];

/** lib/city/features.ts `MonumentForm`; held equal by the test. */
export const MONUMENT_FORMS = [
  "bust",
  "column",
  "obelisk",
  "sculpture",
  "statue",
  "stele",
  "stone",
] as const satisfies readonly MonumentForm[];

/** lib/city/features.ts `FountainStyle`; held equal by the test. */
export const FOUNTAIN_STYLES = [
  "basin",
  "pool",
  "splash",
] as const satisfies readonly FountainStyle[];

/**
 * A monument's measured bulk: DOM1 − DGM1 on the 1 m grid, the patch that
 * stands clear of trees and facades, padded by one empty cell. Heights in
 * decimetres, row-major from the north-west corner (`west`, `north`).
 */
const reliefGrid = z.strictObject({
  cols: z.int().positive(),
  dm: z.array(z.int()),
  north: z.number(),
  rows: z.int().positive(),
  west: z.number(),
});

const monumentProps = z.strictObject({
  /** the bearing a monument without a relief faces (degrees clockwise
   *  from north): the centre of its square, else its nearest way */
  a: z.int().optional(),
  /** who made it (OSM `artist_name`) */
  artist: z.string().optional(),
  /** a winter housing stood over it when the surface was flown: no
   *  relief, its form's default (a fountain's figure as a sculpture) */
  cover: z.literal(true).optional(),
  /** a fountain with a DLM monument in it (its sculpture is measured) */
  figure: z.boolean().optional(),
  /** what it is, from OSM (absent: nothing says) */
  form: z.enum(MONUMENT_FORMS).optional(),
  /** its tagged height (m, OSM `height`) */
  height: z.number().optional(),
  /** its height measured in the open where no relief is (m, clamped to
   *  its form's range) */
  hm: z.number().optional(),
  /** "lsc": the laser scan measured its relief or `hm`, not DOM1 */
  hs: z.literal("lsc").optional(),
  kind: z.enum(MONUMENT_KINDS),
  /** what it is made of, in German ("Bronze, Granit"; OSM `material`,
   *  else Wikidata's — then `wikidata` is set) */
  material: z.string().optional(),
  name: z.string().optional(),
  /** a point fountain's basin radius (m) where it is small: a drinking
   *  fountain, a stone block (absent: lib/city/monuments.ts
   *  POINT_BASIN_R) */
  r: z.number().positive().optional(),
  /** the measured sculpture or monument (pipeline/bake/monuments.py) */
  relief: reliefGrid.optional(),
  source: z.enum(["dlm", "dlm+osm", "osm"]),
  style: z.enum(FOUNTAIN_STYLES).optional(),
  /** the Wikidata item its `material` comes from */
  wikidata: wikidataId.optional(),
});

const monumentGeometry = z.discriminatedUnion("type", [
  z.strictObject({ coordinates: point2, type: z.literal("Point") }),
  z.strictObject({
    coordinates: z.array(z.array(point2)),
    type: z.literal("Polygon"),
  }),
]);

const monumentFeature = z.strictObject({
  geometry: monumentGeometry,
  properties: monumentProps,
  type: z.literal("Feature"),
});

const monumentsFile = z.strictObject({
  /** absent where neither the DLM nor OSM contributed */
  attribution: z.string().optional(),
  crs: crsMember,
  features: z.array(monumentFeature),
  type: z.literal("FeatureCollection"),
});

export type ReliefGrid = z.infer<typeof reliefGrid>;
export type MonumentProps = z.infer<typeof monumentProps>;
export type MonumentsFile = z.infer<typeof monumentsFile>;

export const MONUMENTS_FILE: BakeFile<typeof monumentsFile> = {
  file: "lib/city/monuments-file.ts",
  schema: monumentsFile,
  step: "monuments",
  writer: "pipeline/bake/monuments.py",
};
