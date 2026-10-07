/**
 * The live bicycle-counter feeds a site can name (`Site.dataLayers.bikes`),
 * each read by the browser (both services answer any origin) and turned
 * into the same counters (lib/city/bike-counts.ts `BikeCounter`):
 *
 * - `dresden`: the city's WFS (`cls:L1781`, Landeshauptstadt Dresden,
 *   dl-de/by-2-0) — one feature per counter, both directions' last hour.
 * - `hamburg`: the Urban Data Platform's SensorThings service (the
 *   "HaRaZäN" infrared counters, `HH_STA_Verkehrsdaten_Rad_
 *   Infrarotdetektoren`, Freie und Hansestadt Hamburg, dl-de/by-2-0) — one
 *   datastream per counting point and direction (`direction` 1 and 2, 0 the
 *   total), the hourly ones asked for with their newest observation, inside
 *   the site's box. A point is one arm of a junction (`knotenarm`); its
 *   directions are named by compass ("Nord nach Süd"), which gives the
 *   street's run.
 *
 * No THREE, no DOM.
 */
import {
  type BikeCounter,
  type BikeDirection,
  bikeCountsUrl,
  DRESDEN_ZONE,
  parseBikeCounts,
} from "./bike-counts";
import { latLngToUtm, utmToLatLng } from "./crs";
import type { BIKE_FEEDS } from "./site";

export type BikeFeedId = (typeof BIKE_FEEDS)[number];
type Bounds = readonly [number, number, number, number];

export interface BikeFeedReader {
  parse: (doc: unknown, bounds: Bounds, epsg: number) => BikeCounter[];
  url: (bounds: Bounds, epsg: number) => string;
  /** the time zone whose wall clock the feed's times are written in; none
   *  where they carry their own offset (ISO with `Z`) */
  zone?: string;
}

/** Hamburg's SensorThings service. */
export const HAMBURG_STA = "https://iot.hamburg.de/v1.1/Datastreams";

/** The site's box as a WGS84 polygon (lng lat), for an OData filter. */
function boxPolygon(bounds: Bounds, epsg: number): string | null {
  const [x0, y0, x1, y1] = bounds;
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ].map(([x, y]) => utmToLatLng(epsg, x, y));
  if (corners.some((c) => c === null)) {
    return null;
  }
  const ring = corners
    .map((c) => `${c?.lng.toFixed(6)} ${c?.lat.toFixed(6)}`)
    .join(", ");
  return `POLYGON((${ring}))`;
}

export function hamburgBikeUrl(bounds: Bounds, epsg: number): string {
  const polygon = boxPolygon(bounds, epsg) ?? "POLYGON((0 0, 0 0, 0 0, 0 0))";
  const params = new URLSearchParams({
    $filter: [
      "properties/serviceName eq 'HH_STA_Verkehrsdaten_Rad_Infrarotdetektoren'",
      "properties/aggregationDuration eq 'P1H'",
      `st_within(Thing/Locations/location, geography'${polygon}')`,
    ].join(" and "),
    $expand:
      "Thing($select=name,properties;$expand=Locations($select=location)),Observations($top=1;$orderby=phenomenonTime desc;$select=result,phenomenonTime)",
    $select: "name,properties",
    $top: "500",
  });
  return `${HAMBURG_STA}?${params.toString()}`;
}

/** Compass words → bearing (degrees clockwise from north). */
const COMPASS: Record<string, number> = {
  nord: 0,
  nordost: 45,
  ost: 90,
  südost: 135,
  süd: 180,
  südwest: 225,
  west: 270,
  nordwest: 315,
};

/** "Nord nach Süd" → "Süd" (where the direction goes); "" for "Keine
 *  Richtung" or anything else. */
export function compassToward(label: unknown): string {
  const m = /\bnach\s+(\S+)\s*$/iu.exec(typeof label === "string" ? label : "");
  return m && m[1].toLowerCase() in COMPASS ? m[1] : "";
}

/** A street's angle (degrees counter-clockwise from north) from the
 *  compass word its traffic runs toward. */
function angleOf(toward: string): number {
  const bearing = COMPASS[toward.toLowerCase()] ?? 0;
  return (360 - bearing) % 360;
}

