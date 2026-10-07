/**
 * The city's permanent bicycle counters (Rad-Dauerzählstellen, the WFS's
 * `cls:L1781` "aktuelle Zählwerte"; Landeshauptstadt Dresden, dl-de/by-2-0),
 * read live by the browser — the service answers any origin — and drawn as
 * a pair of columns per counter (app/_components/bike-layer.ts). The pure
 * half: the request, the parse, the column heights. No THREE, no DOM.
 *
 * The answer carries, per counter, the bicycles of the last full hour in
 * each of its two directions (`w1`/`w2`, named by `r1`/`r2`), the hour
 * they were counted in (`messzeit`, the city's wall clock: Europe/Berlin), and `winkel`, the angle of
 * the street at the counter (degrees counter-clockwise from north: the
 * Albertbrücke's 25° is its run NNW to the Neustadt, the Antonstraße's 120°
 * its run WSW to the Marienbrücke).
 */

/** The city's WFS (the same service the tree cadastre and the traffic
 *  counts come from: pipeline/bake/ingest_sn.py). */
export const CITY_WFS = "https://kommisdd.dresden.de/net3/public/ogcsl.ashx";
/** How often the counts are read again while the layer is on (ms): the
 *  counters report once an hour, a few minutes after it. */
export const BIKE_POLL_MS = 5 * 60 * 1000;
/** A count older than this (ms) is shown as stale: the counter is down. */
export const BIKE_STALE_MS = 3 * 60 * 60 * 1000;

/** The two directions' colours (the columns, and the HUD's list that
 *  names them), and a stale counter's. */
export const BIKE_DIRECTION_TINTS = [0x4f_b0_ae, 0x9d_8b_d6] as const;
export const BIKE_STALE_TINT = 0xb9_b5_ae;

/** A tint as CSS. */
export const tintCss = (tint: number): string =>
  `#${tint.toString(16).padStart(6, "0")}`;

/** The live counts, in the site's CRS. */
export function bikeCountsUrl(epsg: number): string {
  const params = new URLSearchParams({
    NODEID: "0",
    Service: "WFS",
    Version: "2.0.0",
    Request: "GetFeature",
    TypeNames: "cls:L1781",
    outputFormat: "application/geo+json",
    srsName: `urn:ogc:def:crs:EPSG::${epsg}`,
  });
  return `${CITY_WFS}?${params.toString()}`;
}

export interface BikeDirection {
  /** bicycles in the last counted hour */
  count: number;
  /** where this direction goes ("Neustadt"), without the "Richtung" */
  toward: string;
}

export interface BikeCounter {
  /** the street's angle at the counter, degrees counter-clockwise from north */
  angleDeg: number;
  /** one or two directions (a counter on a one-way path has one) */
  directions: BikeDirection[];
  id: string;
  /** the hour counted (an instant), or null when the answer has none */
  measuredAt: Date | null;
  /** the counter's name ("Albertbrücke") */
  name: string;
  /** where on its street ("in Höhe Rosa-Luxemburg-Platz") */
  where: string;
  x: number;
  y: number;
}

interface RawCounter {
  geometry?: { coordinates?: unknown; type?: string } | null;
  properties?: Record<string, unknown> | null;
}

/** A property as text: a string as it is, a number written out, anything
 *  else "". */
function text(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" ? String(value) : "";
}

/** Every site's wall clock (all of them are German): a count's time is
 *  read and shown in it, never in the visitor's zone. */
export const SITE_ZONE = "Europe/Berlin";

/** Where the city's feed tells its time: Dresden's `messzeit` is the
 *  city's wall clock, never the visitor's. */
export const DRESDEN_ZONE = SITE_ZONE;

const countClockFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: SITE_ZONE,
});

/** "07:00" — a count's time on the city's wall clock, wherever the
 *  visitor is. */
export function countClock(at: Date): string {
  return countClockFormat.format(at);
}

/** The wall clock of `zone` at an instant, as if it were UTC (ms). */
function wallClockAt(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // "24" is midnight in some engines' hour12: false
  return Date.UTC(
    n("year"),
    n("month") - 1,
    n("day"),
    n("hour") % 24,
    n("minute"),
    n("second")
  );
}

/**
 * The instant a wall-clock time in `zone` names. The wall clock read as
 * UTC is a first guess; the zone's offset at that guess corrects it once,
 * and the offset at the corrected instant a second time — that covers a
 * guess on the other side of a daylight-saving switch from the answer.
 */
