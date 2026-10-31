/**
 * The Szenario-Assistent (ADR 0058): *Frag die Stadt*'s what-ifs, worked
 * out the same way on the server (the numbers the model gets) and in the
 * browser (what the scene shows). Two of them:
 *
 * - **Hochwasser**: a river's water surface at a reading of its city gauge
 *   — the gauges' zeros (WSV, PEGELONLINE) joined by straight lines along
 *   the river, raised by the reading. Every point of the ground below it is
 *   under water: no dyke, wall or mobile barrier is known, nor whether a
 *   hollow reaches the river at all, and the flood's own slope is the
 *   gauge zeros'.
 * - **Baukörper**: a planned box — footprint, height, turn — and the
 *   shadow it casts hour by hour on a day (suncalc, the sun as the scene
 *   draws it) over the buildings the Stadtwissen knows, by their centre
 *   point, on flat ground.
 *
 * Neither is an official result, and every answer says so (`SCENARIO_NOTE`).
 * Pure: no three.js, no DOM.
 */
import { getPosition } from "suncalc";
import { SITE_ZONE, zonedTime } from "./bike-counts";
import { gridConvergenceDeg, latLngToUtm, utmToLatLng } from "./crs";

/** Said with every scenario result, and by the model with every answer. */
export const SCENARIO_NOTE =
  "Modellrechnung des Stadtmodells, kein amtliches Ergebnis — für Planung und Gefahrenabwehr gelten die amtlichen Karten und Gutachten.";

// --- Hochwasser --------------------------------------------------------------

export interface Gauge {
  /** WGS84 */
  lat: number;
  lng: number;
  name: string;
  /** gauge zero, m above NHN */
  zero: number;
}

export interface FloodEvent {
  /** the tool's enum value */
  id: string;
  label: string;
  /** reading at the river's reference gauge, cm */
  cm: number;
  /** when the crest passed, as precise as the source says */
  when: string;
}

export interface River {
  name: string;
  /** downstream order; the reference gauge is the one readings refer to */
  gauges: readonly Gauge[];
  reference: string;
  /** a mean reading for "normal" (cm) */
  normalCm: number;
  events: readonly FloodEvent[];
  /** where the gauges and the events come from */
  sources: readonly string[];
}

/** The Elbe from Pirna to Meißen, read at the Dresden gauge. */
const ELBE: River = {
  name: "Elbe",
  // PEGELONLINE (WSV), gauge zeros valid from 2019-11-01 (Dresden)
  gauges: [
    { name: "Pirna", lat: 50.964_585, lng: 13.929_755, zero: 108.026 },
    { name: "Dresden", lat: 51.054_46, lng: 13.738_832, zero: 102.7 },
    { name: "Meißen", lat: 51.164_406, lng: 13.475_468, zero: 94.823 },
  ],
  reference: "Dresden",
  // the Landeshochwasserzentrum's "normal": about 150 cm
  normalCm: 150,
  events: [
    {
      id: "1845",
      label: "Winterhochwasser 1845",
      cm: 877,
      when: "1845-03-31",
    },
    { id: "1890", label: "Hochwasser 1890", cm: 837, when: "1890-09" },
    {
      id: "2002",
      label: "Augusthochwasser 2002",
      cm: 940,
      when: "2002-08-17",
    },
    {
      id: "2006",
      label: "Frühjahrshochwasser 2006",
      cm: 749,
      when: "2006-04-04",
    },
    { id: "2013", label: "Junihochwasser 2013", cm: 878, when: "2013-06-06" },
  ],
  sources: [
    "Pegel und Pegelnullpunkte: WSV, PEGELONLINE (https://www.pegelonline.wsv.de), DL-DE->Zero-2.0",
    "Scheitelwasserstände: Landeshauptstadt Dresden, Umweltatlas 4.45 (https://www.dresden.de/media/pdf/umwelt/ua_4_45_text.pdf); LfULG, Landeshochwasserzentrum",
  ],
};

/**
 * The rivers whose floods a site can show, by site id — kept here, not in
 * the site's config, so they change no bake's cache key: they feed only
 * *Frag die Stadt*. Meißen shares Dresden's Elbe and its readings.
 */
export const SITE_RIVERS: Readonly<Record<string, River>> = {
  dresden: ELBE,
  meissen: ELBE,
};

/** The lowest and highest reading a scenario takes (cm). */
export const FLOOD_CM = { min: 0, max: 1500 } as const;

export function riverOf(siteId: string): River | null {
  return SITE_RIVERS[siteId] ?? null;
}

