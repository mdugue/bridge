/**
 * A sun study over a period (plan 054 phase 2, the spike of 2026-11-03):
 * how much of the time the sun is up in a window of hours, over the days of
 * a season, a place spends in shade. Each sample is one sun position; a
 * point is lit when the sun stands above the baked horizon there (terrain
 * and buildings, ≈ 8 m and 16 azimuths, lib/city/skyview.ts) and its ray
 * passes the tree crowns the viewer draws (the horizon leaves trees out),
 * each crown a spheroid letting a share of the light through.
 *
 * What it does not see: buildings and walls nearer than 8 m (the horizon's
 * near band starts there), awnings, sun sails and play equipment, trees no
 * file knows, and the ground's slope under a crown (the crown stands on the
 * point's own ground). Times are the city's clock (Central European, with
 * summer time). No THREE, no DOM.
 */
import { getPosition } from "suncalc";
import { SITE_ZONE, zonedTime } from "./bike-counts";
import { clamp } from "./math";
import { DEG2RAD } from "./pose";
import type { ViewpointGeometry } from "./site";
import {
  HORIZON_AZIMUTHS,
  HORIZON_LAYERS,
  HORIZON_MAX_DEG,
  HORIZON_PX,
  HORIZON_SOFT_DEG,
  NEAR_MAX_DEG,
} from "./skyview";
import { crownBase } from "./tree-placement";

/** The eye the shade is judged at (m over the ground): a child's. */
export const EYE_M = 1;
/** Light a crown lets through in leaf, and bare (the sky-view bake's
 *  numbers, pipeline/bake/skyview.py CROWN_TRANSMISSION). */
export const LEAF_ON_LIGHT = 0.15;
export const BARE_LIGHT = 0.65;
/** One day a week, one sun position every 20 minutes. */
export const DAY_STEP = 7;
export const MINUTE_STEP = 20;
/** Farther than this (m) no crown is asked: at 20° a 35 m crown's shadow
 *  ends 93 m away. */
export const MAX_REACH_M = 120;
/** At most this many points per place, at least this far apart (m). */
export const MAX_POINTS = 160;
export const MIN_SPACING_M = 2;

/** The periods a study can sum over, with their month-day spans. */
export const PERIODS = {
  fruehling: {
    label: "Frühling",
    span: "März bis Mai",
    from: [3, 1],
    to: [5, 31],
  },
  sommer: {
    label: "Sommer",
    span: "Juni bis August",
    from: [6, 1],
    to: [8, 31],
  },
  herbst: {
    label: "Herbst",
    span: "September bis November",
    from: [9, 1],
    to: [11, 30],
  },
  jahr: {
    label: "das ganze Jahr",
    span: "Januar bis Dezember",
    from: [1, 1],
    to: [12, 31],
  },
} as const satisfies Record<
  string,
  { label: string; span: string; from: [number, number]; to: [number, number] }
>;
export type PeriodId = keyof typeof PERIODS;

/** What a study ranks. */
export const SUBJECTS = {
  spielplatz: { one: "Spielplatz", many: "Spielplätze" },
  bank: { one: "Bank", many: "Bänke" },
} as const;
export type SubjectId = keyof typeof SUBJECTS;

/** A study as the link carries it: everything needed to compute it again. */
export interface SunStudyRecipe {
  period: PeriodId;
  /** the window of hours, the city's clock */
  from: number;
  to: number;
  what: SubjectId;
  /** the area: a circle (m) round `x`, `y` (site CRS); no centre = the
   *  camera's place when it runs */
  radius: number;
  x?: number;
  y?: number;
}

/** The widest circle a recipe may name (m): the largest chip. Its inputs
 *  (six tiles in Dresden's centre, ≈ 23 MB) are what a phone holds. */
export const MAX_RADIUS_M = 2000;

export const DEFAULT_RECIPE: SunStudyRecipe = {
  period: "sommer",
  from: 11,
  to: 17,
  what: "spielplatz",
  radius: 1000,
};

/** `?studie=` as written: `sommer_11-17_spielplatz_1000m_412345_5658765`;
 *  `1` (or anything unreadable) is the default study. */
