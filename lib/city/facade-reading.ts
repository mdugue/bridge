/**
 * What street photos say about a facade, abstracted to three coarse
 * readings per building (`data/<site>/dlm/facades_<tile>.json`, derived
 * from Mapillary's images, CC BY-SA 4.0, so a file of its own — never
 * baked into the LoD2/OSM tables). No window, pane or ornament is drawn
 * from them (the window-grid veto holds); they only tune what the clay
 * already paints:
 *  - busy: how much of the upper wall is not plain render (openings,
 *    frames, stucco, glass), graded 1 calm, 2 mid, 3 busy — busy only
 *    where two image sequences saw it;
 *  - dark: how much of it is clearly darker than the render, 1–3;
 *  - shop: a shop sign at the wall or an open ground floor (the clay
 *    joins it to OSM's shops, OBJECT_FLAG_SHOP, at its own strength).
 * 0 is "not seen" (two thirds of the street fronts, nearly every
 * courtyard). The readings ride in the object table's flags column, above
 * the OSM flags: `FACADE_UNIT` × (busy + 4 × dark + 16 × shop).
 */
import type { FacadeReading, FacadeReadings } from "./facades-file";

export type { FacadeReading, FacadeReadings } from "./facades-file";

const isGrade = (v: unknown, max: number): boolean =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Whether `v` is one row of the file: `[busy, dark, shop]`. */
function isReading(v: unknown): v is FacadeReading {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    isGrade(v[0], 3) &&
    isGrade(v[1], 3) &&
    isGrade(v[2], 1)
  );
}

/** The viewer's guard over what it fetches: the file as its schema
 *  (`facades-file.ts`, which the viewer takes by type only) describes it. */
export function isFacadeReadings(v: unknown): v is FacadeReadings {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const { attribution, buildings } = v as Record<string, unknown>;
  return (
    typeof attribution === "string" &&
    typeof buildings === "object" &&
    buildings !== null &&
    !Array.isArray(buildings) &&
    Object.values(buildings).every(isReading)
  );
}

/** The flags column's unit for the readings: the bits above the baked
 *  ones, OBJECT_FLAG_OWN_FACADE (512) the highest of them — the readings
 *  once started at 512 and wrote over it. With the readings' 31 at most
 *  the column still fits its 16 bits. */
export const FACADE_UNIT = 1024;

const grade = (v: number) => Math.max(0, Math.min(3, Math.round(v)));

/** A row's flags with `reading` on it (any earlier reading replaced). */
export function withFacadeReading(
  flags: number,
  reading: FacadeReading | undefined
): number {
  const own = flags % FACADE_UNIT;
  if (!reading) {
    return own;
  }
  const [busy, dark, shop] = reading;
  return (
    own + FACADE_UNIT * (grade(busy) + 4 * grade(dark) + (shop > 0 ? 16 : 0))
  );
}

/** The table's flags with each row's building's reading; `buildingOf`
 *  names a row's Building (its tree's root id). A row `aloft` stands high
 *  on its building (a dormer, a chimney): it has no ground floor, so the
 *  reading's shop is not its own — on a dormer it took the window, which
 *  sits in the dormer's only row. True when a row changed. */
export function applyFacadeReadings(
  flags: Uint16Array,
  buildingOf: (row: number) => string,
  readings: FacadeReadings,
  aloft: (row: number) => boolean = () => false
): boolean {
  let changed = false;
  for (let i = 0; i < flags.length; i += 1) {
    const reading: FacadeReading | undefined =
      readings.buildings[buildingOf(i)];
    const next = withFacadeReading(
      flags[i],
      reading && aloft(i) ? [reading[0], reading[1], 0] : reading
    );
    if (next !== flags[i]) {
      flags[i] = next;
      changed = true;
    }
  }
  return changed;
}
