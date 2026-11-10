/**
 * `data/<site>/dlm/terraces_<tile>.geojson`: raised OSM areas a flight climbs
 * onto that the DGM lacks (the Brühlsche Terrasse; ODbL). Written by
 * pipeline/bake/stairs.py (step `stairs`); a terrain bake input, not served,
 * read by scripts/tile-sources.ts (lib/city/features.ts `TerraceFeature`,
 * whose range features.test.ts holds). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import {
  featureCollection,
  featureOf,
  multiPolygonGeometry,
  polygonGeometry,
} from "./bake-file";
import type { BakeFile } from "./bake-file";

const terraceProps = z.strictObject({
  /** the level the build lifts the ground inside it to (m) */
  z: z.number(),
});

const terracesFile = featureCollection(
  featureOf(z.union([polygonGeometry, multiPolygonGeometry]), terraceProps)
);

export type TerraceProps = z.infer<typeof terraceProps>;

export const TERRACES_FILE: BakeFile<typeof terracesFile> = {
  file: "lib/city/terraces-file.ts",
  schema: terracesFile,
  step: "stairs",
  writer: "pipeline/bake/stairs.py",
};
