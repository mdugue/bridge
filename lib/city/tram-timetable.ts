/**
 * The trams by timetable (pipeline/bake/transit.py → `trams.json`): where
 * every scheduled tram is at an instant of the scene's clock. The pure
 * half of app/_components/tram-cars.ts. No THREE, no DOM.
 *
 * A trip is a profile (a pattern — the path and its stops — and the
 * running times) started at a second of the day. Between two stops a car
 * accelerates out of the one and brakes into the next (a smooth ease over
 * the leg, not a constant speed), and stands at a stop from its arrival
 * to its departure. The day is told apart by kind only (working day,
 * Saturday, Sunday; a public holiday runs as its weekday), and the trips
 * of the day before that run past midnight are still on their way.
 */
import type { Point2 } from "./polyline";

/** The committed timetable (pipeline/bake/transit.py), and the name
 *  scripts/prepare-data.ts publishes it under (before hashing). */
export function tramTimetableSource(dataDir: string): string {
  return `${dataDir}/transit/trams.json`;
}
export const TRAM_TIMETABLE_FILE = "trams.json";

/** The cars' yellow and their trail's gold (app/_components/tram-cars.ts;
 *  the HUD's swatch shows the same). */
export const TRAM_TINTS = { car: 0xf2_cf_5c, trail: 0xf6_d3_6b } as const;

/**
 * A tram operator's cars as the viewer draws them: the body, the band
 * along the roof's edge and the skirt (sRGB, softened into the scene's
 * pastel), and the car lengths of its fleet, each with its weight (how
 * many cars of that length run). The window band and the roof are every
 * operator's alike.
 */
export interface TramLivery {
  body: number;
  /** [length (m), how many of the fleet] */
  lengths: readonly (readonly [number, number])[];
  skirt: number;
  top: number;
}

export type TramOperator = "bvg" | "dvb" | "lvb" | "mvg" | "neutral";

/**
 * The liveries, checked against street photos (Mapillary) and the fleet
 * lists (the photo QA of PR #173, V26):
 * - DVB (Dresden): yellow, the city's colours yellow and black — a black
 *   window band (de.wikipedia "Straßenbahn Dresden": "in den Stadtfarben
 *   Schwarz und Gelb"; Mapillary 1456680758584917, Albertplatz). Fleet:
 *   NGT6DD 30.28 m ×49, NGT D8DD 30.04 m ×40, NGT8DD 41.02 m ×23,
 *   NGT D12DD 45.09 m ×43, NGT DXDD 43.3 m ×33.
 * - LVB (Leipzig): silver-grey, a yellow band along the roof, a blue skirt
 *   and doors (Mapillary 1070506402407337, Augustusplatz, 2026-09). Fleet:
 *   NGT10 Tramino XL 37.6 m ×61, NGT12 45 m ×33 (the older Tatra, NGT8 and
 *   Leoliner sets, often coupled, are not told apart).
 * - MVG (Munich): MVG blue, white along the roof (Mapillary
 *   1213157856724103, Karlsplatz); the Avenio fleet's four-module cars are
 *   36 m (en.wikipedia "Trams in Munich").
 * - BVG (Berlin): yellow; Flexity Berlin 30.8 m and 40 m (urban-transport-
 *   magazine.com) — not checked against a photo here.
 * - Any other operator: a pale neutral car of 30 m.
 */
export const TRAM_LIVERIES: Record<TramOperator, TramLivery> = {
  dvb: {
    body: TRAM_TINTS.car,
    top: TRAM_TINTS.car,
    skirt: TRAM_TINTS.car,
    lengths: [
      [30, 89],
      [41, 23],
      [45, 76],
    ],
  },
  lvb: {
    body: 0xd6_d9_dc,
    top: 0xf0_c6_4a,
    skirt: 0x4d_70_ae,
    lengths: [
      [37.6, 61],
      [45, 33],
    ],
  },
  mvg: {
    body: 0x5b_83_c6,
    top: 0xee_f0_f2,
    skirt: 0x5b_83_c6,
    lengths: [[36, 1]],
  },
  bvg: {
    body: 0xf2_d1_5a,
    top: 0xf2_d1_5a,
    skirt: 0xf2_d1_5a,
    lengths: [
      [30.8, 1],
      [40, 1],
    ],
  },
  neutral: {
    body: 0xe6_e3_dc,
    top: 0xe6_e3_dc,
    skirt: 0xb9_bc_c2,
    lengths: [[30, 1]],
  },
};

