/**
 * `data/<site>/dlm/passages_<tile>.geojson`: passages through LoD2 buildings
 * (ODbL), OSM's `tunnel=building_passage` ways merged end to end as the axis
 * they run on through the walls. Written by pipeline/bake/passages.py (step
 * `passages`); a city-mesh bake input, not served, read by
 * scripts/prepare/city.ts (lib/city/features.ts `PassageFeature`, whose
 * ranges features.test.ts holds). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import {
  featureCollection,
  featureOf,
  lineGeometry,
  point2,
} from "./bake-file";
import type { BakeFile } from "./bake-file";

/** One LoD2 object's share of a passage, all EPSG. */
const passagePart = z.strictObject({
  /** its portals `[x, y, nx, ny]` (the wall's outward normal) */
  portals: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])),
  /** its ceiling's plan (outer rings) */
  roof: z.array(z.array(point2)),
  /** the walls along it, each walked with the passage on its left */
  sides: z.array(z.array(point2)),
});

const passageProps = z.strictObject({
  /** OSM's clear height (m); null: the build takes the ground storey's */
  h: z.number().nullable(),
  /** the way's `highway` or `railway` value */
  kind: z.string(),
  /** what each LoD2 object it runs through holds of it */
  of: z.record(z.string(), passagePart),
  /** the OSM ways merged into it */
  osm: z.array(z.int()),
  /** its width (m), from OSM's `width` or its `kind` (`wFrom`) */
  w: z.number(),
  wFrom: z.enum(["kind", "width"]),
  /** the ground per vertex of the axis (m) */
  z: z.array(z.number()),
});

const passagesFile = featureCollection(featureOf(lineGeometry, passageProps));

export type PassagePart = z.infer<typeof passagePart>;
export type PassageProps = z.infer<typeof passageProps>;

export const PASSAGES_FILE: BakeFile<typeof passagesFile> = {
  file: "lib/city/passages-file.ts",
  schema: passagesFile,
  step: "passages",
  writer: "pipeline/bake/passages.py",
};
