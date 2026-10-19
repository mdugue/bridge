/**
 * CRS helpers for the Saxony open-data tiles. The CityJSON metadata declares
 * its CRS as an OGC URL like "http://www.opengis.net/def/crs/EPSG/6.12/25833".
 *
 * NOTE: the project brief assumed EPSG:25832, but Saxony publishes in
 * ETRS89 / UTM zone 33N (EPSG:25833) — both supported here, detected from
 * the metadata, never silently assumed.
 *
 * The projection is the transverse Mercator in Krüger's series to the sixth
 * order in n (Karney 2011, "Transverse Mercator with an accuracy of a few
 * nanometers" — what PROJ's and proj4's `etmerc` compute) on the GRS80
 * ellipsoid. A WGS84 fix is taken as ETRS89, as proj4 took it with these
 * definitions: no datum shift.
 */

/** UTM zone by EPSG code (ETRS89 / UTM zone N, northern hemisphere). */
const UTM_ZONES: Partial<Record<number, number>> = { 25832: 32, 25833: 33 };

export const SUPPORTED_EPSG_CODES = Object.keys(UTM_ZONES).map(Number);

const TRAILING_NUMBER = /(\d+)\s*$/;

const DEG = Math.PI / 180;

// GRS80
const A = 6_378_137;
const F = 1 / 298.257_222_101;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
/** the third flattening, the series' small parameter */
const N = F / (2 - F);

/** UTM's scale on the central meridian and its false easting */
const K0 = 0.9996;
const FALSE_EASTING = 500_000;

/** k0 × the rectifying radius: metres per radian of the series' ξ, η */
const K0_A =
  ((K0 * A) / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64 + N ** 6 / 256);

/** n^power × (c₀ + c₁ n + c₂ n² + …): one coefficient of Krüger's series */
const inN = (power: number, c: readonly number[]): number =>
  c.reduceRight((sum, ci) => sum * N + ci, 0) * N ** power;

/** Krüger's α (conformal → projected), Karney 2011 eq. 35 */
const ALPHA = [
  inN(1, [1 / 2, -2 / 3, 5 / 16, 41 / 180, -127 / 288, 7891 / 37_800]),
  inN(2, [13 / 48, -3 / 5, 557 / 1440, 281 / 630, -1_983_433 / 1_935_360]),
  inN(3, [61 / 240, -103 / 140, 15_061 / 26_880, 167_603 / 181_440]),
  inN(4, [49_561 / 161_280, -179 / 168, 6_601_661 / 7_257_600]),
  inN(5, [34_729 / 80_640, -3_418_889 / 1_995_840]),
  inN(6, [212_378_941 / 319_334_400]),
];

/** Krüger's β (projected → conformal), Karney 2011 eq. 36 */
const BETA = [
  inN(1, [1 / 2, -2 / 3, 37 / 96, -1 / 360, -81 / 512, 96_199 / 604_800]),
  inN(2, [1 / 48, 1 / 15, -437 / 1440, 46 / 105, -1_118_711 / 3_870_720]),
  inN(3, [17 / 480, -37 / 840, -209 / 4480, 5569 / 90_720]),
  inN(4, [4397 / 161_280, -11 / 504, -830_251 / 7_257_600]),
  inN(5, [4583 / 161_280, -108_847 / 3_991_680]),
  inN(6, [20_648_693 / 638_668_800]),
];

/** A zone's central meridian (degrees). */
const centralMeridian = (zone: number): number => zone * 6 - 183;

/** tan of the conformal latitude, from tan of the geodetic (Karney eq. 7) */
function conformalTan(tau: number): number {
  const sigma = Math.sinh(E * Math.atanh((E * tau) / Math.hypot(1, tau)));
  return tau * Math.hypot(1, sigma) - sigma * Math.hypot(1, tau);
}

/** tan of the geodetic latitude, from tan of the conformal: Newton's
 *  method on conformalTan (Karney eqs. 19–21; two steps reach double
 *  precision at these latitudes) */
function geodeticTan(taup: number): number {
  let tau = taup / (1 - E2);
  for (let i = 0; i < 5; i++) {
    const taui = conformalTan(tau);
    const step =
      ((taup - taui) / Math.hypot(1, taui)) *
      ((1 + (1 - E2) * tau * tau) / ((1 - E2) * Math.hypot(1, tau)));
    tau += step;
    if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(tau))) {
      break;
    }
  }
  return tau;
}

/** A point's projected coordinates and the grid convergence there (the
 *  angle from true north to grid north, clockwise; radians). */
function forward(
  zone: number,
  lat: number,
  lng: number
): { gamma: number; x: number; y: number } {
  const lambda = (lng - centralMeridian(zone)) * DEG;
  const taup = conformalTan(Math.tan(lat * DEG));
  const xip = Math.atan2(taup, Math.cos(lambda));
  const etap = Math.asinh(
    Math.sin(lambda) / Math.hypot(taup, Math.cos(lambda))
  );
  let xi = xip;
  let eta = etap;
  // the series' derivative, for the convergence (Karney eqs. 13–15)
  let p = 1;
  let q = 0;
  ALPHA.forEach((alpha, j) => {
    const k = 2 * (j + 1);
    const [s, c] = [Math.sin(k * xip), Math.cos(k * xip)];
    const [sh, ch] = [Math.sinh(k * etap), Math.cosh(k * etap)];
    xi += alpha * s * ch;
    eta += alpha * c * sh;
    p += k * alpha * c * ch;
    q += k * alpha * s * sh;
  });
  const gamma =
    Math.atan((taup / Math.hypot(1, taup)) * Math.tan(lambda)) +
    Math.atan2(q, p);
  return { gamma, x: FALSE_EASTING + K0_A * eta, y: K0_A * xi };
}

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
  const zone = UTM_ZONES[epsgCode];
  if (zone === undefined) {
    return null;
  }
  const xi = y / K0_A;
  const eta = (x - FALSE_EASTING) / K0_A;
  let xip = xi;
  let etap = eta;
  BETA.forEach((beta, j) => {
    const k = 2 * (j + 1);
    xip -= beta * Math.sin(k * xi) * Math.cosh(k * eta);
    etap -= beta * Math.cos(k * xi) * Math.sinh(k * eta);
  });
  const taup = Math.sin(xip) / Math.hypot(Math.sinh(etap), Math.cos(xip));
  const lambda = Math.atan2(Math.sinh(etap), Math.cos(xip));
  return {
    lat: Math.atan(geodeticTan(taup)) / DEG,
    lng: lambda / DEG + centralMeridian(zone),
  };
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
  const zone = UTM_ZONES[epsgCode];
  if (zone === undefined) {
    return null;
  }
  const { x, y } = forward(zone, lat, lng);
  return { x, y };
}

/**
 * Meridian convergence at a point (degrees): how far true north lies
 * clockwise of grid north (+Y). A compass bearing is measured from true
 * north, the scene's headings from grid north, so
 * `gridBearing = trueBearing + convergence`. About +1° in Dresden, which sits
 * west of zone 33's central meridian (15° E), where the meridians lean east
 * as they run north. From Krüger's series (Karney 2011, eqs. 13–15); the
 * tests hold its sign and size to a step north along the meridian,
 * projected. Null for unsupported codes.
 */
export function gridConvergenceDeg(
  epsgCode: number,
  lat: number,
  lng: number
): number | null {
  const zone = UTM_ZONES[epsgCode];
  if (zone === undefined) {
    return null;
  }
  return -forward(zone, lat, lng).gamma / DEG;
}
