/**
 * `data/<site>/landmark-facts.json`: what a landmark's nameplate says
 * under its name (Wikidata, CC0). Written by
 * pipeline/bake/landmark_facts.py `run_site` (site step `landmark-facts`);
 * published by scripts/prepare-data.ts, read by the viewer through
 * lib/city/landmark-facts.ts (its guard `isLandmarkFactsFile`). The one
 * schema of the file (ADR 0059).
 */
import { z } from "zod";
import { wikidataId } from "./bake-file";
import type { BakeFile } from "./bake-file";

/** a year span: [start] or [start, end] */
const years = z.array(z.int()).min(1).max(2);

const landmarkFactsEntry = z.strictObject({
  /** the architects (Wikidata P84), at most two */
  architects: z.array(z.string()).optional(),
  /** the years it was built: [start] or [start, end] */
  built: years.optional(),
  /** the LoD2 Buildings that are it (the viewer's `buildingId`) */
  buildings: z.array(z.string()),
  /** Wikidata's height (m) */
  height: z.number().optional(),
  /** Wikidata item id (Q…) */
  id: wikidataId,
  name: z.string(),
  /** the years it was rebuilt: [end] or [start, end] */
  rebuilt: years.optional(),
  /** the year its rebuilding began, where no end is stated */
  rebuiltFrom: z.int().optional(),
});

const landmarkFactsFile = z.strictObject({
  attribution: z.string(),
  landmarks: z.array(landmarkFactsEntry),
});

/** One landmark's facts as the bake writes them. */
export type LandmarkFactsEntry = z.infer<typeof landmarkFactsEntry>;
export type LandmarkFactsFile = z.infer<typeof landmarkFactsFile>;

export const LANDMARK_FACTS_FILE_SPEC: BakeFile<typeof landmarkFactsFile> = {
  file: "lib/city/landmark-facts-file.ts",
  schema: landmarkFactsFile,
  step: "landmark-facts",
  writer: "pipeline/bake/landmark_facts.py",
};
