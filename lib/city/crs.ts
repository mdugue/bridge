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

export const SUPPORTED_EPSG_CODES = Object.keys(UTM_DEFS).map(Number);

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

/**
 * Projects WGS84 lat/lng into the site's UTM CRS — where a GPS fix lands on
 * the map. Returns null for unsupported EPSG codes.
 */
export function latLngToUtm(
  epsgCode: number,
  lat: number,
  lng: number
): { x: number; y: number } | null {
  const def = UTM_DEFS[epsgCode];
  if (!def) {
    return null;
  }
  const [x, y] = proj4("WGS84", def, [lng, lat]);
  return { x, y };
}

/**
 * Meridian convergence at a point (degrees): how far true north lies
 * clockwise of grid north (+Y). A compass bearing is measured from true
 * north, the scene's headings from grid north, so
 * `gridBearing = trueBearing + convergence`. About +1° in Dresden, which sits
 * west of zone 33's central meridian (15° E), where the meridians lean east
 * as they run north. Measured numerically — a step north
 * along the meridian, projected — rather than by formula, so the sign cannot
 * be got wrong. Null for unsupported codes.
 */
export function gridConvergenceDeg(
  epsgCode: number,
  lat: number,
  lng: number
): number | null {
  const here = latLngToUtm(epsgCode, lat, lng);
  const north = latLngToUtm(epsgCode, lat + 1e-3, lng);
  if (!(here && north)) {
    return null;
  }
  return (Math.atan2(north.x - here.x, north.y - here.y) * 180) / Math.PI;
}
