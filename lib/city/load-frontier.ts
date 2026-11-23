/**
 * The loading frontier: how far from the camera the scene is complete, and
 * how the picture shows it (app/_components/load-veil.ts). No THREE, no DOM.
 *
 * Whatever is still on its way — a tile content the renderer is fetching or
 * parsing, a fine tile's dressing still queued or building — belongs to a
 * site tile. The frontier is the horizontal distance from the camera to the
 * nearest such tile: everything closer is in, everything beyond may not
 * be. Since the stream loads nearer before farther (stream-order.ts), the
 * frontier walks outward as the city fills in, and the picture draws it as
 * one ring: colour inside, the unfired clay of "not yet" outside.
 *
 * `stepVeil` turns that truth into what a frame draws: the ring eases to
 * the frontier rather than jumping a tile's width at once, and once nothing
 * is pending it sweeps out to the horizon and the veil lifts. A top-up
 * during a flight that ends within `VEIL_DELAY_S` never shows.
 */
import type { TerrainBounds } from "./terrain-geometry";

/** Horizontal distance (m) from a point to a tile's rectangle; 0 inside. */
export function distanceToBounds(
  [minX, minY, maxX, maxY]: TerrainBounds,
  x: number,
  y: number
): number {
  const dx = Math.max(minX - x, 0, x - maxX);
  const dy = Math.max(minY - y, 0, y - maxY);
  return Math.hypot(dx, dy);
}

/**
 * The frontier (m) for a camera at data-frame `x`, `y` (the provider's
 * UTM): the distance to the nearest of `pending` site tiles, or null when
 * nothing is pending. A pending id with no known bounds is ignored.
 */
export function loadFrontier(
  bounds: ReadonlyMap<string, TerrainBounds>,
  pending: Iterable<string>,
  x: number,
  y: number
): number | null {
  let nearest: number | null = null;
  for (const id of pending) {
    const b = bounds.get(id);
    if (!b) {
      continue;
    }
    const d = distanceToBounds(b, x, y);
    nearest = nearest === null ? d : Math.min(nearest, d);
  }
  return nearest;
}

/**
 * How far (m) the boot's ring reaches at full progress: about where the
 * fine level gives way to the coarse one (tileset.ts
 * `COARSE_TERRAIN_ERROR`), the farthest the details reach.
 */
export const BOOT_REACH_M = 2600;
/** Where the boot's ring starts (m): just beyond the walker's feet. */
export const BOOT_NEAR_M = 40;

/**
 * The boot's ring by progress: until the first load is through, the ring
 * stands where `progress` (0..1, what the HUD's last two stages report)
 * says, from `BOOT_NEAR_M` out to `BOOT_REACH_M`. A site tile is 2 km wide,
 * and the one under the camera stays pending until its own details are
 * built, so the frontier alone would hold the whole view in clay until
 * then — and, once that tile is in, jump past the horizon at once while
 * the far tiles still come. The stream loads nearer first, so progress
 * walks outward much as the frontier would at a finer grain.
 *
 * It walks in distance's logarithm, not in metres: how far below the
 * horizon a ring on the ground stands goes as height over distance, so
 * equal steps of progress move it by about equal steps on the screen.
 * In metres it would cross the near half of the view in the first tenth
 * of the load and spend the rest a hair's breadth under the horizon.
 * The sweep waits for the load's end (create-app.ts).
 */
export function bootFrontier(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return BOOT_NEAR_M * (BOOT_REACH_M / BOOT_NEAR_M) ** p;
}

/** A pending spell shorter than this (s) never brings the veil in. */
export const VEIL_DELAY_S = 1.2;
/** The ring's time constant (s) as it eases to a new frontier. */
const RING_EASE_S = 0.7;
/** How fast the veil comes in, and goes after the sweep (per second). */
const VEIL_IN_PER_S = 1.6;
const VEIL_OUT_PER_S = 0.9;
/**
 * The final sweep: once nothing is pending the ring runs out to the
 * horizon — at least this fast (m/s), and faster the farther it is, so the
 * last colours flood out in about a second from wherever the ring stood.
 */
const SWEEP_MIN_M_S = 400;
const SWEEP_GAIN_PER_S = 2.2;
/** Where the sweep counts as at the horizon: the veil fades from here. */
export const VEIL_HORIZON_M = 6000;

export interface VeilState {
  /** the ring's radius (m) as drawn */
  radius: number;
  /** 0 = no veil, 1 = full */
  strength: number;
  /** how long (s) the current pending spell has lasted */
  pendingFor: number;
}

/** The boot's state: veiled from the first frame, the ring at the feet. */
export const BOOT_VEIL: VeilState = { radius: 0, strength: 1, pendingFor: 0 };

/** The state with nothing shown. */
export const NO_VEIL: VeilState = {
  radius: VEIL_HORIZON_M,
  strength: 0,
  pendingFor: 0,
};

/** One frame of the veil: `frontier` as `loadFrontier` gave it. */
export function stepVeil(
  prev: VeilState,
  frontier: number | null,
  dt: number
): VeilState {
  const step = Math.max(0, dt);
  if (frontier === null) {
    // Nothing pending: sweep out, then lift.
    const radius = Math.min(
      VEIL_HORIZON_M,
      prev.radius +
        Math.max(SWEEP_MIN_M_S, prev.radius * SWEEP_GAIN_PER_S) * step
    );
    const strength =
      radius >= VEIL_HORIZON_M || prev.strength <= 0
        ? Math.max(0, prev.strength - VEIL_OUT_PER_S * step)
        : prev.strength;
    return { radius, strength, pendingFor: 0 };
  }
  const pendingFor = prev.pendingFor + step;
  // A veil that is off, or lifting after its sweep, waits out the delay
  // (still lifting), and comes in at the frontier (no sweep inward from
  // the horizon).
  if (prev.strength <= 0 || prev.radius >= VEIL_HORIZON_M) {
    if (pendingFor < VEIL_DELAY_S) {
      return {
        radius: prev.radius,
        strength: Math.max(0, prev.strength - VEIL_OUT_PER_S * step),
        pendingFor,
      };
    }
    return {
      radius: frontier,
      strength: Math.min(1, prev.strength + VEIL_IN_PER_S * step),
      pendingFor,
    };
  }
  const ease = 1 - Math.exp(-step / RING_EASE_S);
  return {
    radius: prev.radius + (frontier - prev.radius) * ease,
    strength: Math.min(1, prev.strength + VEIL_IN_PER_S * step),
    pendingFor,
  };
}