interface StaStream {
  Observations?: { phenomenonTime?: unknown; result?: unknown }[];
  Thing?: {
    Locations?: { location?: { geometry?: { coordinates?: unknown } } }[];
    properties?: Record<string, unknown>;
  };
  properties?: Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The end of an observation's interval ("…/2026-10-01T10:59:59Z") as the
 *  hour it closes, or null. */
export function intervalEnd(raw: unknown): Date | null {
  const end = str(raw).split("/").at(-1) ?? "";
  const t = Date.parse(end);
  return Number.isNaN(t) ? null : new Date(Math.ceil(t / 60_000) * 60_000);
}

interface StaPoint {
  arm: string;
  asset: string;
  counts: Map<string, { count: number; toward: string }>;
  measuredAt: Date | null;
  x: number;
  y: number;
}

function pointOf(
  stream: StaStream,
  epsg: number
): { key: string; x: number; y: number } | null {
  const c = stream.Thing?.Locations?.[0]?.location?.geometry?.coordinates;
  if (
    !Array.isArray(c) ||
    typeof c[0] !== "number" ||
    typeof c[1] !== "number"
  ) {
    return null;
  }
  const at = latLngToUtm(epsg, c[1], c[0]);
  if (!at) {
    return null;
  }
  const p = stream.properties ?? {};
  return { key: `${str(p.assetID)}-${str(p.knotenarm)}`, ...at };
}

/** Hamburg's datastreams → one counter per counting point (an arm of a
 *  junction), its directions those with a compass name. */
export function parseHamburgBikes(
  doc: unknown,
  bounds: Bounds,
  epsg: number
): BikeCounter[] {
  const streams = (doc as { value?: unknown } | null)?.value;
  if (!Array.isArray(streams)) {
    return [];
  }
  const points = new Map<string, StaPoint>();
  // a null or a number in the list is left out, never thrown
  const objects = (streams as unknown[]).filter(
    (s): s is StaStream => typeof s === "object" && s !== null
  );
  for (const stream of objects) {
    const at = pointOf(stream, epsg);
    const obs = stream.Observations?.[0];
    if (!(at && obs) || typeof obs.result !== "number") {
      continue;
    }
    const p = stream.properties ?? {};
    const point = points.get(at.key) ?? {
      arm: str(p.knotenarm),
      asset: str(p.assetID),
      counts: new Map(),
      measuredAt: null,
      x: at.x,
      y: at.y,
    };
    const direction = str(p.direction);
    const toward = compassToward(stream.Thing?.properties?.richtung);
    if (direction === "0") {
      // the point's own position is its total's
      point.x = at.x;
      point.y = at.y;
    } else if (toward) {
      point.counts.set(direction, {
        count: Math.max(Math.round(obs.result), 0),
        toward,
      });
    }
    const when = intervalEnd(obs.phenomenonTime);
    if (when && (!point.measuredAt || when > point.measuredAt)) {
      point.measuredAt = when;
    }
    points.set(at.key, point);
  }
  const [minX, minY, maxX, maxY] = bounds;
  return [...points.values()]
    .flatMap((p): BikeCounter[] => {
      const directions: BikeDirection[] = [...p.counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, d]) => d);
      if (
        directions.length === 0 ||
        p.x < minX ||
        p.x >= maxX ||
        p.y < minY ||
        p.y >= maxY
      ) {
        return [];
      }
      return [
        {
          angleDeg: angleOf(directions[0].toward),
          directions,
          id: `${p.asset}-${p.arm}`,
          measuredAt: p.measuredAt,
          name: `Zählstelle ${p.asset}${p.arm ? ` · Arm ${p.arm}` : ""}`,
          where: directions.map((d) => `nach ${d.toward}`).join(", "),
          x: p.x,
          y: p.y,
        },
      ];
    })
    .sort((a, b) => a.x - b.x);
}

export const BIKE_FEED_READERS: Record<BikeFeedId, BikeFeedReader> = {
  dresden: {
    url: (_bounds, epsg) => bikeCountsUrl(epsg),
    parse: (doc, bounds) => parseBikeCounts(doc, bounds, DRESDEN_ZONE),
    zone: DRESDEN_ZONE,
  },
  hamburg: { url: hamburgBikeUrl, parse: parseHamburgBikes },
};
