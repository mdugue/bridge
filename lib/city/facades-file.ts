/**
 * `data/<site>/dlm/facades_<tile>.json`: what street photos say about a
 * tile's facades, three coarse readings per building. Written by
 * pipeline/bake/facades.py `write_readings` (step `facades`); checked by
 * scripts/prepare/side-files.ts before it publishes the bytes, and read by
 * the viewer through lib/city/facade-reading.ts (`isFacadeReadings`, the
 * guard a test pins to this schema; that module says what each reading
 * means). The one schema of the file (ADR 0059).
 */
import { z } from "zod";
import type { BakeFile } from "./bake-file";

const grade = z.int().min(0).max(3);

/** `[busy 0–3, dark 0–3, shop 0|1]`, 0 is "not seen" */
const facadeReading = z.tuple([grade, grade, z.int().min(0).max(1)]);

const facadeReadings = z.strictObject({
  attribution: z.string(),
  /** by the Building's gml:id */
  buildings: z.record(z.string(), facadeReading),
});

export type FacadeReading = z.infer<typeof facadeReading>;
export type FacadeReadings = z.infer<typeof facadeReadings>;

export const FACADES_FILE: BakeFile<typeof facadeReadings> = {
  file: "lib/city/facades-file.ts",
  schema: facadeReadings,
  step: "facades",
  writer: "pipeline/bake/facades.py",
};
