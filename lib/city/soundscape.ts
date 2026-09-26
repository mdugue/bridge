/**
 * The hidden soundscape's pure core (plan 035): what the city sounds like
 * where the listener stands, from the data the picture reads — the class
 * raster, the paving raster, the trees, the sky view, the sun and the
 * calendar. The engine (app/_components/soundscape/) samples the
 * environment at the pose rate (10 Hz), asks `mix` for the level of every
 * bed, and schedules the events (footsteps, birds, bells, the tram bell)
 * these functions time. No THREE, no DOM, no WebAudio.
 *
 * Levels are linear gains 0..1 *before* each voice's trim and the master
 * volume, so a source's character (how loud a river is next to a bird) is
 * the engine's, and where it is heard is decided here.
 */

import type { TerrainBounds } from "./terrain-geometry";
import type { TileSoundFiles, TilesetTileInfo } from "./tileset";

/** The speed of sound (m/s): a bell 686 m away strikes two seconds late. */
export const SPEED_OF_SOUND = 343;

/** What the listener hears the land cover around them as. */
export interface ClassShares {
  /** farmland/meadow, forest, copse */
  green: number;
  road: number;
  rail: number;
  builtup: number;
}

export type MovementMode = "fly" | "walk";

/** What the scene tells the soundscape at each pose sample (the handle's
 *  `listen`). */
export interface Listening {
  /** the scene clock (s) the crowns sway with */
  clock: number;
  heightAboveGround: number;
  mode: MovementMode;
  /** trees within the asked radius */
  trees: number;
}

/** A tile as the soundscape fetches it: its extent, its ≤ 2048² class
 *  raster and its sound files, all as served URLs. */
export interface SoundTile {
  bounds: TerrainBounds;
  files: TileSoundFiles;
  id: string;
  landcover: string;
}

/** A tileset tile's sound files resolved against the tileset's URL. */
export function soundTileOf(info: TilesetTileInfo, base: string): SoundTile {
  const files: TileSoundFiles = {};
  const kinds = ["monuments", "soundmarks", "surface", "svf", "tram"] as const;
  for (const kind of kinds) {
    const name = info.sound?.[kind];
    if (name) {
      files[kind] = new URL(name, base).href;
    }
  }
  return {
    bounds: info.bounds,
    files,
    id: info.id,
    landcover: new URL(info.minimap, base).href,
  };
}

/** The environment around the listener, sampled at the pose rate. */
export interface SoundEnv {
  /** day of the year (0 = 1 January; lib/city/tree-season.ts dayOfYear) */
  day: number;
  /** horizontal distance to the nearest running fountain (m) */
  fountainDistance: number;
  /** height of the ear above the ground (m) */
  heightAboveGround: number;
  /** minutes of the local day (scene clock) */
  minutes: number;
  mode: MovementMode;
  /** class shares within `NEAR_M` */
  near: ClassShares;
  /** 0 = full day … 1 = civil dusk and darker (sun-rig.ts) */
  nightFactor: number;
  /** sky-view factor at the listener (0..1), null where not baked */
  skyView: number | null;
  /** trees within `TREES_M` */
  trees: number;
  /** horizontal distance to the nearest water (m), Infinity beyond reach */
  waterDistance: number;
}

/** The beds' levels. */
export interface SoundGains {
  birds: number;
  crickets: number;
  fountain: number;
  hum: number;
  leaves: number;
  water: number;
  wind: number;
}

export const NEAR_M = 30;
export const TREES_M = 40;
/** The river is heard from this far (m, slant distance). */
export const WATER_REACH_M = 260;
/** A fountain from this far (m). */
export const FOUNTAIN_REACH_M = 45;
/** Trees within TREES_M for the fullest rustle. */
const TREES_FULL = 30;

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** A bump rising from `a` to 1 at `b`..`c` and falling back to 0 at `d`. */
function plateau(x: number, a: number, b: number, c: number, d: number) {
  return smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
}

