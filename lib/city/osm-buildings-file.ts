/**
 * `data/<site>/dlm/osmbuild_<tile>.json`: what OSM says of each LoD2
 * object (ODbL). Written by pipeline/bake/osm_buildings.py `run` (step
 * `osm-buildings`); read by scripts/prepare/city.ts (`parseCity`),
 * scripts/prepare/stadtwissen.ts, scripts/bake-stadtwissen.ts and
 * scripts/windows-report.ts. The one schema of the file (ADR 0059); what
 * the build adds to a row is lib/city/city-mesh.ts `OsmBuildingFacts`.
 */
import { z } from "zod";
import type { BakeFile } from "./bake-file";
import type { FacadeMaterial } from "./building-tint";
import type { WallMaterial } from "./city-mesh";

/** lib/city/city-mesh.ts `WallMaterial` (osm_buildings.py `MATERIALS`'s
 *  values); bake-files.test.ts holds the two equal. */
export const WALL_MATERIALS = [
  "brick",
  "concrete",
  "glass",
  "metal",
  "plaster",
  "stone",
  "wood",
] as const satisfies readonly WallMaterial[];

/** lib/city/building-tint.ts `FacadeMaterial`; held equal by the test. */
export const FACADE_MATERIALS = [
  "brick",
  "render",
] as const satisfies readonly FacadeMaterial[];

/** an sRGB colour `#rrggbb` */
const hexColour = z.string().regex(/^#[0-9a-f]{6}$/u);

const osmBuildingRow = z.strictObject({
  /** its address line, for the inquiry card (ADR 0042) */
  addr: z.string().optional(),
  /** walls, `#rrggbb` (OSM `building:colour`) */
  colour: hexColour.optional(),
  /** the walls its neighbourhood is mapped as, where they differ from the
   *  tile's (osm_buildings.py `context`) */
  context: z.enum(FACADE_MATERIALS).optional(),
  /** a listed building (OSM `heritage=*`): the bake writes 1, the
   *  viewer reads any count (`inheritedFlags` adds a part's to its root's) */
  heritage: z.int().nonnegative().optional(),
  /** `building:levels`, for the inquiry card and the storey bands */
  levels: z.int().optional(),
  material: z.enum(WALL_MATERIALS).optional(),
  /** the outline's `name`, for the inquiry card */
  name: z.string().optional(),
  /** on a root: the key of the named outline covering its tree, which the
   *  trees one building is split into share (lib/city/ensembles.ts) */
  outline: z.string().optional(),
  /** roof, `#rrggbb` (OSM `roof:colour`) */
  roof_colour: hexColour.optional(),
  /** a shop or a place to eat on its ground floor (1, as `heritage`) */
  shop: z.int().nonnegative().optional(),
  /** where OSM counts none of its own storeys: the storey (m) of the
   *  mapped buildings around it of its roof form and about its eave, else
   *  the tile's (osm_buildings.py `storey`) — its storeys are counted from
   *  its eave with it (lib/city/building-tint.ts `neighbourStorey`) */
  storey: z.number().positive().optional(),
});

const osmBuildingsFile = z.strictObject({
  attribution: z.string(),
  /** the walls the tile is mapped as */
  context: z.enum(FACADE_MATERIALS),
  /** the run's counts, for whoever reads the bake (free in content) */
  meta: z.looseObject({ tile: z.string() }),
  /** per LoD2 CityObject id */
  objects: z.record(z.string(), osmBuildingRow),
});

/** What OSM knows about one CityObject, as the bake writes it. */
export type OsmBuildingRow = z.infer<typeof osmBuildingRow>;
export type OsmBuildingsFile = z.infer<typeof osmBuildingsFile>;

export const OSM_BUILDINGS_FILE: BakeFile<typeof osmBuildingsFile> = {
  file: "lib/city/osm-buildings-file.ts",
  schema: osmBuildingsFile,
  step: "osm-buildings",
  writer: "pipeline/bake/osm_buildings.py",
};
