/**
 * A file a Python bake writes and TypeScript reads, and its one schema
 * (ADR 0059): the `lib/city/<name>-file.ts` modules each describe one such
 * file with a strict, transform-free zod schema, whose `z.infer` is the
 * file's type. The build reads the file through `parseBakeFile`, which
 * fails naming the file, the schema, its writer and the step that
 * re-bakes it; `bake-files.test.ts` parses every committed file.
 *
 * Imported by value only from `scripts/` and tests: the viewer takes the
 * types (`import type`), so zod stays out of its first load (ADR 0047).
 */
import { z } from "zod";

/** One handed-over file's schema and who answers for it. */
export interface BakeFile<S extends z.ZodType = z.ZodType> {
  /** the module that holds the schema, as the error names it */
  file: string;
  /** strict, and without `.transform`, `.default`, `.catch` or `.pipe`:
   *  what it accepts is what it returns */
  schema: S;
  /** the step that re-bakes it (`bun run bake <site> --step <step>`) */
  step: string;
  /** the Python module that writes it */
  writer: string;
}

/** How many of a file's problems the build's error lists. */
const SHOWN_PROBLEMS = 8;

/** A Wikidata item id (`Q…`). */
export const wikidataId = z.string().regex(/^Q\d+$/u);

/** The named-CRS member a projected GeoJSON or timetable carries
 *  (pipeline/bake/common.py `crs_member`). */
export const crsMember = z.strictObject({
  properties: z.strictObject({ name: z.string() }),
  type: z.literal("name"),
});

/** A projected point `[x, y]`. */
export const point2 = z.tuple([z.number(), z.number()]);

/** The GeoJSON geometries the bakes write, in the site's CRS. */
export const pointGeometry = z.strictObject({
  coordinates: point2,
  type: z.literal("Point"),
});
export const lineGeometry = z.strictObject({
  coordinates: z.array(point2),
  type: z.literal("LineString"),
});
export const multiLineGeometry = z.strictObject({
  coordinates: z.array(z.array(point2)),
  type: z.literal("MultiLineString"),
});
export const polygonGeometry = z.strictObject({
  coordinates: z.array(z.array(point2)),
  type: z.literal("Polygon"),
});
export const multiPolygonGeometry = z.strictObject({
  coordinates: z.array(z.array(z.array(point2))),
  type: z.literal("MultiPolygon"),
});

/** A GeoJSON feature (pipeline/bake/common.py `feature`). */
export function featureOf<G extends z.ZodType, P extends z.ZodType>(
  geometry: G,
  properties: P
) {
  return z.strictObject({
    geometry,
    properties,
    type: z.literal("Feature"),
  });
}

/** A projected, credited GeoJSON file of `feature`s. */
export function featureCollection<F extends z.ZodType>(feature: F) {
  return z.strictObject({
    attribution: z.string(),
    crs: crsMember,
    features: z.array(feature),
    type: z.literal("FeatureCollection"),
  });
}

/** What is wrong with `json` as the file `spec` describes, one entry per
 *  problem (a message and its key path); none when it matches. */
export function bakeFileProblems(spec: BakeFile, json: unknown): string[] {
  const result = spec.schema.safeParse(json);
  return result.success
    ? []
    : result.error.issues.map((issue) =>
        z.prettifyError(new z.ZodError([issue]))
      );
}

/** The site a committed file's path names (`data/<site>/…`). */
function siteOf(where: string): string {
  return (
    /(?:^|\/)data\/(?<site>[^/]+)\//u.exec(where)?.groups?.site ?? "<site>"
  );
}

/**
 * `json` as the file `spec` describes, or an `Error` naming the file
 * (`where`), the schema, its writer, the first problems and the re-bake.
 * Returns its input, never zod's copy: a parse reorders an object's keys
 * by the schema, and baked bytes follow the file's order.
 */
export function parseBakeFile<S extends z.ZodType>(
  spec: BakeFile<S>,
  json: unknown,
  where: string
): z.infer<S> {
  const problems = bakeFileProblems(spec, json);
  if (problems.length === 0) {
    // reason: validated, and the input keeps its key order
    return json as z.infer<S>;
  }
  const more = problems.length - SHOWN_PROBLEMS;
  throw new Error(
    [
      `${where} does not match ${spec.file} (written by ${spec.writer}):`,
      ...problems.slice(0, SHOWN_PROBLEMS),
      ...(more > 0 ? [`… and ${more} more`] : []),
      `Re-bake it (bun run bake ${siteOf(where)} --step ${spec.step}) or change the schema with the bake, in one commit.`,
    ].join("\n")
  );
}