/** An event's reading, or a reading in range; null for neither. */
export function floodReading(
  river: River,
  ask: { ereignis?: string; pegel_cm?: number }
): { cm: number; event: FloodEvent | null } | null {
  if (ask.ereignis !== undefined) {
    const event = river.events.find((e) => e.id === ask.ereignis);
    return event ? { cm: event.cm, event } : null;
  }
  if (ask.pegel_cm === undefined || !Number.isFinite(ask.pegel_cm)) {
    return null;
  }
  const cm = Math.min(Math.max(ask.pegel_cm, FLOOD_CM.min), FLOOD_CM.max);
  return { cm, event: null };
}

interface GaugePoint {
  x: number;
  y: number;
  zero: number;
}

/** A river's water surface at a reading: (x, y) in the CRS → m above NHN. */
export type FloodSurface = (x: number, y: number) => number;

/**
 * The water surface at `cm` on the reference gauge: along the line through
 * the gauges, each point at its place between the two nearest gauges'
 * zeros (projected onto their chord; beyond the last gauge, the last
 * stretch's slope runs on), plus the reading.
 */
export function floodSurface(
  river: River,
  epsg: number,
  cm: number
): FloodSurface {
  const points: GaugePoint[] = river.gauges.flatMap((g) => {
    const p = latLngToUtm(epsg, g.lat, g.lng);
    return p ? [{ ...p, zero: g.zero }] : [];
  });
  const rise = cm / 100;
  if (points.length === 0) {
    return () => Number.NEGATIVE_INFINITY;
  }
  if (points.length === 1) {
    return () => points[0].zero + rise;
  }
  return (x, y) => zeroAlong(points, x, y) + rise;
}

/** The gauge-zero line at the point nearest (x, y). */
function zeroAlong(
  points: readonly GaugePoint[],
  x: number,
  y: number
): number {
  let best = Number.POSITIVE_INFINITY;
  let zero = points[0].zero;
  const last = points.length - 2;
  for (let i = 0; i <= last; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const raw = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy);
    // the ends run on with their stretch's slope, the inner joins clamp
    const t = Math.min(Math.max(raw, i === 0 ? -1 : 0), i === last ? 2 : 1);
    const d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
    if (d < best) {
      best = d;
      zero = a.zero + t * (b.zero - a.zero);
    }
  }
  return zero;
}

/** A reading's water level at the reference gauge (m above NHN). */
export function levelAtReference(river: River, cm: number): number {
  const g = river.gauges.find((e) => e.name === river.reference);
  return (g?.zero ?? 0) + cm / 100;
}

/** What stands with its foot below the water, and how deep. */
export interface Wet {
  /** water above the ground at its foot (m) */
  depth: number;
}

/** Depth bands for a count of flooded buildings (m). */
export const DEPTH_BANDS = [0.5, 2] as const;

export function depthBands(depths: readonly number[]): {
  bis_0_5_m: number;
  von_0_5_bis_2_m: number;
  ueber_2_m: number;
} {
  let low = 0;
  let mid = 0;
  let high = 0;
  for (const d of depths) {
    if (d <= DEPTH_BANDS[0]) {
      low++;
    } else if (d <= DEPTH_BANDS[1]) {
      mid++;
    } else {
      high++;
    }
  }
  return { bis_0_5_m: low, von_0_5_bis_2_m: mid, ueber_2_m: high };
}

// --- Baukörper ---------------------------------------------------------------

/** A planned box, as the model places it. */
export interface PlannedVolume {
  /** centre, in the CRS (m) */
  x: number;
  y: number;
  /** along its own east axis before the turn (m) */
  breite: number;
  /** along its own north axis before the turn (m) */
  tiefe: number;
  /** above the ground (m) */
  hoehe: number;
  /** clockwise from grid north (degrees): 0 = breite runs east-west */
  drehung: number;
}

/** The limits a volume is held to (m): a house to a tower, not a city. */
export const VOLUME_LIMITS = { side: [2, 300], height: [2, 300] } as const;

export function clampVolume(v: PlannedVolume): PlannedVolume {
  const side = (s: number) =>
    Math.min(Math.max(s, VOLUME_LIMITS.side[0]), VOLUME_LIMITS.side[1]);
  return {
    x: v.x,
    y: v.y,
    breite: side(v.breite),
    tiefe: side(v.tiefe),
    hoehe: Math.min(
      Math.max(v.hoehe, VOLUME_LIMITS.height[0]),
      VOLUME_LIMITS.height[1]
    ),
    drehung: ((v.drehung % 360) + 360) % 360 || 0,
  };
}

export interface Point {
  x: number;
  y: number;
}

/** The footprint's corners, counter-clockwise, in the CRS. */
export function volumeCorners(v: PlannedVolume): Point[] {
  const t = (v.drehung * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const w = v.breite / 2;
  const d = v.tiefe / 2;
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ].map(([e, n]) => ({
    // clockwise by t: east turns towards south
    x: v.x + e * c + n * s,
    y: v.y - e * s + n * c,
  }));
}