export function parseRecipe(text: string | null): SunStudyRecipe | null {
  if (text === null) {
    return null;
  }
  const m =
    /^(?<period>[a-z]+)_(?<from>\d{1,2})-(?<to>\d{1,2})_(?<what>[a-z]+)_(?<radius>\d{2,5})m(?:_(?<x>\d+)_(?<y>\d+))?$/u.exec(
      text
    );
  if (!m?.groups) {
    return { ...DEFAULT_RECIPE };
  }
  const { period, from, to, what, radius, x, y } = m.groups;
  const hours = [Number(from), Number(to)];
  if (
    !(period in PERIODS) ||
    !(what in SUBJECTS) ||
    hours[0] >= hours[1] ||
    hours[1] > 24
  ) {
    return { ...DEFAULT_RECIPE };
  }
  return {
    period: period as PeriodId,
    from: hours[0],
    to: hours[1],
    what: what as SubjectId,
    radius: Math.min(Math.max(Number(radius), 100), MAX_RADIUS_M),
    ...(x && y ? { x: Number(x), y: Number(y) } : {}),
  };
}

/** The recipe as `?studie=` writes it. */
export function recipeText(r: SunStudyRecipe): string {
  const at =
    r.x === undefined || r.y === undefined
      ? ""
      : `_${Math.round(r.x)}_${Math.round(r.y)}`;
  return `${r.period}_${r.from}-${r.to}_${r.what}_${r.radius}m${at}`;
}

/** The question the study answers, in words. */
export function recipeTitle(r: SunStudyRecipe): string {
  const when =
    r.period === "jahr" ? "übers Jahr" : `im ${PERIODS[r.period].label}`;
  return `Schattigste ${SUBJECTS[r.what].many} ${when}, ${r.from}–${r.to} Uhr`;
}

/** One sun position: compass azimuth and elevation (°), the unit step
 *  toward the sun on the ground (east, north), and the light a broadleaf
 *  crown lets through that day. */
export interface SunSample {
  az: number;
  el: number;
  ux: number;
  uy: number;
  tanEl: number;
  leafLight: number;
  /** the sample's day (0-based, in the period) */
  day: number;
}

/** How far the city's clock is ahead of UTC on the day that starts at
 *  `midnight` (UTC, ms): read at noon, clear of the switch at 01:00 UTC. */
function cityOffsetMs(midnight: number): number {
  const d = new Date(midnight);
  const noon = zonedTime(
    [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 12, 0, 0],
    SITE_ZONE
  );
  return midnight + 12 * 3_600_000 - noon.getTime();
}

/** The light a broadleaf crown lets through on day-of-year `doy`: bare
 *  until mid-April, leafing out by mid-May, bare again from mid-November. */
export function leafLight(doy: number): number {
  const out = clamp((doy - 105) / 30, 0, 1);
  const fall = clamp((doy - 288) / 30, 0, 1);
  const leafed = out * (1 - fall);
  return BARE_LIGHT * (1 - leafed) + LEAF_ON_LIGHT * leafed;
}