/** Which operator's livery a GTFS agency name stands for. The feed names
 *  the transport association for some (Dresden's trams come as the
 *  Verkehrsverbund Oberelbe's: within the VVO only the DVB runs city
 *  trams; Munich's as Stadtwerke München's, the MVG's parent). */
export function operatorOf(agency: string | undefined): TramOperator {
  const a = agency ?? "";
  if (
    /Dresdner Verkehrsbetriebe|\bDVB\b|Verkehrsverbund Oberelbe|\bVVO\b/i.test(
      a
    )
  ) {
    return "dvb";
  }
  if (/Leipziger Verkehrsbetriebe|\bLVB\b/i.test(a)) {
    return "lvb";
  }
  if (
    /Stadtwerke München|Münchner Verkehrsgesellschaft|\bMVG\b|\bSWM\b/i.test(a)
  ) {
    return "mvg";
  }
  if (/Berliner Verkehrsbetriebe|\bBVG\b/i.test(a)) {
    return "bvg";
  }
  return "neutral";
}

/** A line's operator in a timetable (neutral where the file names none:
 *  a timetable baked before the agencies were kept). */
export function routeOperator(tt: TramTimetable, route: number): TramOperator {
  const agency = tt.agencies?.[tt.routeAgency?.[route] ?? -1];
  return operatorOf(agency);
}

/** One car's length (m) for a trip: drawn from the operator's fleet by
 *  its weights, the same for the trip all day (`seed`, any integer). */
export function carLength(livery: TramLivery, seed: number): number {
  const total = livery.lengths.reduce((n, [, w]) => n + w, 0);
  // a hash of the seed in [0, 1): neighbouring trips draw unalike
  const h = Math.abs(Math.sin(seed * 12.9898 + 78.233) * 43_758.5453) % 1;
  let at = h * total;
  for (const [length, w] of livery.lengths) {
    if (at < w) {
      return length;
    }
    at -= w;
  }
  return livery.lengths[livery.lengths.length - 1]?.[0] ?? 30;
}

export type TramDayKind = "saturday" | "sunday" | "weekday";

export interface TramPattern {
  /** the distance along `coords` of each stop (m) */
  at: number[];
  /** [from, to] vertex ranges on a bridge deck */
  bridge: [number, number][];
  /** the path (projected coordinates) */
  coords: Point2[];
  /** index into `routes` */
  route: number;
}

export interface TramTimetable {
  /** the operators' names as the feed gives them (GTFS `agency_name`) */
  agencies?: string[];
  attribution?: string;
  days: Partial<
    Record<TramDayKind, { date: string; trips: [number, number][] }>
  >;
  patterns: TramPattern[];
  /** the running times of a pattern: arrival, departure per stop, seconds
   *  after the trip's start */
  profiles: { pattern: number; t: number[] }[];
  /** per line, the index into `agencies` of who runs it */
  routeAgency?: number[];
  routes: string[];
}

export const DAY_SECONDS = 86_400;

/** The kind of day a date runs (Monday to Friday: a working day). */
export function dayKindOf(date: Date): TramDayKind {
  const wd = date.getDay();
  if (wd === 6) {
    return "saturday";
  }
  return wd === 0 ? "sunday" : "weekday";
}

/** Seconds since the date's local midnight. */
export function secondsOfDay(date: Date): number {
  return (
    date.getHours() * 3600 +
    date.getMinutes() * 60 +
    date.getSeconds() +
    date.getMilliseconds() / 1000
  );
}

/** A pattern's path, measured: the distance along it of each vertex. */
export interface MeasuredPattern extends TramPattern {
  dist: number[];
  /** whether each vertex's following segment lies on a bridge */
  onBridge: boolean[];
}