/** Convex hull, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: readonly Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) {
    return p;
  }
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, q) <= 0) {
      lower.pop();
    }
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of p.toReversed()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, q) <= 0) {
      upper.pop();
    }
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether `q` lies inside the polygon (even-odd). */
export function insidePolygon(polygon: readonly Point[], q: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > q.y !== b.y > q.y &&
      q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Below this the sun casts no shadow worth naming (degrees). */
export const LOW_SUN_DEG = 3;

export interface ShadowAt {
  /** the shadow's outline on flat ground, with the footprint */
  hull: Point[];
  /** shadow length from the top edge (m) */
  length: number;
  /** grid bearing the shadow points to (degrees) */
  towards: number;
}

/**
 * The volume's shadow on flat ground for a sun at `altitude` above the
 * horizon and true `azimuth` (degrees, from north clockwise);
 * `convergence` turns true into grid bearings. Null below LOW_SUN_DEG.
 */
export function shadowOf(
  v: PlannedVolume,
  altitude: number,
  azimuth: number,
  convergence: number
): ShadowAt | null {
  if (altitude < LOW_SUN_DEG) {
    return null;
  }
  const length = v.hoehe / Math.tan((altitude * Math.PI) / 180);
  const towards = (azimuth + 180 + convergence + 360) % 360;
  const b = (towards * Math.PI) / 180;
  const dx = Math.sin(b) * length;
  const dy = Math.cos(b) * length;
  const corners = volumeCorners(v);
  const hull = convexHull([
    ...corners,
    ...corners.map((c) => ({ x: c.x + dx, y: c.y + dy })),
  ]);
  return { hull, length, towards };
}

/** Whether `YYYY-MM-DD` names a real day between 1900 and 2100. */
export function isCalendarDay(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 1900 &&
    y <= 2100 &&
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === m - 1 &&
    t.getUTCDate() === d
  );
}

/** The instant of a local hour (the site's zone) on a `YYYY-MM-DD` day. */
export function berlinInstant(day: string, hour: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  const minutes = Math.round(hour * 60);
  return zonedTime(
    [y, m, d, Math.floor(minutes / 60), minutes % 60, 0],
    SITE_ZONE
  );
}

/** A building the study can shade, by its centre. */
export interface Neighbour {
  name: string;
  x: number;
  y: number;
}

export interface ShadowHour {
  /** local time, "9:00" */
  zeit: string;
  sonnenhoehe: number;
  /** grid bearing of the shadow, degrees */
  schattenrichtung: number;
  schattenlaenge: number;
  /** the neighbours under the shadow at that hour */
  verschattet: string[];
}

/**
 * The volume's shadow every full hour of a day the sun is high enough,
 * and which neighbours it falls on (their centre inside the shadow's
 * outline, not inside the volume itself). Hours are Europe/Berlin.
 */
export function shadowStudy(
  v: PlannedVolume,
  day: string,
  epsg: number,
  neighbours: readonly Neighbour[]
): ShadowHour[] {
  const at = utmToLatLng(epsg, v.x, v.y);
  if (!at) {
    return [];
  }
  const convergence = gridConvergenceDeg(epsg, at.lat, at.lng) ?? 0;
  const footprint = volumeCorners(v);
  const hours: ShadowHour[] = [];
  for (let hour = 4; hour <= 21; hour++) {
    const sun = getPosition(berlinInstant(day, hour), at.lat, at.lng);
    const shadow = shadowOf(v, sun.altitude, sun.azimuth, convergence);
    if (!shadow) {
      continue;
    }
    hours.push({
      zeit: `${hour}:00`,
      sonnenhoehe: Math.round(sun.altitude),
      schattenrichtung: Math.round(shadow.towards),
      schattenlaenge: Math.round(shadow.length),
      // one name once: the parts of an ensemble share it
      verschattet: [
        ...new Set(
          neighbours
            .filter(
              (n) =>
                insidePolygon(shadow.hull, n) && !insidePolygon(footprint, n)
            )
            .map((n) => n.name)
        ),
      ],
    });
  }
  return hours;
}

/** For each neighbour shaded at all, the hours it lies in the shadow. */
export function shadedHours(
  hours: readonly ShadowHour[]
): { name: string; stunden: string[] }[] {
  const by = new Map<string, string[]>();
  for (const h of hours) {
    for (const name of h.verschattet) {
      by.set(name, [...(by.get(name) ?? []), h.zeit]);
    }
  }
  return [...by]
    .map(([name, stunden]) => ({ name, stunden }))
    .sort((a, b) => b.stunden.length - a.stunden.length);
}