function dayOfYear(utcMs: number): number {
  const d = new Date(utcMs);
  return Math.floor((utcMs - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000);
}

/** The days a period samples (UTC midnight), one every DAY_STEP. */
export function periodDays(period: PeriodId, year: number): number[] {
  const { from, to } = PERIODS[period];
  const start = Date.UTC(year, from[0] - 1, from[1]);
  const end = Date.UTC(year, to[0] - 1, to[1]);
  const days: number[] = [];
  for (let t = start + 3 * 86_400_000; t <= end; t += DAY_STEP * 86_400_000) {
    days.push(t);
  }
  return days;
}

/** Every sun position of a recipe above the horizon, at `lat`, `lng`. */
export function sunSamples(
  recipe: SunStudyRecipe,
  lat: number,
  lng: number,
  year: number
): { samples: SunSample[]; days: number; stepHours: number } {
  const days = periodDays(recipe.period, year);
  const samples: SunSample[] = [];
  for (const [day, midnight] of days.entries()) {
    const offset = cityOffsetMs(midnight);
    const light = leafLight(dayOfYear(midnight));
    for (
      let minute = recipe.from * 60 + MINUTE_STEP / 2;
      minute < recipe.to * 60;
      minute += MINUTE_STEP
    ) {
      const at = new Date(midnight + minute * 60_000 - offset);
      const { azimuth, altitude } = getPosition(at, lat, lng);
      if (altitude > 0.5) {
        const az = azimuth * DEG2RAD;
        samples.push({
          az: azimuth,
          el: altitude,
          ux: Math.sin(az),
          uy: Math.cos(az),
          tanEl: Math.tan(altitude * DEG2RAD),
          leafLight: light,
          day,
        });
      }
    }
  }
  return { samples, days: days.length, stepHours: MINUTE_STEP / 60 };
}

/** A tile's horizon raster as decoded (lib/city/png-raster.ts): 4 × 256
 *  bytes wide, eight planes of 256 rows stacked north to south. */
export interface HorizonRaster {
  data: Uint8Array;
  minX: number;
  maxY: number;
  /** the tile's edge (m) */
  size: number;
}

function horizonByte(
  r: HorizonRaster,
  row: number,
  col: number,
  azimuth: number,
  band: 0 | 1
): number {
  const plane = band * HORIZON_LAYERS + (azimuth >> 2);
  return r.data[
    (plane * HORIZON_PX + row) * HORIZON_PX * 4 + col * 4 + (azimuth & 3)
  ];
}

/** The skyline's elevation (°) toward compass azimuth `azDeg` at (x, y):
 *  the higher of the far band (80 m–10 km) and the near band (8–80 m),
 *  between the two nearest of the sixteen azimuths. */
export function horizonDeg(
  r: HorizonRaster,
  x: number,
  y: number,
  azDeg: number
): number {
  const cell = r.size / HORIZON_PX;
  const col = Math.min(
    Math.max(Math.floor((x - r.minX) / cell), 0),
    HORIZON_PX - 1
  );
  const row = Math.min(
    Math.max(Math.floor((r.maxY - y) / cell), 0),
    HORIZON_PX - 1
  );
  const a = ((((azDeg % 360) + 360) % 360) / 360) * HORIZON_AZIMUTHS;
  const i0 = Math.floor(a) % HORIZON_AZIMUTHS;
  const i1 = (i0 + 1) % HORIZON_AZIMUTHS;
  const t = a - Math.floor(a);
  const band = (b: 0 | 1) =>
    horizonByte(r, row, col, i0, b) * (1 - t) +
    horizonByte(r, row, col, i1, b) * t;
  return Math.max(
    (band(0) * HORIZON_MAX_DEG) / 255,
    (band(1) * NEAR_MAX_DEG) / 255
  );
}

/** A crown as the viewer draws it: centre, from its base to its top (m
 *  over the ground), half its width. */
export interface Crown {
  x: number;
  y: number;
  base: number;
  top: number;
  r: number;
  evergreen: boolean;
}

/** The crown of a tree `h` m tall and `width` m across, or null when too
 *  small to shade. */
export function crownOf(
  x: number,
  y: number,
  h: number,
  width: number,
  evergreen: boolean,
  overRoad = false
): Crown | null {
  if (!(h > EYE_M && width >= 1)) {
    return null;
  }
  return {
    x,
    y,
    base: crownBase(h, overRoad),
    top: h,
    r: width / 2,
    evergreen,
  };
}

/**
 * Whether the ray from (px, py) at EYE_M toward the sun passes through the
 * crown: the spheroid's cross-section in the vertical plane of the ray, an
 * ellipse scaled by the ray's offset from the trunk.
 */
export function rayHitsCrown(
  px: number,
  py: number,
  s: SunSample,
  c: Crown
): boolean {
  const dx = c.x - px;
  const dy = c.y - py;
  const along = dx * s.ux + dy * s.uy;
  if (along + c.r < 0) {
    return false;
  }
  const perp = dx * s.uy - dy * s.ux;
  if (perp * perp >= c.r * c.r) {
    return false;
  }
  // past the crown's top by the time the ray reaches it
  if ((along - c.r) * s.tanEl + EYE_M > c.top) {
    return false;
  }
  const k2 = 1 - (perp * perp) / (c.r * c.r);
  const a2 = c.r * c.r * k2;
  const half = (c.top - c.base) / 2;
  const b2 = half * half * k2;
  const c0 = EYE_M + along * s.tanEl - (c.top + c.base) / 2;
  const A = 1 / a2 + (s.tanEl * s.tanEl) / b2;
  const B = (2 * s.tanEl * c0) / b2;
  const C = (c0 * c0) / b2 - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) {
    return false;
  }
  // the far crossing must lie ahead of the eye
  return (-B + Math.sqrt(disc)) / (2 * A) + along >= 0;
}

