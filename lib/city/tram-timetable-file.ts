/**
 * `data/<site>/transit/trams.json`: the trams by timetable (GTFS, the
 * feed's licence). Written by pipeline/bake/transit.py `run_site` (site
 * step `transit`); published by scripts/prepare-data.ts, read by the
 * viewer through lib/city/tram-timetable.ts (its guard
 * app/_components/data-overlays.ts `isTramTimetable`). The one schema of
 * the file (ADR 0059).
 */
import { z } from "zod";
import { crsMember, point2 } from "./bake-file";
import type { BakeFile } from "./bake-file";
import type { TramDayKind } from "./tram-timetable";

/** lib/city/tram-timetable.ts `TramDayKind`; held equal by
 *  bake-files.test.ts. */
export const TRAM_DAY_KINDS = [
  "saturday",
  "sunday",
  "weekday",
] as const satisfies readonly TramDayKind[];

const index = z.int().nonnegative();

const tramPattern = z.strictObject({
  /** the distance along `coords` of each stop (m) */
  at: z.array(z.number()),
  /** [from, to] vertex ranges on a bridge deck */
  bridge: z.array(z.tuple([index, index])),
  /** the path (projected coordinates) */
  coords: z.array(point2),
  /** index into `routes` */
  route: index,
});

const tramDay = z.strictObject({
  /** the date the day's trips were read for (ISO) */
  date: z.iso.date(),
  /** [profile, start (seconds of the day)] */
  trips: z.array(z.tuple([index, z.int()])),
});

const tramTimetable = z.strictObject({
  /** the operators' names as the feed gives them (GTFS `agency_name`) */
  agencies: z.array(z.string()),
  attribution: z.string(),
  crs: crsMember,
  days: z.partialRecord(z.enum(TRAM_DAY_KINDS), tramDay),
  patterns: z.array(tramPattern),
  /** the running times of a pattern: arrival, departure per stop, seconds
   *  after the trip's start */
  profiles: z.array(z.strictObject({ pattern: index, t: z.array(z.number()) })),
  /** per line, the index into `agencies` of who runs it */
  routeAgency: z.array(index),
  routes: z.array(z.string()),
});

export type TramPattern = z.infer<typeof tramPattern>;
export type TramTimetableFile = z.infer<typeof tramTimetable>;

export const TRAMS_FILE: BakeFile<typeof tramTimetable> = {
  file: "lib/city/tram-timetable-file.ts",
  schema: tramTimetable,
  step: "transit",
  writer: "pipeline/bake/transit.py",
};
