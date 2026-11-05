import { epsgToWorld } from "./ground-clamp";
import { clamp } from "./math";
/**
 * The sun's shadow rings: where each of the four squares of the shadow map
 * stands, when it is redrawn, and how far it shows. Pure math, no three
 * (`sun-rings.ts` applies it, ADR 0009).
 *
 * Concentric squares of the same resolution, each three times as wide as the
 * one inside it: the texels are fine round the camera and grow with the
 * distance, as a screen's pixels do, and they depend on neither the view's
 * direction nor the sun's, which is what a map warped over the view could not
 * do (at a low sun, looking along its light, its texels were ten times as
 * wide). A square stands still until its centre has drifted a share of its
 * size, so a small one redraws often with few casters and a large one rarely
 * with many.
 *
 * Coordinates: world Y-up (the scene frame, never the rotated data group).
 */

/** The squares' half-sizes (m), finest first: at 2048² 0.08, 0.23, 0.7 and
 *  2.1 m a texel across the light (along it wider, by 1 / sin of the sun's
 *  elevation). */
export const SHADOW_RING_HALVES = [80, 240, 720, 2160] as const;

/** How many squares there are: the layers of the map's depth array. */
export const SHADOW_RINGS = SHADOW_RING_HALVES.length;

/**
 * How many of the finest rings draw a thin caster, by how thin it is. `tiny`
 * is what a coarser ring's texel is wider than in every direction (kerbs,
 * benches, tree stakes): there its shadow would only be a smear of the
 * filter's samples, so it fades out across the finest ring's edge. `slender`
 * is thin but long (lamp posts, masts): under a low sun its shadow is a line
 * that still reads, soft and faint, across the third ring's 0.7 m texels. The
 * widest ring draws neither.
 */
export const THIN_CASTER_RINGS = { slender: 3, tiny: 1 } as const;

/** How many of the finest rings a furniture cell's flip asks to redraw: the
 *  ones that draw any furniture (`THIN_CASTER_RINGS.slender`), not the widest
 *  with its buildings and crowns. */
export const NEAR_CHANGE_RINGS = THIN_CASTER_RINGS.slender;

/** The PCF spread in texels (three's `shadow.radius`). Five samples spread
 *  wider than this leave gaps a thin shadow shows as a stipple. */
export const RING_PCF_RADIUS = 2.5;

/** The depth bias per ring, in texels of it: what a caster nearer its
 *  receiver loses. 0.09 m on the finest. */
const RING_BIAS_TEXELS = 1.1;
/** … and never more than this (m): on a low safety level's coarse rings a bias
 *  of a texel would cost low buildings their whole shadow. */
const RING_MAX_BIAS_M = 2.5;

/** The share of its half-size a square's wanted centre may drift before it
 *  is redrawn. */
const RING_DEAD_ZONE = 0.2;

/** A flying camera's square is pushed this share of its half-size along the
 *  view's heading. */
const RING_AHEAD = 0.5;
/** Up to this height (m) the squares stay round the camera, so that turning
 *  on the spot redraws nothing on foot … */
const AHEAD_FROM_M = 8;
/** … and over this share of its half-size above that a square takes its
 *  full push. */
const AHEAD_RAMP = 0.25;

/** A ring fades out as the camera climbs, from this many half-sizes up … */
const FADE_FROM_HALVES = 1.5;
/** … to this many: by then its texels are finer than the pixels it covers.
 *  The widest ring never goes. */
const FADE_TO_HALVES = 2.5;

/** How high casters reach over the ground under the square (m): towers, and
 *  the hill they stand on. */
const CASTER_RISE_M = 450;
/** How far receivers lie under it (m): a river bed in a valley. */
const RECEIVER_DIP_M = 120;
/** The sun is never taken lower than this (sin of its elevation) for the
 *  depth range, which grows as 1 / sin. */
const MIN_SUN_Y = 0.05;
/** The depth range never reaches further from the ground than this (m). */
const MAX_DEPTH_M = 12_000;

/** The least time (ms) between two redraws of a ring: a stream of landing
 *  tiles asks for all of them at every landing, and the wide ones draw every
 *  caster in sight. */
const RING_MIN_GAP_MS = [0, 0, 250, 500];

/** A ring cross-fades over this band inside its edge (in the map's 0…1). The
 *  band starts a little in: the filter's samples must stay on the ring. */
export const RING_EDGE_FROM = 0.01;
export const RING_EDGE_TO = 0.07;

/** Modell's quadrants overlap this share of their half-size: enough that each
 *  one's cross-fade band lies wholly inside its neighbour's full strength, or
 *  light would leak through the seam. */
const QUADRANT_OVERLAP = 0.2;
/** Modell's square is this much wider than its fit: the picture may outgrow
 *  the fit by its hysteresis and drift by a tile's dead zone before they
 *  follow (`MODEL_DEAD_ZONE`). */
