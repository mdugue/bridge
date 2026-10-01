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
export const TRAM_TIMETABLE_SOURCE = "data/transit/trams.json";
export const TRAM_TIMETABLE_FILE = "trams.json";

/** The cars' yellow and their trail's gold (app/_components/tram-cars.ts;
 *  the HUD's swatch shows the same). */
export const TRAM_TINTS = { car: 0xf2_cf_5c, trail: 0xf6_d3_6b } as const;

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
  attribution?: string;
  days: Partial<
    Record<TramDayKind, { date: string; trips: [number, number][] }>
  >;
  patterns: TramPattern[];
  /** the running times of a pattern: arrival, departure per stop, seconds
   *  after the trip's start */
  profiles: { pattern: number; t: number[] }[];
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
