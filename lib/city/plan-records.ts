/**
 * A GIS plan's records as plan features (ADR 0054): Shapefile and
 * GeoPackage give shapes with attributes, and an office keeps its classes
 * in an attribute ("Nutzung", "Belag", "Art", "typ") or in the layer's
 * own name. The class is the first that one of the record's text values,
 * then the layer's name, speaks of (plan-classes.ts); a tree's crown and
 * height and a building's height come from attributes named so. No
 * THREE, no DOM.
 */

import { type PlanClass, planClassOf } from "./plan-classes";
import { nestRings, type PlanFeature } from "./plan-geometry";
import type { GeoRecord } from "./shapefile";

const CROWN = /^(krone|kronen|kd|kronendurchm|kronen_d|crown|crown_d|canopy)/i;
const HEIGHT =
  /^(h|hoehe|höhe|height|baumhoehe|baumhöhe|geb_h|gebhoehe|hoehe_m|height_m)$/i;
const STOREYS = /^(geschosse|geschoss|og|storeys|floors|levels)$/i;

/** The first attribute named like `pattern` with a positive number. */
function numberNamed(
  attributes: GeoRecord["attributes"],
  pattern: RegExp
): number | null {
  for (const [key, value] of Object.entries(attributes)) {
    const n =
      typeof value === "number" ? value : Number.parseFloat(value ?? "");
    if (pattern.test(key) && Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return null;
}

/** A record's class: its text values first, then the layer's name. */
export function recordClass(
  record: GeoRecord,
  layer: string
): PlanClass | null {
  const texts = Object.values(record.attributes).filter(
    (v): v is string => typeof v === "string"
  );
  return planClassOf([...texts, layer]);
}

/** The records of one layer as plan features. Lines are not drawn: in a
 *  plan they are edges, not surfaces. */
export function recordFeatures(
  records: readonly GeoRecord[],
  layer: string
): { features: PlanFeature[]; classes: Set<PlanClass | null> } {
  const features: PlanFeature[] = [];
  const classes = new Set<PlanClass | null>();
  for (const record of records) {
    const cls = recordClass(record, layer);
    classes.add(cls);
    if (record.kind === "point") {
      if (cls === "tree" || /baum|tree/i.test(layer)) {
        for (const [at] of record.parts) {
          features.push({
            kind: "tree",
            at,
            crown: numberNamed(record.attributes, CROWN),
            height: numberNamed(record.attributes, HEIGHT),
          });
        }
      }
    } else if (record.kind === "polygon" && cls !== "tree") {
      const storeys = numberNamed(record.attributes, STOREYS);
      const height =
        cls === "building"
          ? (numberNamed(record.attributes, HEIGHT) ??
            (storeys === null ? null : storeys * 3.2))
          : null;
      for (const rings of nestRings(record.parts)) {
        features.push({ kind: "area", cls, rings, height });
      }
    }
  }
  return { features, classes };
}
