/**
 * What the twin knows about one object of the city mesh, beyond how it is
 * drawn: its building's identity (the Building's CityGML `gml:id`, derived
 * from the ALKIS building — the key any other dataset joins on), its
 * official use and roof form (AdV codes), its measured
 * height, the date the surveyor produced it, and what OpenStreetMap adds
 * (name, address, storeys). The bake writes these as columns of the
 * building glTF's EXT_structural_metadata table next to the style columns
 * (`scripts/bake-tiles.ts`); the viewer reads them one object at a time,
 * only when someone asks (`app/_components/city-layer.ts`) — ADR 0040.
 * No THREE, no DOM.
 */
import type { OsmBuildingFacts } from "./city-mesh";

/** "Unknown" in a numeric fact column (the schema's `noData`). */
export const NO_FACT = -1;

/**
 * The `roofType` of an object whose LoD2 roof missed the surface model and
 * was rebuilt from it as stepped flat blocks (ADR 0036): not an AdV code —
 * the LoD2's form no longer describes what stands there.
 */
export const MEASURED_ROOF = "DOM1";

export interface ObjectFacts {
  /** OSM `addr:street` + `addr:housenumber` ("" unknown) */
  addr: string;
  /** footprint area of this object's GroundSurfaces (m²), NO_FACT if none */
  area: number;
  /** the survey's production date of the object, YYYY-MM-DD ("" unknown) */
  created: string;
  /** AdV Gebäudefunktion code, the root Building's for a part ("" none) */
  function: string;
  /**
   * The Building's CityGML `gml:id` (a part carries its Building's: Saxon
   * parts have random UUIDs no other dataset knows, and 41 incompressible
   * bytes each), or the scan structure's key; never "".
   */
  buildingId: string;
  /** measured height above the base (m), NO_FACT if unknown */
  height: number;
  /** OSM `building:levels`, NO_FACT if unmapped */
  levels: number;
  /** OSM `name` of the building ("" none) */
  name: string;
  /** roof pitch (degrees), NO_FACT if unknown */
  roofPitch: number;
  /** AdV Dachform code ("" unknown) */
  roofType: string;
}

/**
 * The fact columns by kind: free text, codes (a code list's values or a
 * handful of dates — ENUM columns, a UINT16 per object), numbers.
 */
export const FACT_STRING_COLUMNS = ["buildingId", "name", "addr"] as const;
export const FACT_ENUM_COLUMNS = ["function", "roofType", "created"] as const;
export const FACT_NUMBER_COLUMNS = [
  "height",
  "roofPitch",
  "area",
  "levels",
] as const;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const number = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : NO_FACT;
const positive = (v: unknown): number => (number(v) > 0 ? number(v) : NO_FACT);
const round = (v: number, to: number): number =>
  v === NO_FACT ? v : Math.round(v * to) / to;

/** An ISO timestamp's date ("2025-07-04T00:00:00Z" → "2025-07-04"). */
export function isoDate(v: unknown): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(text(v));
  return match ? match[0] : "";
}

/** Shoelace area (m²) of polygon rings, each counted positive. */
export function ringsArea(rings: readonly (readonly [number, number][])[]) {
  let total = 0;
  for (const ring of rings) {
    let twice = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % ring.length];
      twice += x0 * y1 - x1 * y0;
    }
    total += Math.abs(twice) / 2;
  }
  return total;
}

/**
 * Area (m²) covered by any of the rings — overlapping parts counted once.
 * Scanlines every `step` m (sampled at their middles): each ring's filled
 * spans on the line (even-odd), merged across rings. Exact along x; the
 * error across y is far below the survey's own (a 5 cm step on a 20 m
 * house is under 0.1 %).
 */