/**
 * The wind: always a little, more in the open (the sky view, else how
 * little is built around) and more with height — a flight over the roofs
 * is mostly wind.
 */
export function windGain(env: SoundEnv): number {
  const open = env.skyView ?? 1 - 0.7 * env.near.builtup;
  const height = smoothstep(2, 160, env.heightAboveGround);
  return clamp01(0.18 + 0.32 * open + 0.5 * height);
}

/**
 * Leaves: the trees within earshot while they carry leaves (a generic
 * deciduous year — bare from late November to early April), louder in
 * the wind, gone once the ear is above the crowns.
 */
export function leafCover(day: number): number {
  // Leaf-out mid-April, leaf fall through November (days since 1 Jan).
  return plateau(day, 95, 125, 290, 330);
}

export function leavesGain(env: SoundEnv): number {
  const trees = clamp01(env.trees / TREES_FULL);
  const above = 1 - smoothstep(18, 45, env.heightAboveGround);
  // Evergreens keep a little of the rustle through the winter.
  const cover = 0.15 + 0.85 * leafCover(env.day);
  return clamp01(trees * cover * above * (0.55 + 0.45 * windGain(env)));
}

/** The river: a low murmur rising as the water comes near. */
export function waterGain(env: SoundEnv): number {
  const d = Math.hypot(env.waterDistance, env.heightAboveGround);
  if (!Number.isFinite(d)) {
    return 0;
  }
  const t = clamp01(1 - d / WATER_REACH_M);
  return t * t;
}

/** Whether Dresden's fountains run: April to October, 8 to 22 h. */
export function fountainsRun(day: number, minutes: number): boolean {
  return day >= 90 && day < 304 && minutes >= 8 * 60 && minutes < 22 * 60;
}

export function fountainGain(env: SoundEnv): number {
  if (!fountainsRun(env.day, env.minutes)) {
    return 0;
  }
  const d = Math.hypot(env.fountainDistance, env.heightAboveGround);
  if (!Number.isFinite(d)) {
    return 0;
  }
  const t = clamp01(1 - d / FOUNTAIN_REACH_M);
  return t * t;
}

/**
 * The city: a far, low hum where there are roads and rails, half of it
 * at night, and from the air the whole city at once.
 */
export function humGain(env: SoundEnv): number {
  const { road, rail, builtup } = env.near;
  const street = clamp01(1.4 * road + 0.8 * rail + 0.35 * builtup);
  const air = 0.45 * smoothstep(20, 220, env.heightAboveGround);
  const night = 1 - 0.55 * env.nightFactor;
  return clamp01(Math.max(street * 0.8, air) * night);
}

/** How much the birds sing through the year: most in spring, little in
 *  late summer and winter. */
export function songSeason(day: number): number {
  return 0.25 + 0.75 * plateau(day, 50, 90, 170, 215);
}

/** The morning chorus: the hour or two around sunrise, loudest in spring. */
export function dawnChorus(minutes: number, day: number): number {
  const spring = plateau(day, 60, 90, 160, 190);
  return spring * plateau(minutes, 3.5 * 60, 4.5 * 60, 7 * 60, 8.5 * 60);
}

/**
 * Birds by day near green: silent at night (the sun is the gate, not the
 * clock), sparse in winter, a few sparrows even in a street.
 */
export function birdsGain(env: SoundEnv): number {
  const light = 1 - smoothstep(0.35, 0.8, env.nightFactor);
  if (light <= 0) {
    return 0;
  }
  const green = clamp01(env.near.green * 1.4 + env.trees / 40);
  const street = 0.25 * env.near.builtup;
  const place = clamp01(Math.max(green, street));
  const above = 1 - smoothstep(25, 80, env.heightAboveGround);
  const chorus = 1 + dawnChorus(env.minutes, env.day);
  return clamp01(light * place * above * songSeason(env.day) * chorus);
}

