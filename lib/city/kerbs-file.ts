/**
 * `data/<site>/dlm/kerbs_<tile>.geojson`: the kerb lines, the smoothed
 * carriageway edge from the Basis-DLM road class, the road on each line's
 * left. Written by pipeline/bake/edges.py (step `edges`, `low` by
 * pipeline/bake/kerb_drops.py); a terrain bake input, not served, read by
 * scripts/tile-sources.ts (lib/city/features.ts `KerbFeature`). The one
 * schema of the file (ADR 0059).
 */
import { z } from "zod";
import { featureCollection, featureOf, lineGeometry } from "./bake-file";
import type { BakeFile } from "./bake-file";

const kerbProps = z.strictObject({
  /** where it is lowered, `[from, to, kerb height]` in metres along the
   *  line: at crossings, lowered or flush kerb nodes and driveways */
  low: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
});

const kerbsFile = featureCollection(featureOf(lineGeometry, kerbProps));

export type KerbProps = z.infer<typeof kerbProps>;

export const KERBS_FILE: BakeFile<typeof kerbsFile> = {
  file: "lib/city/kerbs-file.ts",
  schema: kerbsFile,
  step: "edges",
  writer: "pipeline/bake/edges.py",
};