/** Where a study reads the horizon: the raster that holds (x, y), if any. */
export type HorizonAt = (x: number, y: number) => HorizonRaster | null;

/** The light (0–1) a point gets in one sample. */
export function lightAt(
  px: number,
  py: number,
  s: SunSample,
  horizonAt: HorizonAt,
  crowns: readonly Crown[]
): number {
  const raster = horizonAt(px, py);
  if (raster) {
    const sky = horizonDeg(raster, px, py, s.az);
    const lit = (s.el - sky) / (2 * HORIZON_SOFT_DEG) + 0.5;
    if (lit <= 0) {
      return 0;
    }
    return Math.min(lit, 1) * throughCrowns(px, py, s, crowns);
  }
  return throughCrowns(px, py, s, crowns);
}

function throughCrowns(
  px: number,
  py: number,
  s: SunSample,
  crowns: readonly Crown[]
): number {
  let light = 1;
  for (const c of crowns) {
    if (rayHitsCrown(px, py, s, c)) {
      light *= c.evergreen ? LEAF_ON_LIGHT : s.leafLight;
      if (light < 0.01) {
        return 0;
      }
    }
  }
  return light;
}

/** A ring of a polygon's outline (site CRS), closed or not. */
export type Ring = readonly (readonly [number, number])[];

export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Points on a grid inside a polygon (outline, then holes), at most
 *  MAX_POINTS; its centre when the grid misses it. */