/** Crickets: warm summer nights near meadows. */
export function cricketsGain(env: SoundEnv): number {
  const summer = plateau(env.day, 160, 180, 235, 260);
  const dark = smoothstep(0.5, 0.9, env.nightFactor);
  const meadow = clamp01(env.near.green * 1.6);
  const above = 1 - smoothstep(10, 40, env.heightAboveGround);
  return clamp01(summer * dark * meadow * above);
}

/** Every bed's level at once. */
export function mix(env: SoundEnv): SoundGains {
  return {
    wind: windGain(env),
    hum: humGain(env),
    water: waterGain(env),
    fountain: fountainGain(env),
    leaves: leavesGain(env),
    birds: birdsGain(env),
    crickets: cricketsGain(env),
  };
}

// --- sampling -----------------------------------------------------------------

/** A land-cover class at a projected point, or null off every loaded tile. */
export type ClassAt = (x: number, y: number) => number | null;

const GREEN = new Set([1, 2, 3]);
/** Sample spacing (m) of the class shares within NEAR_M. */
const SHARE_STEP_M = 6;

/** The class shares within NEAR_M of a point, on a SHARE_STEP_M grid. */
export function classShares(
  classAt: ClassAt,
  x: number,
  y: number
): ClassShares {
  const shares = { green: 0, road: 0, rail: 0, builtup: 0 };
  let seen = 0;
  const n = Math.floor(NEAR_M / SHARE_STEP_M);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (i * i + j * j > n * n) {
        continue;
      }
      const c = classAt(x + i * SHARE_STEP_M, y + j * SHARE_STEP_M);
      if (c === null) {
        continue;
      }
      seen++;
      if (GREEN.has(c)) {
        shares.green++;
      } else if (c === 7) {
        shares.road++;
      } else if (c === 5) {
        shares.rail++;
      } else if (c === 4) {
        shares.builtup++;
      }
    }
  }
  if (seen === 0) {
    return shares;
  }
  return {
    green: shares.green / seen,
    road: shares.road / seen,
    rail: shares.rail / seen,
    builtup: shares.builtup / seen,
  };
}

/** Rays and step (m) of the search for the nearest water. */
const WATER_RAYS = 16;
const WATER_STEP_M = 8;

/**
 * The nearest water class along WATER_RAYS rays out to WATER_REACH_M:
 * its distance (m; Infinity when none) and bearing (radians, clockwise
 * from north) — the river is heard from where it lies.
 */
export function nearestWater(
  classAt: ClassAt,
  x: number,
  y: number
): { bearing: number; distance: number } {
  if (classAt(x, y) === 8) {
    return { bearing: 0, distance: 0 };
  }
  let best = { bearing: 0, distance: Number.POSITIVE_INFINITY };
  for (let k = 0; k < WATER_RAYS; k++) {
    const b = (k / WATER_RAYS) * 2 * Math.PI;
    const dx = Math.sin(b);
    const dy = Math.cos(b);
    for (
      let d = WATER_STEP_M;
      d <= WATER_REACH_M && d < best.distance;
      d += WATER_STEP_M
    ) {
      if (classAt(x + dx * d, y + dy * d) === 8) {
        best = { bearing: b, distance: d };
        break;
      }
    }
  }
  return best;
}

/** The nearest point on a set of polylines ([x, y] vertices) and its
 *  distance (Infinity when there are none). */
export function nearestOnLines(
  lines: readonly (readonly (readonly [number, number])[])[],
  x: number,
  y: number
): { distance: number; x: number; y: number } {
  let best = { distance: Number.POSITIVE_INFINITY, x, y };
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 > 0 ? clamp01(((x - ax) * vx + (y - ay) * vy) / len2) : 0;
      const px = ax + t * vx;
      const py = ay + t * vy;
      const d = Math.hypot(x - px, y - py);
      if (d < best.distance) {
        best = { distance: d, x: px, y: py };
      }
    }
  }
  return best;
}

