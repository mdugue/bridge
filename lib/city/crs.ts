import proj4 from "proj4";

/**
 * CRS helpers for the Saxony open-data tiles. The CityJSON metadata declares
 * its CRS as an OGC URL like "http://www.opengis.net/def/crs/EPSG/6.12/25833".
 *
 * NOTE: the project brief assumed EPSG:25832, but Saxony publishes in
 * ETRS89 / UTM zone 33N (EPSG:25833) — both supported here, detected from
 * the metadata, never silently assumed.
 */

const UTM_DEFS: Record<number, string> = {
  25832: "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs",
  25833: "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs +type=crs",
};

/** Fallback when reprojection is impossible: Dresden city center. */
export const FALLBACK_LAT_LNG = { lat: 51.05, lng: 13.74 };

const TRAILING_NUMBER = /(\d+)\s*$/;

/** Extracts the numeric EPSG code from a CityJSON referenceSystem URL/URN. */
export function epsgCodeFromReferenceSystem(
  referenceSystem: string | undefined
): number | null {
  if (!referenceSystem) {
    return null;
  }
  const match = referenceSystem.match(TRAILING_NUMBER);
  return match ? Number(match[1]) : null;
}

/**
 * Reprojects projected UTM coordinates to WGS84 lat/lng (for SunCalc).
 * Returns null for unsupported EPSG codes — callers decide on a fallback.
 */
export function utmToLatLng(
  epsgCode: number,
  x: number,
  y: number
): { lat: number; lng: number } | null {
  const def = UTM_DEFS[epsgCode];
  if (!def) {
    return null;
  }
  const [lng, lat] = proj4(def, "WGS84", [x, y]);
  return { lat, lng };
}