const MODEL_MARGIN = 1.2;
/** The share of its half-size a tile of Modell's square may drift. */
const MODEL_DEAD_ZONE = 0.1;

/** A point (world, Y-up). */
export interface RingPoint {
  x: number;
  y: number;
  z: number;
}

/** Height over the ground and what the view's heading adds to a focus. */
export interface RingView {
  /** the camera's look direction, x and z: NOT renormalized, so looking
   *  straight down pushes nothing */
  dirX: number;
  dirZ: number;
  /** the camera (world) */
  eyeX: number;
  eyeZ: number;
  /** the ground under the camera (world y) */
  groundY: number;
  /** the camera's height over that ground (m) */
  height: number;
}

/** How far along the heading a square of `half` is pushed at `height`. */
export function ringAhead(half: number, height: number): number {
  const ramp = clamp((height - AHEAD_FROM_M) / (half * AHEAD_RAMP), 0, 1);
  return half * RING_AHEAD * ramp;
}

/** Where a square of `half` wants its centre for `view`, written to `out`
 *  (this runs per ring in every frame). */
export function ringFocus(
  half: number,
  view: RingView,
  out: RingPoint
): RingPoint {
  const ahead = ringAhead(half, view.height);
  out.x = view.eyeX + view.dirX * ahead;
  out.y = view.groundY;
  out.z = view.eyeZ + view.dirZ * ahead;
  return out;
}

/** How much of ring `index` shows from `height`: 1, then down to 0 where its
 *  texels no longer serve; the widest ring always shows. */
export function ringFade(index: number, height: number): number {
  if (index >= SHADOW_RINGS - 1) {
    return 1;
  }
  const half = SHADOW_RING_HALVES[index];
  const t = clamp(
    (height - half * FADE_FROM_HALVES) /
      (half * (FADE_TO_HALVES - FADE_FROM_HALVES)),
    0,
    1
  );
  return 1 - t * t * (3 - 2 * t);
}

/** The coarsest texel (m) that still draws what the baked horizon's near band
 *  knows, occluders 8–80 m off. It also keeps the band on where only the widest
 *  ring reads: casters that far off are often not loaded, and it knows them. */
const NEAR_BAND_TEXEL_M = 2;

/** The widest ring whose texels on a map of `mapEdge` still draw that. */
export function ringForNearBand(mapEdge: number): number {
  let ring = 0;
  for (let i = 0; i < SHADOW_RINGS; i += 1) {
    if ((SHADOW_RING_HALVES[i] * 2) / mapEdge <= NEAR_BAND_TEXEL_M) {
      ring = i;
    }
  }
  return ring;
}

/** The drift (m) a square of `half` allows before it is redrawn. */
export function ringDeadZone(half: number, tiled = false): number {
  return half * (tiled ? MODEL_DEAD_ZONE : RING_DEAD_ZONE);
}

/** A square's depth range along the light, from its centre (m): what stands
 *  over the ground under its far edge, seen along a low sun, still falls on
 *  it. */
export function ringDepth(
  half: number,
  sunY: number
): { down: number; up: number } {
  const sin = Math.max(sunY, MIN_SUN_Y);
  const across = (half * Math.sqrt(1 - sin * sin)) / sin;
  return {
    down: Math.min(across + RECEIVER_DIP_M / sin, MAX_DEPTH_M),
    up: Math.min(across + CASTER_RISE_M / sin, MAX_DEPTH_M),
  };
}

/** A square's depth bias in depth units over a `range` (m) of depth. */
export function ringBias(half: number, mapEdge: number, range: number): number {
  const metres = (RING_BIAS_TEXELS * (half * 2)) / mapEdge;
  return -Math.min(metres, RING_MAX_BIAS_M) / range;
}

/** The light's axes as the shadow camera takes them (three's `lookAt` with
 *  `up` = y): `z` toward the sun. */
function lightAxes(sun: RingPoint): { x: RingPoint; y: RingPoint } {
  // up × z, the world's up; a sun at the zenith has no such axis
  let xx = sun.z;
  let xz = -sun.x;
  const len = Math.hypot(xx, xz);
  if (len < 1e-6) {
    xx = 1;
    xz = 0;
  } else {
    xx /= len;
    xz /= len;
  }
  // z × x
  return {
    x: { x: xx, y: 0, z: xz },
    y: {
      x: sun.y * xz,
      y: sun.z * xx - sun.x * xz,
      z: -sun.y * xx,
    },
  };
}

const dot = (a: RingPoint, b: RingPoint) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * `point` moved onto the texel grid of a map whose texels are `texel` m wide,
 * across the light. The grid stands in light space, so that a square redrawn
 * further on lands its texels on the same ground and no shadow's edge crawls.
 */