/**
 * The crowns' wind sway at a world (Y-up) point and the scene clock — the
 * same signal the crown shader bends the trees with (vegetation-layer.ts),
 * so the rustle swells as the crowns lean. −1.5 … 1.5.
 */
export function windSway(
  clock: number,
  worldX: number,
  worldZ: number
): number {
  const phase = worldX * 0.07 + worldZ * 0.11;
  return (
    Math.sin(clock * 0.38 + phase) + 0.5 * Math.sin(clock * 0.8 + phase * 1.7)
  );
}

// --- footsteps --------------------------------------------------------------

/** What a step sounds on. */
export type StepSurface =
  | "asphalt"
  | "concrete"
  | "grass"
  | "gravel"
  | "paving"
  | "sett";

/** SURFACE_KINDS (lib/city/landcover.ts) → the step it makes. */
const SURFACE_STEP: Record<number, StepSurface | undefined> = {
  1: "asphalt",
  2: "concrete",
  3: "paving",
  4: "sett",
  5: "gravel",
  6: "grass",
};

/** The land-cover class's own step where the paving raster knows nothing. */
const CLASS_STEP: Record<number, StepSurface> = {
  0: "paving",
  1: "grass",
  2: "grass",
  3: "grass",
  4: "paving",
  5: "gravel",
  6: "gravel",
  7: "asphalt",
  // On the water class the walker stands on a bridge deck or a landing.
  8: "asphalt",
};

/**
 * The surface underfoot from the paving raster's packed byte (R: park·64 +
 * walk·8 + road; pipeline/bake/surface.py) and the land-cover class: the
 * road's surface on the carriageway, the walkway's off it, else the class.
 */
export function stepSurface(classId: number, surfaceByte: number): StepSurface {
  const road = surfaceByte & 7;
  const walk = (surfaceByte >> 3) & 7;
  const onRoad = classId === 7;
  const first = onRoad ? road : walk;
  const second = onRoad ? walk : road;
  return (
    SURFACE_STEP[first] ??
    SURFACE_STEP[second] ??
    CLASS_STEP[classId] ??
    "paving"
  );
}

/** The stride (m) at walking pace. */
export const STRIDE_M = 0.75;
/** Faster than this between two samples is a jump, not a walk (m/s). */
export const TELEPORT_SPEED = 80;
/** A gap between two samples longer than this (s) — a hidden tab, a stall —
 *  is no walk either. */
export const MAX_STEP_GAP_S = 1.5;

/**
 * Steps per second at a speed: a person walks ~1.9 steps a second and
 * runs ~3. The walker moves at 9 m/s (27 sprinting): a step every 0.75 m
 * would be a drum roll, so above walking pace the stride lengthens and the
 * cadence rises only a little.
 */
export function cadence(speed: number): number {
  return Math.min(2.8, 1.9 + 0.035 * speed);
}

export function strideFor(speed: number): number {
  return Math.max(STRIDE_M, speed / cadence(speed));
}

/**
 * Advances the footstep clock by the horizontal distance walked since the
 * last sample: how many steps fall in it and the distance carried to the
 * next. Steps follow distance, not time — standing still is silent, and a
 * jump (a teleport, a viewpoint) is no walk at all.
 */
export function advanceSteps(
  carry: number,
  distance: number,
  dt: number
): { carry: number; steps: number } {
  if (dt <= 0 || distance <= 0) {
    return { carry, steps: 0 };
  }
  const speed = distance / dt;
  if (speed > TELEPORT_SPEED || dt > MAX_STEP_GAP_S) {
    return { carry: 0, steps: 0 };
  }
  const stride = strideFor(speed);
  const total = carry + distance;
  const steps = Math.floor(total / stride);
  return { carry: total - steps * stride, steps };
}

// --- bells --------------------------------------------------------------------

export type BellSize = "large" | "medium" | "small";

/** A bell tower (data/dlm/soundmarks_<tile>.geojson), projected metres. */
export interface BellTower {
  size: BellSize;
  x: number;
  y: number;
}

