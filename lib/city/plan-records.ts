/**
 * A GIS plan's records as plan features (ADR 0054): Shapefile and
 * GeoPackage give shapes with attributes, and an office keeps its classes
 * in an attribute ("Nutzung", "Belag", "Art", "typ") or in the layer's
 * own name. The class is the first that the record's class-like values,
 * its other values, the layer's name, then its names, speak of
 * (plan-classes.ts, `recordClass`); a tree's crown and
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

/** Attributes that say what a surface is, and those that name a place. */
const CLASS_KEY =
  /^(nutzung|nutzungsart|art|typ|type|klasse|class|kategorie|category|belag|oberfl|surface|material|objektart|funktion|landuse|kind|layer|ebene)/i;
const NAME_KEY =
  /^(name|bez|bezeichnung|ort|lage|standort|adress|address|str|stra(ß|ss)e|street|antrag|url|link|bemerkung|comment|notiz)/i;

/**
 * A record's class: what its class-like attributes say ("Nutzung",
 * "Belag", "Art"), then its other text values, then the layer's name,
 * and only then its names and addresses — a city's "Alaunplatz" or
 * "Kamenzer Straße" is where the lawn lies, not what it is. A link is
 * never read.
 */
export function recordClass(
  record: GeoRecord,
  layer: string
): PlanClass | null {
  const classLike: string[] = [];
  const other: string[] = [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(record.attributes)) {
    if (typeof value !== "string" || /^[a-z]+:\/\//i.test(value)) {
      continue;
    }
    if (CLASS_KEY.test(key)) {
      classLike.push(value);
    } else if (NAME_KEY.test(key)) {
      names.push(value);
    } else {
      other.push(value);
    }
  }
  return planClassOf([...classLike, ...other, layer, ...names]);
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
