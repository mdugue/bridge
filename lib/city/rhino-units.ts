/**
 * A Rhino .3dm's units and place (design-formats.ts, ADR 0054): its model
 * unit (openNURBS `ON::LengthUnitSystem`) in metres — unknown, none and
 * custom units are taken as metres — and the matrix its earth anchor
 * gives. No THREE, no DOM.
 */

import { latLngPlacement } from "./ifc-georef";

const METRES: Readonly<Record<number, number>> = {
  1: 1e-6, // microns
  2: 1e-3, // millimetres
  3: 1e-2, // centimetres
  4: 1, // metres
  5: 1e3, // kilometres
  6: 2.54e-8, // microinches
  7: 2.54e-5, // mils
  8: 0.0254, // inches
  9: 0.3048, // feet
  10: 1609.344, // miles
  12: 1e-10, // ångströms
  13: 1e-9, // nanometres
  14: 0.1, // decimetres
  15: 10, // dekametres
  16: 100, // hectometres
  17: 1e6, // megametres
  18: 1e9, // gigametres
  19: 0.9144, // yards
  20: 3.527_777_8e-4, // printer's points (1/72 in)
  21: 4.233_333e-3, // printer's picas
  22: 1852, // nautical miles
  23: 1.495_978_707e11, // astronomical units
  24: 9.460_730_472_580_8e15, // light years
  25: 3.085_677_581_49e16, // parsecs
};

/** The unit's length in metres (1 where unknown). */
export function rhinoUnitMetres(unit: number | null): number {
  return unit === null ? 1 : (METRES[unit] ?? 1);
}

/** A .3dm's earth anchor, as its settings say it. */
export interface RhinoAnchor {
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  /** `BasepointZero`: 0 ground level, 1 mean sea level, 2 earth's
   *  centre; null where unread (rhino3dm 8.32's binding returns none) */
  elevationZero: number | null;
  /** the model point the anchor names (model units, Z up) */
  base: readonly [number, number, number] | null;
  /** north in the model's plan */
  north: readonly [number, number] | null;
}

const GROUND_LEVEL = 0;
const EARTH_CENTRE = 2;

/** Row-major 4×4 product a·b. */
function times(a: readonly number[], b: readonly number[]): number[] {
  const out = Array.from({ length: 16 }, () => 0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      for (let k = 0; k < 4; k++) {
        out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
      }
    }
  }
  return out;
}

/** The row-major matrix that turns a model (Z up, in `unit` m) into the
 *  design frame: metres, Y up, its north (+y) to −z. */
export function rhinoFrame(unit: number): number[] {
  return [unit, 0, 0, 0, 0, 0, unit, 0, 0, -unit, 0, 0, 0, 0, 0, 1];
}

/** Whether a latitude/longitude pair is a place: openNURBS writes
 *  ON_UNSET_VALUE (−1.23e308) for an anchor never set, and some
 *  exporters 0/0. */
function isPlace(lat: number | null, lng: number | null): boolean {
  return (
    lat !== null &&
    lng !== null &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * The row-major matrix that puts a model in `unit` m at its earth anchor
 * in the site's `epsg` — its base point at the anchor's latitude and
 * longitude, turned to its north — or null where the anchor is unset.
 * `heightsKnown`: the elevation is taken as NHN — above mean sea level,
 * or unsaid, where the placement still trusts it only as far as the
 * ground agrees (design-placement.ts `trustedBase`); one above the
 * ground or the earth's centre is not, and the design is set on the
 * ground.
 */
export function rhinoPlacement(
  anchor: RhinoAnchor,
  unit: number,
  epsg: number
): { matrix: number[]; heightsKnown: boolean } | null {
  if (!isPlace(anchor.latitude, anchor.longitude)) {
    return null;
  }
  const heightsKnown =
    anchor.elevationZero !== GROUND_LEVEL &&
    anchor.elevationZero !== EARTH_CENTRE;
  const place = latLngPlacement(
    anchor.latitude ?? 0,
    anchor.longitude ?? 0,
    heightsKnown ? (anchor.elevation ?? 0) : 0,
    anchor.north,
    epsg
  );
  if (!place) {
    return null;
  }
  const [bx, by, bz] = anchor.base ?? [0, 0, 0];
  // the base point to the origin, in the design frame
  const toBase = [
    1,
    0,
    0,
    -bx * unit,
    0,
    1,
    0,
    -bz * unit,
    0,
    0,
    1,
    by * unit,
    0,
    0,
    0,
    1,
  ];
  return {
    matrix: times(times(place, toBase), rhinoFrame(unit)),
    heightsKnown,
  };
}