/** Churches heard from this far (m). */
export const BELL_REACH_M = 1500;
/** At most this many towers answer (the nearest), or it is a clatter. */
export const BELL_TOWERS_MAX = 4;
/** Seconds between two strokes of one tower's hour bell. */
export const STRIKE_INTERVAL_S: Record<BellSize, number> = {
  large: 2.6,
  medium: 2.2,
  small: 1.8,
};
/** The bell's prime (Hz): the deeper bell hangs in the taller tower. */
export const BELL_PRIME_HZ: Record<BellSize, number> = {
  large: 146.8,
  medium: 196,
  small: 293.7,
};

/**
 * A minor-third church bell's partials, relative to the prime: hum, prime,
 * tierce, quint, nominal and the upper ones, with their relative amplitudes
 * and decay times (s, for a large bell; smaller bells ring shorter).
 */
export const BELL_PARTIALS: readonly {
  amp: number;
  decay: number;
  ratio: number;
}[] = [
  { ratio: 0.5, amp: 0.45, decay: 7 },
  { ratio: 1, amp: 0.5, decay: 4.5 },
  { ratio: 1.2, amp: 0.38, decay: 3.4 },
  { ratio: 1.5, amp: 0.16, decay: 2.4 },
  { ratio: 2, amp: 0.55, decay: 2.8 },
  { ratio: 2.5, amp: 0.16, decay: 1.5 },
  { ratio: 2.67, amp: 0.1, decay: 1.2 },
  { ratio: 4, amp: 0.06, decay: 0.8 },
];

/** How many strokes an hour gets: 1…12. */
export function strokesFor(hour: number): number {
  const h = ((Math.round(hour) % 12) + 12) % 12;
  return h === 0 ? 12 : h;
}

/**
 * The hour of day (0–23) a clock change crosses, or null: the scene clock
 * moved forward (a scrub or real time) by less than a day across a full
 * hour. Scrubbing across several hours strikes only the last one; stepping
 * the calendar (a day or more) or going back strikes nothing. Instants are
 * *local* ms (epoch ms minus the zone's offset), so the bells keep the
 * wall clock in every time zone.
 */
export function hourCrossed(prev: number, next: number): number | null {
  const HOUR = 3_600_000;
  if (!(next > prev) || next - prev >= 24 * HOUR) {
    return null;
  }
  const last = Math.floor(next / HOUR);
  if (last * HOUR <= prev) {
    return null;
  }
  return ((last % 24) + 24) % 24;
}

/** A Date as local ms (for hourCrossed). */
export function localMs(date: Date): number {
  return date.getTime() - date.getTimezoneOffset() * 60_000;
}

/** Compass bearing (radians, 0 = north, clockwise) from `a` to `b`. */
export function bearing(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.atan2(b.x - a.x, b.y - a.y);
}

/**
 * Stereo position (−1 left … 1 right) of a source at a compass bearing for
 * a listener facing `heading` (both radians, clockwise from north). Never
 * hard to one side: a real ear hears the far side too.
 */
export function panFor(sourceBearing: number, heading: number): number {
  return 0.8 * Math.sin(sourceBearing - heading);
}

/** Distance attenuation (m → gain): full within 60 m, then 1/d. */
export function distanceGain(d: number, reference = 60): number {
  return Math.min(1, reference / Math.max(d, 1));
}

/** Air absorbs the highs: a low-pass corner (Hz) for a source d m away. */
export function airCutoff(d: number): number {
  return Math.max(700, 9000 * Math.exp(-d / 700));
}

/** One stroke of one tower's bell. */
export interface BellStroke {
  /** seconds after the hour is struck (the sound's travel included) */
  at: number;
  bearing: number;
  cutoff: number;
  gain: number;
  size: BellSize;
  tower: number;
}