export function placePoints(rings: readonly Ring[]): [number, number][] {
  const [outer, ...holes] = rings;
  const area = ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0);
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  const box = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  const inside = (x: number, y: number) =>
    inRing(outer, x, y) && !holes.some((h) => inRing(h, x, y));
  let spacing = Math.max(MIN_SPACING_M, Math.sqrt(area / MAX_POINTS));
  let points = gridPoints(box, spacing, inside);
  // the grid's rounding can overshoot by a row
  while (points.length > MAX_POINTS) {
    spacing *= 1.05;
    points = gridPoints(box, spacing, inside);
  }
  if (points.length === 0) {
    points.push([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
  }
  return points;
}

function gridPoints(
  [x0, y0, x1, y1]: number[],
  spacing: number,
  inside: (x: number, y: number) => boolean
): [number, number][] {
  const points: [number, number][] = [];
  for (let y = y0 + spacing / 2; y < y1; y += spacing) {
    for (let x = x0 + spacing / 2; x < x1; x += spacing) {
      if (inside(x, y)) {
        points.push([x, y]);
      }
    }
  }
  return points;
}

/** A place to rank: an outline (playground) or a point (bench). */
export interface StudyPlace {
  id: number;
  rings: readonly Ring[] | null;
  x: number;
  y: number;
}

/** What the study found at a place: the share of the sunlit window in
 *  shade (mean over its points, and the spread from its shadiest tenth to
 *  its sunniest), and the direct sun a day (h). */
export interface PlaceShade {
  id: number;
  x: number;
  y: number;
  area: number;
  points: number;
  shade: number;
  low: number;
  high: number;
  sunHours: number;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** The crowns that can shade a box (min/max x, y) at the lowest sun. */
export function crownsNear(
  crowns: readonly Crown[],
  box: [number, number, number, number],
  minTanEl: number
): Crown[] {
  const reach = (top: number) =>
    Math.min(MAX_REACH_M, (top - EYE_M) / Math.max(minTanEl, 0.05));
  return crowns.filter((c) => {
    const pad = reach(c.top) + c.r;
    return (
      c.x > box[0] - pad &&
      c.x < box[2] + pad &&
      c.y > box[1] - pad &&
      c.y < box[3] + pad
    );
  });
}

/** One place's shade over every sample. */
export function shadePlace(
  place: StudyPlace,
  samples: readonly SunSample[],
  study: { days: number; stepHours: number },
  horizonAt: HorizonAt,
  crowns: readonly Crown[]
): PlaceShade {
  const points = place.rings
    ? placePoints(place.rings)
    : [[place.x, place.y] as [number, number]];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const box: [number, number, number, number] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  let minTan = Infinity;
  for (const s of samples) {
    minTan = Math.min(minTan, s.tanEl);
  }
  const near = crownsNear(crowns, box, minTan);
  const shades: number[] = [];
  let light = 0;
  for (const [px, py] of points) {
    // the point's raster, found once for all its samples
    const raster = horizonAt(px, py);
    const here: HorizonAt = () => raster;
    let lit = 0;
    for (const s of samples) {
      lit += lightAt(px, py, s, here, near);
    }
    light += lit;
    shades.push(samples.length > 0 ? 1 - lit / samples.length : 0);
  }
  const sorted = [...shades].sort((a, b) => a - b);
  const mean = shades.reduce((a, b) => a + b, 0) / shades.length;
  return {
    id: place.id,
    x: place.x,
    y: place.y,
    area: place.rings ? ringArea(place.rings[0]) : 0,
    points: points.length,
    shade: mean,
    low: quantile(sorted, 0.1),
    high: quantile(sorted, 0.9),
    sunHours:
      ((light / points.length) * study.stepHours) / Math.max(study.days, 1),
  };
}

const COMPASS = [
  "nördlich",
  "nordöstlich",
  "östlich",
  "südöstlich",
  "südlich",
  "südwestlich",
  "westlich",
  "nordwestlich",
];

/** How far back and how high (m) the camera hangs over a picked place:
 *  near enough that a playground's hatch fills a good part of the view,
 *  high enough to see the crowns and houses that shade it. */
const VIEW_BACK_M = 70;
const VIEW_ABOVE_M = 45;

/** The view onto a ranked place from the air, from the side the camera
 *  comes from (from the south where it stands on the place). */
export function placeView(
  place: { x: number; y: number },
  from: { x: number; y: number } | null
): ViewpointGeometry {
  let dx = (from?.x ?? place.x) - place.x;
  let dy = (from?.y ?? place.y) - place.y;
  if (Math.hypot(dx, dy) < 1) {
    dx = 0;
    dy = -1;
  }
  const len = Math.hypot(dx, dy);
  const ex = place.x + (dx / len) * VIEW_BACK_M;
  const ey = place.y + (dy / len) * VIEW_BACK_M;
  const heading =
    (Math.atan2(place.x - ex, place.y - ey) / DEG2RAD + 360) % 360;
  return {
    epsg: { x: Math.round(ex * 10) / 10, y: Math.round(ey * 10) / 10 },
    aboveGround: VIEW_ABOVE_M,
    headingDeg: Math.round(heading * 10) / 10,
    pitchDeg:
      Math.round((Math.atan2(-VIEW_ABOVE_M, VIEW_BACK_M) / DEG2RAD) * 10) / 10,
    fov: 60,
    mode: "fly",
  };
}

/** A place's name for the list: the nearest address within 80 m
 *  ("nahe Alaunstraße 36"), else where it lies from the study's centre. */
export function placeLabel(
  x: number,
  y: number,
  addresses: readonly { addr: string; x: number; y: number }[],
  centre: { x: number; y: number }
): string {
  let best: { addr: string; d: number } | null = null;
  for (const a of addresses) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < 80 && (!best || d < best.d)) {
      best = { addr: a.addr, d };
    }
  }
  if (best) {
    return `nahe ${best.addr.split(",")[0]}`;
  }
  const d = Math.hypot(x - centre.x, y - centre.y);
  const sector =
    Math.round(
      ((Math.atan2(x - centre.x, y - centre.y) / DEG2RAD + 360) % 360) / 45
    ) % 8;
  return `${Math.round(d / 10) * 10} m ${COMPASS[sector]} der Mitte`;
}