export function unionArea(
  rings: readonly (readonly [number, number][])[],
  step = 0.05
): number {
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const [, y] of ring) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  let area = 0;
  const spans: [number, number][] = [];
  const xs: number[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    spans.length = 0;
    for (const ring of rings) {
      xs.length = 0;
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % ring.length];
        if (ay > y !== by > y) {
          xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        spans.push([xs[i], xs[i + 1]]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    let end = Number.NEGATIVE_INFINITY;
    for (const [from, to] of spans) {
      if (to > end) {
        area += (to - Math.max(from, end)) * step;
        end = to;
      }
    }
  }
  return area;
}

/**
 * A Building's facts once its whole tree is known (the bake side): its
 * ground area is the union of every footprint in the tree — parts that
 * overlap or stand on one another count once — and, unless the survey
 * measured the Building itself (`surveyed`), its height runs from the
 * tree's lowest base to its highest top (a tower on a podium is the
 * tower's top above the podium's base, as `measuredHeight` is defined).
 */
export function treeFacts(
  root: ObjectFacts,
  tree: readonly {
    baseZ: number;
    footprints: readonly (readonly [number, number][])[];
    topZ: number;
  }[],
  surveyed: boolean
): ObjectFacts {
  if (tree.length === 0) {
    return root;
  }
  const rings = tree.flatMap((o) => o.footprints);
  const area = rings.length > 0 ? unionArea(rings) : 0;
  const base = Math.min(...tree.map((o) => o.baseZ));
  const top = Math.max(...tree.map((o) => o.topZ));
  return {
    ...root,
    area: area > 0 ? round(area, 10) : root.area,
    height: surveyed || !(top > base) ? root.height : round(top - base, 100),
  };
}

/**
 * The facts of one LoD2 object. `own` is its CityJSON attribute bag,
 * `resolved` the bag through its root Building (`inheritedAttributes`: a
 * part takes its use from the Building), `osm` what OSM adds for it or its
 * root, `fallbackHeight` the model's own top − base when the survey gives
 * no `measuredHeight`.
 */
export function lod2Facts(input: {
  /** the root Building's id (the object's own for a Building) */
  buildingId: string;
  fallbackHeight: number;
  footprints: readonly (readonly [number, number][])[];
  osm?: OsmBuildingFacts;
  own: Record<string, unknown>;
  /** its roof was rebuilt from DOM1 (ADR 0036): the LoD2's roof form,
   *  pitch and height no longer describe it; its height is the shape's */
  rebuilt?: boolean;
  resolved: Record<string, unknown>;
}): ObjectFacts {
  const { own, resolved, osm } = input;
  const measured = input.rebuilt ? NO_FACT : number(own.measuredHeight);
  const area = input.footprints.length > 0 ? ringsArea(input.footprints) : 0;
  return {
    buildingId: input.buildingId,
    function: text(resolved.function),
    roofType: input.rebuilt ? MEASURED_ROOF : text(own.roofType),
    created: isoDate(own.creationDate ?? resolved.creationDate),
    name: text(osm?.name),
    addr: text(osm?.addr),
    // 0 m is no height: a Building whose parts carry the geometry
    height: round(
      measured > 0 ? measured : positive(input.fallbackHeight),
      100
    ),
    roofPitch: input.rebuilt ? NO_FACT : round(number(own.Dachneigung), 10),
    area: area > 0 ? round(area, 10) : NO_FACT,
    levels: number(osm?.levels),
  };
}

/** The facts of a small structure the laser scan found (plan 034). */
export function scanFacts(input: {
  footprint: readonly [number, number][];
  height: number | undefined;
  id: string;
}): ObjectFacts {
  const area = ringsArea([input.footprint]);
  return {
    buildingId: input.id,
    function: "",
    roofType: "",
    created: "",
    name: "",
    addr: "",
    height: round(number(input.height), 100),
    roofPitch: NO_FACT,
    area: area > 0 ? round(area, 10) : NO_FACT,
    levels: NO_FACT,
  };
}

/** A part's OSM facts: its own, the root Building's where it has none. */
export function inheritedOsm(
  own?: OsmBuildingFacts,
  root?: OsmBuildingFacts
): OsmBuildingFacts | undefined {
  if (!(own || root)) {
    return undefined;
  }
  return { ...root, ...own };
}

type Columns<K extends string, V> = Record<K, V>;

/**
 * Rows → the table's fact columns (the bake side). Objects without facts
 * (none in a real bake) get their index as id, so the column never lies
 * about an identity it does not have.
 */
export function factColumns(facts: readonly (ObjectFacts | undefined)[]): {
  enums: Columns<(typeof FACT_ENUM_COLUMNS)[number], string[]>;
  numbers: Columns<(typeof FACT_NUMBER_COLUMNS)[number], Float32Array>;
  strings: Columns<(typeof FACT_STRING_COLUMNS)[number], string[]>;
} {
  const texts = <K extends keyof ObjectFacts>(names: readonly K[]) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        facts.map((f, i) =>
          f ? String(f[name]) : name === "buildingId" ? `#${i}` : ""
        ),
      ])
    ) as Columns<K, string[]>;
  const numbers = Object.fromEntries(
    FACT_NUMBER_COLUMNS.map((name) => [
      name,
      Float32Array.from(facts, (f) => (f ? f[name] : NO_FACT)),
    ])
  ) as Columns<(typeof FACT_NUMBER_COLUMNS)[number], Float32Array>;
  return {
    strings: texts(FACT_STRING_COLUMNS),
    enums: texts(FACT_ENUM_COLUMNS),
    numbers,
  };
}

/**
 * One object's facts from a table reader (the viewer side). `read` returns
 * a column's value for the object, or undefined when the tile predates the
 * column; the schema's default for `noData` is NO_FACT itself, and anything
 * but a non-negative finite number is unknown.
 */
export function readFacts(
  read: (column: string) => unknown,
  fallbackId: string
): ObjectFacts {
  const str = (name: string) => text(read(name));
  const num = (name: string) => number(read(name));
  return {
    buildingId: str("buildingId") || fallbackId,
    function: str("function"),
    roofType: str("roofType"),
    created: str("created"),
    name: str("name"),
    addr: str("addr"),
    height: num("height"),
    roofPitch: num("roofPitch"),
    area: num("area"),
    levels: num("levels"),
  };
}
