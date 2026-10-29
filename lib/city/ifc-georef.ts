/**
 * Where an IFC model stands (ADR 0054): the pure half of the IFC reader
 * (app/_components/design-ifc.ts). web-ifc hands the geometry over in a
 * design's frame — metres, Y up, −Z the model's own north — about the
 * model's engineering origin; this turns what the file says about that
 * origin into one matrix that puts the model in the Land's coordinates, so
 * the design's box lands in UTM and the placement reads it like any other
 * georeferenced design (design-placement.ts `detectGeoreference`).
 *
 * Two ways a file says it, the better first:
 *
 * - **IfcMapConversion** (IFC4): the origin's easting, northing and height
 *   in a projected CRS, the direction of the model's x axis in it, and a
 *   scale. A CRS of the other German UTM zone is carried over through
 *   lat/lng (crs.ts), its grid's turn with it; any other CRS (Gauß-Krüger,
 *   a local grid) is not read — the design is placed by hand.
 * - **IfcSite** RefLatitude/RefLongitude/RefElevation (IFC2x3 and later),
 *   turned by the context's TrueNorth: approximate by nature (a site's
 *   reference point is often only roughly where the model's origin is),
 *   and said so.
 *
 * No THREE, no DOM.
 */

import { gridConvergenceDeg, latLngToUtm, utmToLatLng } from "./crs";
import { DEG2RAD } from "./pose";

/** IfcMapConversion's values, plainly. */
export interface MapConversion {
  /** the target CRS's name as written (`EPSG:25833`) */
  crs: string | null;
  eastings: number;
  northings: number;
  height: number;
  /** the model's x axis in the map grid (need not be a unit vector) */
  abscissa: number | null;
  ordinate: number | null;
  scale: number | null;
  /** the map's unit (m): MapUnit's, else the project's length unit */
  unit: number;
}

/** IfcSite's reference point, as read. */
export interface SiteReference {
  /** degrees, minutes, seconds, millionths of a second (IfcCompoundPlaneAngleMeasure) */
  latitude: readonly number[];
  longitude: readonly number[];
  /** RefElevation in the model's length unit, or null */
  elevation: number | null;
  /** the model's length unit (m) */
  unit: number;
  /** TrueNorth: the direction of true north in the model's plan (x, y) */
  trueNorth: readonly [number, number] | null;
  /** where the site's own placement puts its reference point, in the
   *  design frame (m; x, y up, z south), or null at the model's origin */
  origin: readonly [number, number, number] | null;
}

/** What the file put the model at: a row-major 4×4 from the design frame
 *  (x, y up, z south about the model's origin) into the Land's (x east,
 *  y NHN, z −north), and a line for the panel. */
export interface IfcPlacement {
  matrix: number[];
  note: string;
}

/** A map scale this close to 1 is the projection's; one far off is a
 *  unit conversion the geometry already carries (web-ifc gives metres). */
const MAP_SCALE_MIN = 0.9;
const MAP_SCALE_MAX = 1.1;

const EPSG_NUMBER = /EPSG\s*(?::{1,2}|\/\d+\/|\s)\s*(\d{4,5})/i;
/** ETRS89/UTM by words: `ETRS89 / UTM zone 32N`, `ETRS_1989_UTM_Zone_33N` */
const ETRS_UTM = /ETRS.?(?:19)?89[\W_]*UTM[\W_]*(?:zone[\W_]*)?(3[23])/i;

/** The EPSG code a CRS name gives (`EPSG:25833`,
 *  `urn:ogc:def:crs:EPSG::25833`, `…/def/crs/EPSG/0/25833`, `ETRS89 /
 *  UTM zone 33N`), or null. */
export function epsgOfName(name: string | null): number | null {
  const m = name?.match(EPSG_NUMBER);
  if (m) {
    return Number(m[1]);
  }
  const utm = name?.match(ETRS_UTM);
  return utm ? 25_800 + Number(utm[1]) : null;
}

/** IfcCompoundPlaneAngleMeasure (deg, min, sec, millionths) in degrees;
 *  the sign is the first non-zero part's. */
export function compoundDegrees(parts: readonly number[]): number | null {
  if (parts.length < 2 || parts.some((p) => !Number.isFinite(p))) {
    return null;
  }
  const negative = parts.find((p) => p !== 0) ?? 0;
  const [d, m, s = 0, u = 0] = parts.map(Math.abs);
  const deg = d + m / 60 + s / 3600 + u / 3.6e9;
  return negative < 0 ? -deg : deg;
}

/** The SI prefix's factor of IfcSIUnit (MILLI → 0.001), 1 without one. */
export function siPrefixFactor(prefix: string | null | undefined): number {
  const table: Record<string, number> = {
    KILO: 1e3,
    HECTO: 1e2,
    DECA: 10,
    DECI: 0.1,
    CENTI: 0.01,
    MILLI: 0.001,
    MICRO: 1e-6,
  };
  return prefix ? (table[prefix.replace(/\./g, "").toUpperCase()] ?? 1) : 1;
}

/**
 * The row-major matrix that turns the design frame by a compass turn
 * `turn` (radians, clockwise seen from above: the model's x axis to grid
 * bearing 90° + turn), scales it in plan by `scale` and sets its origin at
 * (east, height, north).
 */
function placeMatrix(
  east: number,
  north: number,
  height: number,
  turn: number,
  scale: number
): number[] {
  const a = Math.cos(turn) * scale;
  const b = -Math.sin(turn) * scale;
  // grid east = e0 + a·x + b·z; grid north = n0 + b·x − a·z
  return [a, 0, b, east, 0, 1, 0, height, -b, 0, a, -north, 0, 0, 0, 1];
}