export function measurePattern(p: TramPattern): MeasuredPattern {
  const dist = [0];
  for (let i = 1; i < p.coords.length; i++) {
    const [ax, ay] = p.coords[i - 1];
    const [bx, by] = p.coords[i];
    dist.push(dist[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const onBridge = p.coords.map(() => false);
  for (const [from, to] of p.bridge) {
    for (let i = from; i < to && i < onBridge.length; i++) {
      onBridge[i] = true;
    }
  }
  return { ...p, dist, onBridge };
}

export interface PathPoint {
  /** the travel direction (unit, projected) */
  dir: Point2;
  onBridge: boolean;
  x: number;
  y: number;
}

/** The point at distance `d` along a measured path (clamped to it). */
export function pointAlong(p: MeasuredPattern, d: number): PathPoint {
  const { coords, dist } = p;
  const n = coords.length;
  const total = dist[n - 1] ?? 0;
  const s = Math.min(Math.max(d, 0), total);
  // binary search: the segment holding s
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const [ax, ay] = coords[lo];
  const [bx, by] = coords[Math.min(lo + 1, n - 1)];
  const len = dist[Math.min(lo + 1, n - 1)] - dist[lo];
  const f = len > 0 ? (s - dist[lo]) / len : 0;
  const dx = bx - ax;
  const dy = by - ay;
  const dl = Math.hypot(dx, dy) || 1;
  return {
    x: ax + dx * f,
    y: ay + dy * f,
    dir: [dx / dl, dy / dl],
    onBridge: p.onBridge[lo] ?? false,
  };
}

/** Accelerate, cruise, brake: 0..1 → 0..1, a smoothstep's ease. */
function ease(t: number): number {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
}

/** Where along its pattern a trip's head is `elapsed` seconds after its
 *  start (m), or null before its start or after its end. */
export function headAlong(
  at: readonly number[],
  t: readonly number[],
  elapsed: number
): number | null {
  const stops = at.length;
  if (elapsed < t[0] || elapsed > t[2 * stops - 1]) {
    return null;
  }
  for (let i = 0; i < stops; i++) {
    const arr = t[2 * i];
    const dep = t[2 * i + 1];
    if (elapsed <= dep) {
      if (elapsed >= arr || i === 0) {
        return at[i];
      }
      // between the last stop's departure and this one's arrival
      const leave = t[2 * i - 1];
      const span = arr - leave;
      const f = span > 0 ? ease((elapsed - leave) / span) : 1;
      return at[i - 1] + (at[i] - at[i - 1]) * f;
    }
  }
  return at[stops - 1];
}

export interface RunningTram {
  /** the head's distance along the pattern (m) */
  head: number;
  pattern: number;
  /** the line ("11") */
  route: string;
  /** the line's index into `routes` */
  routeIndex: number;
  /** the trip, as one integer (its profile and start): what its car's
   *  length is drawn by */
  seed: number;
}

/**
 * Every tram on its way at `seconds` of a day of `kind` — its own trips,
 * and those of the day before (of `prevKind`) still running past
 * midnight.
 */
export function runningTrams(
  tt: TramTimetable,
  kind: TramDayKind,
  prevKind: TramDayKind,
  seconds: number
): RunningTram[] {
  const out: RunningTram[] = [];
  const collect = (day: TramDayKind, at: number) => {
    for (const [profile, start] of tt.days[day]?.trips ?? []) {
      // trips are sorted by start: none after this one has begun
      if (start > at) {
        break;
      }
      const prof = tt.profiles[profile];
      const pattern = tt.patterns[prof.pattern];
      const head = headAlong(pattern.at, prof.t, at - start);
      if (head !== null) {
        out.push({
          head,
          pattern: prof.pattern,
          route: tt.routes[pattern.route] ?? "",
          routeIndex: pattern.route,
          seed: profile * DAY_SECONDS * 2 + start,
        });
      }
    }
  };
  collect(kind, seconds);
  collect(prevKind, seconds + DAY_SECONDS);
  return out;
}

/** The kind of the day before a date. */
export function previousDayKind(date: Date): TramDayKind {
  const before = new Date(date);
  before.setDate(before.getDate() - 1);
  return dayKindOf(before);
}
