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
 *  - shop: a shop sign at the wall or an open ground floor (joins OSM's
 *    shops, OBJECT_FLAG_SHOP).
 * 0 is "not seen" (two thirds of the street fronts, nearly every
 * courtyard). The readings ride in the object table's flags column, above
 * the OSM flags: `FACADE_UNIT` × (busy + 4 × dark).
 */
import { OBJECT_FLAG_SHOP } from "./city-mesh";

/** [busy 0–3, dark 0–3, shop 0|1], by the Building's gml:id. */
export type FacadeReading = [number, number, number];

export interface FacadeReadings {
  attribution: string;
  buildings: Record<string, FacadeReading | undefined>;
}

/** The flags column's unit for the readings (the bits above the OSM ones). */
export const FACADE_UNIT = 512;

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
  const shopBit =
    shop > 0 && Math.floor(own / OBJECT_FLAG_SHOP) % 2 === 0
      ? OBJECT_FLAG_SHOP
      : 0;
  return own + shopBit + FACADE_UNIT * (grade(busy) + 4 * grade(dark));
}

/** The table's flags with each row's building's reading; `buildingOf`
 *  names a row's Building (its tree's root id). True when a row changed. */
export function applyFacadeReadings(
  flags: Uint16Array,
  buildingOf: (row: number) => string,
  readings: FacadeReadings
): boolean {
  let changed = false;
  for (let i = 0; i < flags.length; i++) {
    const next = withFacadeReading(flags[i], readings.buildings[buildingOf(i)]);
    if (next !== flags[i]) {
      flags[i] = next;
      changed = true;
    }
  }
  return changed;
}