/** A zone-prefixed easting (33 412 300) without its zone. */
function plainEasting(east: number, zone: number): number {
  return east > 1e6 && Math.floor(east / 1e6) === zone
    ? east - zone * 1e6
    : east;
}

/** A point of one UTM zone in another, and the turn between their grids
 * there (radians, clockwise), or null. */
function carryOver(
  source: number,
  epsg: number,
  east: number,
  north: number
): { east: number; north: number; turn: number } | null {
  const ll = utmToLatLng(source, east, north);
  if (!ll) {
    return null;
  }
  const there = latLngToUtm(epsg, ll.lat, ll.lng);
  const from = gridConvergenceDeg(source, ll.lat, ll.lng);
  const to = gridConvergenceDeg(epsg, ll.lat, ll.lng);
  if (!there || from === null || to === null) {
    return null;
  }
  return { east: there.x, north: there.y, turn: (to - from) * DEG2RAD };
}

/**
 * The model's place from IfcMapConversion in the site's `epsg`, or why
 * not (a sentence for the panel).
 */
export function mapConversionPlacement(
  map: MapConversion,
  epsg: number
): IfcPlacement | { why: string } {
  // no name: the site's; a name that says nothing readable: not read
  const named = map.crs?.trim() ? epsgOfName(map.crs) : epsg;
  if (named === null) {
    return {
      why: `Die IFC ist in „${map.crs}“ verortet; city walk liest ETRS89/UTM. Bitte von Hand platzieren.`,
    };
  }
  const source = named;
  const zone = (code: number) =>
    code >= 25_828 && code <= 25_838 ? code - 25_800 : null;
  const sourceZone = zone(source);
  if (sourceZone === null || zone(epsg) === null) {
    return {
      why: `Die IFC ist in ${map.crs ?? "einem unbekannten System"} verortet; city walk liest ETRS89/UTM. Bitte von Hand platzieren.`,
    };
  }
  const length = Math.hypot(map.abscissa ?? 1, map.ordinate ?? 0) || 1;
  const a = (map.abscissa ?? 1) / length;
  const b = (map.ordinate ?? 0) / length;
  // the x axis at grid bearing 90° − atan2(b, a): a clockwise turn of −θ
  let turn = -Math.atan2(b, a);
  const s = map.scale ?? 1;
  const scale = s >= MAP_SCALE_MIN && s <= MAP_SCALE_MAX ? s : 1;
  let east = plainEasting(map.eastings * map.unit, sourceZone);
  let north = map.northings * map.unit;
  if (source !== epsg) {
    const there = carryOver(source, epsg, east, north);
    if (!there) {
      return { why: `EPSG:${source} lässt sich nicht umrechnen.` };
    }
    east = there.east;
    north = there.north;
    turn += there.turn;
  }
  return {
    matrix: placeMatrix(east, north, map.height * map.unit, turn, scale),
    note:
      source === epsg
        ? `Lage aus der IFC (IfcMapConversion, EPSG:${source}).`
        : `Lage aus der IFC (IfcMapConversion, EPSG:${source}, nach EPSG:${epsg} umgerechnet).`,
  };
}

/**
 * The row-major matrix that puts a model's origin at (`lat`, `lng`) and
 * `height` m in the site's `epsg`, turned so that `trueNorth` — true
 * north's direction in the model's plan (x, y), null: its +y — points
 * north; null where the projection does not take the point. Rhino's earth
 * anchor says the same (design-formats.ts).
 */
export function latLngPlacement(
  lat: number,
  lng: number,
  height: number,
  trueNorth: readonly [number, number] | null,
  epsg: number
): number[] | null {
  const at = latLngToUtm(epsg, lat, lng);
  const convergence = gridConvergenceDeg(epsg, lat, lng);
  if (!at || convergence === null) {
    return null;
  }
  // true north's bearing in the model's plan (clockwise from its +y)
  const [tx, ty] = trueNorth ?? [0, 1];
  const trueNorthInModel = Math.atan2(tx, ty);
  // a model bearing β is the true bearing β − that, the grid's + convergence
  const turn = convergence * DEG2RAD - trueNorthInModel;
  return placeMatrix(at.x, at.y, height, turn, 1);
}

/**
 * The model's place from IfcSite's reference point in the site's `epsg`,
 * or null where it gives none (a 0/0 the exporter wrote for "unset"
 * counts as none).
 */
export function siteReferencePlacement(
  site: SiteReference,
  epsg: number
): IfcPlacement | null {
  const lat = compoundDegrees(site.latitude);
  const lng = compoundDegrees(site.longitude);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) {
    return null;
  }
  const matrix = latLngPlacement(
    lat,
    lng,
    (site.elevation ?? 0) * site.unit,
    site.trueNorth,
    epsg
  );
  if (!matrix) {
    return null;
  }
  if (site.origin) {
    // the reference point is the site's, not the model's origin
    const [ox, oy, oz] = site.origin;
    for (const row of [0, 4, 8]) {
      matrix[row + 3] -=
        matrix[row] * ox + matrix[row + 1] * oy + matrix[row + 2] * oz;
    }
  }
  return {
    matrix,
    note: "Lage ungefähr aus dem IFC-Grundstück (IfcSite, Breite/Länge). Bitte prüfen und nachschieben.",
  };
}