export function zonedTime(
  parts: readonly [number, number, number, number, number, number],
  zone: string
): Date {
  const [y, mo, d, h, mi, s] = parts;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - (wallClockAt(guess, zone) - guess);
  return new Date(guess - (wallClockAt(first, zone) - first));
}

/** "01.10.2026 07:00:00" (the wall clock of `zone`) → Date, or null. */
export function parseCountTime(
  raw: unknown,
  zone: string = DRESDEN_ZONE
): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(
    text(raw).trim()
  );
  if (!m) {
    return null;
  }
  const [, d, mo, y, h, mi, s] = m;
  return zonedTime(
    [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0)],
    zone
  );
}

/** "Richtung Nord - Neustadt" → "Nord - Neustadt"; "" for a direction
 *  the counter does not have ("Richtung ", "Richtung -"). */
export function towardOf(label: unknown): string {
  return text(label)
    .replace(/^\s*Richtung\b/u, "")
    .replace(/^[\s-]+|[\s-]+$/gu, "")
    .trim();
}

/** A counter's name as the city writes it, its "_1" twin suffix (a second
 *  counter at the same place: the other path of the bridge) as " 2". */
function nameOf(raw: unknown): string {
  return text(raw)
    .trim()
    .replace(/_(\d+)$/u, (_, n: string) => ` ${Number(n) + 1}`);
}

function counterOf(f: RawCounter, zone: string): BikeCounter | null {
  const p = f.properties ?? {};
  const c = f.geometry?.coordinates;
  if (
    f.geometry?.type !== "Point" ||
    !Array.isArray(c) ||
    typeof c[0] !== "number" ||
    typeof c[1] !== "number" ||
    p.inaktiv === "1"
  ) {
    return null;
  }
  const directions: BikeDirection[] = [];
  for (const [r, w] of [
    ["r1", "w1"],
    ["r2", "w2"],
  ] as const) {
    const toward = towardOf(p[r]);
    const count = p[w];
    if (toward && typeof count === "number" && count >= 0) {
      directions.push({ toward, count: Math.round(count) });
    }
  }
  if (directions.length === 0) {
    return null;
  }
  return {
    angleDeg: typeof p.winkel === "number" ? p.winkel : 0,
    directions,
    id: text(p.fremd_id) || `${c[0]},${c[1]}`,
    measuredAt: parseCountTime(p.messzeit, zone),
    name: nameOf(p.bezeichnung),
    where: text(p.lage).trim(),
    x: c[0],
    y: c[1],
  };
}

/** The counters of a WFS answer that stand inside `bounds` (the site),
 *  west to east, their times read in `zone`. Anything malformed is left
 *  out, never thrown. */
export function parseBikeCounts(
  doc: unknown,
  bounds: readonly [number, number, number, number],
  zone: string = DRESDEN_ZONE
): BikeCounter[] {
  const features = (doc as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) {
    return [];
  }
  const [minX, minY, maxX, maxY] = bounds;
  return (features as unknown[])
    .filter((f): f is RawCounter => typeof f === "object" && f !== null)
    .map((f) => counterOf(f, zone))
    .filter(
      (c): c is BikeCounter =>
        c !== null && c.x >= minX && c.x < maxX && c.y >= minY && c.y < maxY
    )
    .sort((a, b) => a.x - b.x);
}

/** A column's height (m) for a count: the square root, so a counter with
 *  480 bicycles an hour (the Albertbrücke at rush hour) stands ~36 m and
 *  one with 20 still reads, while 0 leaves a stub. */
export function bikeColumnHeight(count: number): number {
  return 1.5 + 1.6 * Math.sqrt(Math.max(count, 0));
}

/** Whether a count is too old to stand for the last hour. */
export function isStale(counter: BikeCounter, now: Date): boolean {
  return (
    counter.measuredAt === null ||
    now.getTime() - counter.measuredAt.getTime() > BIKE_STALE_MS
  );
}

/** The unit vector across the street at a counter (projected
 *  coordinates): the two directions' columns stand either side of it. */
export function acrossStreet(angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  // along the street: (−sin a, cos a); across it, to its right: (cos a, sin a)
  return [Math.cos(a), Math.sin(a)];
}
