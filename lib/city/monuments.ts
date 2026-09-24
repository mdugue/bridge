/**
 * How the monument layer sizes and seats what pipeline/bake/monuments.py
 * writes: the basin levels over sloping ground, a jet's height, where the
 * jets around a figure stand, and the fixed proportions of statues, stones
 * and columns. Plain numbers in, plain numbers out. No THREE, no DOM.
 */
import type { FountainStyle, MonumentKind } from "./features";
import type { Point2 } from "./polyline";

/** A fountain without an outline (a DLM point, an OSM node): its basin radius (m). */
export const POINT_BASIN_R = 2.2;
/** Rim height above the highest ground under the basin (m), per style. */
const RIM_H: Record<FountainStyle, number> = {
  basin: 0.5,
  pool: 0.3,
  splash: 0,
};
/** The water stands this far below the rim's top (m). */
const FREEBOARD = 0.1;
/** The rim's footing reaches this far below the lowest ground (m): on a slope
 *  the uphill side must not float. */
const FOOTING = 0.3;
/** Wet paving of a splash pad: just above the ground so it does not z-fight. */
const SPLASH_LIFT = 0.03;
const JET_MIN = 1.2;
const JET_MAX = 4.5;
const SPLASH_JET = 1;

export interface BasinLevels {
  /** bottom of the rim (world Y) */
  base: number;
  /** top of the rim; equals `water` for a splash pad (no rim) */
  rim: number;
  water: number;
}

/** The basin's levels from the ground under its outline (m, world Y). */
export function basinLevels(
  ground: readonly number[],
  style: FountainStyle
): BasinLevels | null {
  const valid = ground.filter((h) => Number.isFinite(h));
  if (valid.length === 0) {
    return null;
  }
  const low = Math.min(...valid);
  const high = Math.max(...valid);
  if (style === "splash") {
    const water = high + SPLASH_LIFT;
    return { base: low - FOOTING, rim: water, water };
  }
  const rim = high + RIM_H[style];
  return { base: low - FOOTING, rim, water: rim - FREEBOARD };
}

/** A jet's height (m): larger basins throw higher, pools stay still. */
export function jetHeight(areaM2: number, style: FountainStyle): number {
  if (style === "pool") {
    return 0;
  }
  if (style === "splash") {
    return SPLASH_JET;
  }
  const h = 0.3 * Math.sqrt(Math.max(areaM2, 0));
  return Math.min(Math.max(h, JET_MIN), JET_MAX);
}

/** Shoelace area (m²) of a ring (closed or not). */
export function ringArea(ring: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

/** The ring's vertex mean — the centre a figure and the jets gather round. */
export function ringCentre(ring: readonly Point2[]): Point2 {
  const open = openRing(ring);
  let x = 0;
  let y = 0;
  for (const [px, py] of open) {
    x += px;
    y += py;
  }
  return [x / open.length, y / open.length];
}

/** A GeoJSON ring without its closing duplicate vertex. */
export function openRing(ring: readonly Point2[]): Point2[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

/** Even-odd point-in-polygon test. */
export function insideRing(p: Point2, ring: readonly Point2[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Where the jets stand. A plain fountain has one in the middle; one with a
 * figure has four around it, at 45 % of the basin's equivalent radius, each
 * kept only when it lands on the water (an elongated or bent basin loses
 * the ones that would spray onto the paving).
 */
export function jetPlaces(
  centre: Point2,
  areaM2: number,
  figure: boolean,
  water: readonly Point2[] | null
): Point2[] {
  if (!figure) {
    return [centre];
  }
  const r = 0.45 * Math.sqrt(areaM2 / Math.PI);
  const around: Point2[] = [0, 1, 2, 3].map((k) => {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    return [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
  });
  return water ? around.filter((p) => insideRing(p, water)) : around;
}

export interface MonumentShape {
  /** pedestal / stone / shaft footprint (m) */
  width: number;
  depth: number;
  /** pedestal / stone / shaft height (m) */
  height: number;
  /** the figure standing on it (m); 0 = none */
  figure: number;
}

/**
 * The DLM gives a monument's position and name, never its size: these are
 * the proportions of a typical one — a figure on a plinth, a memorial stone,
 * a (post-mile) column.
 */
export const MONUMENT_SHAPE: Record<
  Exclude<MonumentKind, "fountain">,
  MonumentShape
> = {
  statue: { width: 1.3, depth: 1.3, height: 1.7, figure: 2.1 },
  stone: { width: 0.8, depth: 0.35, height: 1.1, figure: 0 },
  column: { width: 0.7, depth: 0.7, height: 7, figure: 0 },
};

/**
 * The plinth a fountain's figure stands on (above the water) and the figure,
 * grown with the basin: a sculpture group in an 18 m basin (Albertplatz)
 * is not a putto in a trough (m).
 */
export function fountainFigure(areaM2: number): {
  figure: number;
  height: number;
  width: number;
} {
  const figure = Math.min(
    Math.max(0.28 * Math.sqrt(Math.max(areaM2, 0)), 1.6),
    4.5
  );
  return { figure, height: 0.45 * figure, width: 0.6 * figure };
}

/** A stable yaw (radians) from a position, so statues do not all face north
 *  and do not turn on reload. */
export function yawOf(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453;
  return (s - Math.floor(s)) * Math.PI * 2;
}