/**
 * The hour's strokes from the towers within BELL_REACH_M (the nearest
 * BELL_TOWERS_MAX), each **delayed by its distance at 343 m/s**: on the
 * Neumarkt the Frauenkirche answers first, the Kreuzkirche a beat later.
 * A larger bell carries further.
 */
export function bellStrokes(
  hour: number,
  towers: readonly BellTower[],
  listener: { x: number; y: number }
): BellStroke[] {
  const heard = towers
    .map((t, tower) => ({
      t,
      tower,
      d: Math.hypot(t.x - listener.x, t.y - listener.y),
    }))
    .filter((h) => h.d <= BELL_REACH_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, BELL_TOWERS_MAX);
  const strokes: BellStroke[] = [];
  const n = strokesFor(hour);
  for (const { t, tower, d } of heard) {
    const carry = t.size === "large" ? 1 : t.size === "medium" ? 0.75 : 0.55;
    const fade = 1 - smoothstep(0.75 * BELL_REACH_M, BELL_REACH_M, d);
    for (let i = 0; i < n; i++) {
      strokes.push({
        at: d / SPEED_OF_SOUND + i * STRIKE_INTERVAL_S[t.size],
        bearing: bearing(listener, t),
        cutoff: airCutoff(d),
        gain: distanceGain(d, 120) * carry * fade,
        size: t.size,
        tower,
      });
    }
  }
  return strokes.sort((a, b) => a.at - b.at);
}

// --- rare events ---------------------------------------------------------------

/** Tram tracks are heard from this far (m). */
export const TRAM_REACH_M = 70;
/** On average one tram bell every this many seconds beside a track. */
export const TRAM_BELL_EVERY_S = 150;

/**
 * The chance a tram rings in a tick of `dt` seconds: only near a track,
 * only while trams run (4:30 to 0:30), rarely.
 */
export function tramBellChance(
  distance: number,
  minutes: number,
  dt: number
): number {
  if (!(distance <= TRAM_REACH_M) || (minutes >= 30 && minutes < 270)) {
    return 0;
  }
  return (dt / TRAM_BELL_EVERY_S) * (1 - distance / TRAM_REACH_M);
}

/** At full bird level, calls per second (all species together). */
export const BIRD_CALLS_PER_S = 0.45;

export type BirdCall = "blackbird" | "sparrow" | "tit";

/**
 * Which bird calls: sparrows in the streets, tits in the green, and the
 * blackbird's phrase at dusk and dawn (`u` uniform in 0..1).
 */
export function birdCall(env: SoundEnv, u: number): BirdCall {
  const twilight =
    plateau(env.nightFactor, 0.1, 0.3, 0.6, 0.8) +
    dawnChorus(env.minutes, env.day);
  const blackbird = clamp01(0.08 + 0.6 * twilight);
  if (u < blackbird) {
    return "blackbird";
  }
  const street = env.near.builtup / (env.near.builtup + env.near.green + 0.02);
  return (u - blackbird) / (1 - blackbird) < street ? "sparrow" : "tit";
}

/** The chance of a bird call in a tick of `dt` seconds at `level`. */
export function birdCallChance(level: number, dt: number): number {
  return clamp01(level * BIRD_CALLS_PER_S * dt);
}

// --- silence -------------------------------------------------------------------

export interface SilenceInputs {
  /** the visitor turned the sound on (L or the switch) */
  enabled: boolean;
  /** the tab is hidden */
  hidden: boolean;
  /** the loading screen is up */
  loading: boolean;
}

/** Whether the master is open: only after an explicit toggle (the speaker
 *  glyph's click turns it off again), never in a hidden tab, never behind
 *  the loading screen. */
export function audible(s: SilenceInputs): boolean {
  return s.enabled && !s.hidden && !s.loading;
}

/** The master volume (linear) the soundscape starts at: quiet. */
export const MASTER_VOLUME = 0.32;
/** Time constant (s) of every level change: nothing jumps. */
export const RAMP_S = 0.4;
/** Time constant (s) of the master's fade in and out. */
export const FADE_S = 0.8;
