/**
 * `data/<site>/provenance.json`: the record of where the site's committed
 * data came from. Kept by hand (the providers' editions, the URLs, the
 * history) except one member a bake writes, `openstreetmap.baked`: per OSM
 * step and tile, the day of the extract it was baked from
 * (pipeline/bake/osm_source.py `record_bake`). Read by
 * scripts/prepare-data.ts into the viewer's manifest (lib/city/
 * provenance.ts) and by the Open-Data-Wächter. The one schema of the file
 * (ADR 0059): strict where the bake writes and where the manifest reads,
 * loose around them, for the hand-kept members differ from site to site
 * and no reader takes them.
 */
import { z } from "zod";
import type { BakeFile } from "./bake-file";

/** One step's run on one tile: the extract's day ("2026-11-14 (BBBike
 *  extract …)", or "unknown (…)" where the extract names none) and the
 *  day of the bake, apart so the one is never read as the other. */
const bakedEntry = z.strictObject({
  dataAsOf: z.string(),
  on: z.iso.date(),
});

/** step → tile → the run */
const baked = z.record(z.string(), z.record(z.string(), bakedEntry));

/** A hand-kept OSM source's products, each with the day of its data. */
const products = z.record(
  z.string(),
  z.looseObject({ dataAsOf: z.string().optional() })
);
const handSource = z.looseObject({ products: products.optional() });

const provenanceFile = z.looseObject({
  dresden: z
    .looseObject({
      Stadtbaumkataster: z
        .looseObject({ retrieved: z.string().optional() })
        .optional(),
    })
    .optional(),
  geosn: z
    .record(
      z.string(),
      z.looseObject({
        tiles: z
          .record(z.string(), z.looseObject({ stand: z.string().optional() }))
          .optional(),
      })
    )
    .optional(),
  openstreetmap: z
    .looseObject({
      baked: baked.optional(),
      bbbike: handSource.optional(),
      /** Unna's stand-in extract (openstreetmap.fr's Arnsberg region) */
      openstreetmapFr: handSource.optional(),
    })
    .optional(),
  wikidata: z.looseObject({ dataAsOf: z.string().optional() }).optional(),
});

export type ProvenanceFile = z.infer<typeof provenanceFile>;
export type BakedRuns = z.infer<typeof baked>;

export const PROVENANCE_FILE_SPEC: BakeFile<typeof provenanceFile> = {
  file: "lib/city/provenance-file.ts",
  schema: provenanceFile,
  step: "all",
  writer: "pipeline/bake/osm_source.py (openstreetmap.baked; the rest by hand)",
};