export function snapToTexels(
  point: RingPoint,
  sun: RingPoint,
  texel: number
): RingPoint {
  const { x, y } = lightAxes(sun);
  const dx = Math.round(dot(point, x) / texel) * texel - dot(point, x);
  const dy = Math.round(dot(point, y) / texel) * texel - dot(point, y);
  return {
    x: point.x + x.x * dx + y.x * dy,
    y: point.y + x.y * dx + y.y * dy,
    z: point.z + x.z * dx + y.z * dy,
  };
}

/**
 * Modell's parallel view has one scale across its picture, so the rings' fine
 * middle would show as a patch: there the four layers tile the picture's
 * square instead, 2 × 2, each a quarter of it (and its share of overlap).
 */
export function modelQuadrants(
  centre: RingPoint,
  radius: number,
  sun: RingPoint
): { depthHalf: number; focus: RingPoint[]; half: number; reach: number } {
  const { x, y } = lightAxes(sun);
  const q = (radius * MODEL_MARGIN) / 2;
  const at = (sx: number, sy: number): RingPoint => ({
    x: centre.x + (x.x * sx + y.x * sy) * q,
    y: centre.y + (x.y * sx + y.y * sy) * q,
    z: centre.z + (x.z * sx + y.z * sy) * q,
  });
  const half = q * (1 + QUADRANT_OVERLAP);
  return {
    // a quadrant's depth is measured from the picture's centre, not its own
    depthHalf: q + half,
    half,
    // where the outermost tiles still hold at full strength
    reach: q + half * (1 - 2 * RING_EDGE_TO),
    focus: [at(-1, -1), at(1, -1), at(-1, 1), at(1, 1)],
  };
}

/** An area of the ground (world, Y-up): a tile, in plan. */
export interface RingArea {
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
}

/**
 * Whether what stands on `area` can fall on a ring: seen along the light, from
 * the ground to the casters' top, does the area meet the ring's square?
 */
export function ringTouches(
  centre: RingPoint,
  half: number,
  area: RingArea,
  sun: RingPoint
): boolean {
  const { x, y } = lightAxes(sun);
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const px of [area.minX, area.maxX]) {
    for (const pz of [area.minZ, area.maxZ]) {
      for (const py of [centre.y - RECEIVER_DIP_M, centre.y + CASTER_RISE_M]) {
        const p = { x: px, y: py, z: pz };
        minU = Math.min(minU, dot(p, x));
        maxU = Math.max(maxU, dot(p, x));
        minV = Math.min(minV, dot(p, y));
        maxV = Math.max(maxV, dot(p, y));
      }
    }
  }
  const u = dot(centre, x);
  const v = dot(centre, y);
  return (
    minU <= u + half && maxU >= u - half && minV <= v + half && maxV >= v - half
  );
}

/** What stands on a tile may reach this far past its bounds (m): a bridge, a
 *  building owned by the tile its centre lies on. */
const TILE_OVERHANG_M = 300;

/** A tile's area in world coordinates, with its overhang, from its bounds in
 *  the data's CRS (E, N, E, N). */
export function tileArea(
  bounds: readonly [number, number, number, number],
  offset: { cx: number; cy: number }
): RingArea {
  const min = epsgToWorld(bounds[0], bounds[3], offset);
  const max = epsgToWorld(bounds[2], bounds[1], offset);
  return {
    maxX: max.x + TILE_OVERHANG_M,
    maxZ: max.z + TILE_OVERHANG_M,
    minX: min.x - TILE_OVERHANG_M,
    minZ: min.z - TILE_OVERHANG_M,
  };
}

/**
 * The tiles whose shown parts changed between two lists (a part and its tile).
 * The stream reports every tile that comes into or leaves view, and most of
 * those reports change nothing that casts.
 */
export function changedTiles<K>(
  before: ReadonlyMap<K, string>,
  now: ReadonlyMap<K, string>
): Set<string> {
  const changed = new Set<string>();
  for (const [part, tile] of now) {
    if (!before.has(part)) {
      changed.add(tile);
    }
  }
  for (const [part, tile] of before) {
    if (!now.has(part)) {
      changed.add(tile);
    }
  }
  return changed;
}

/** What the scheduler knows of a ring. */
export interface RingQueueEntry {
  /** when the ring was first asked to redraw (ms), null when it need not */
  dirtySince: number | null;
  /** when it was last drawn (ms) */
  drawnAt: number;
}

/**
 * The ring to draw next (its index), −1 when none is due: the one waiting
 * longest, so that a stream of requests starves none; one a frame, so that
 * the depth passes never pile into a frame.
 */
export function nextRingDue(
  rings: readonly RingQueueEntry[],
  now: number,
  /** Modell's tiles are all alike: none of them draws everything */
  paced = true
): number {
  let best = -1;
  let since = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rings.length; i += 1) {
    const { dirtySince, drawnAt } = rings[i];
    if (
      dirtySince !== null &&
      dirtySince < since &&
      (!paced || now - drawnAt >= (RING_MIN_GAP_MS[i] ?? 0))
    ) {
      best = i;
      since = dirtySince;
    }
  }
  return best;
}
