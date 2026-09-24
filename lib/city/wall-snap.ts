/**
 * Snaps a wall ribbon to the step the elevation data actually has — the
 * TIN ground's alternative to burning the OSM line into the ground
 * (terrain-conflate.ts, now only for heightfield tiles). DOM-free, THREE-free, pure.
 *
 * On the native 1 m DGM the tall retaining walls are already a 1–2 m ramp
 * (the terrain study, docs/transformations.md "Terrain TIN"), but the OSM
 * line is not always ON it: across seven of the tallest walls in the primary
 * tile the measured step sits −0.5 … +1.0 m from the line, and at the
 * Jungfernbastei's south face 4 m off. So instead of moving the ground to the
 * line, the ribbon moves to the ground: at each wall vertex we scan the
 * terrain across the line, find the steepest metre, and read the two shelf
 * levels just beyond it. The ribbon then becomes a solid block that swallows
 * the DGM's ramp — its face stands just in front of the ramp's FOOT on the
 * low shelf, and a coping cap runs back at the high shelf to the CREST — so
 * neither the smeared ramp nor a slot behind the ribbon shows.
 *
 * One vertex's scan is noisy (a stair, a lamp base, the next terrace level
 * can win the "steepest metre"), and a ribbon whose face hops half a metre
 * between vertices reads as a zigzag. `smoothSnaps` therefore takes running
 * medians along the wall and drops snaps the neighbourhood disagrees with.
 */

export interface StepSnap {
  /** offset (m, along +perp) of the crest — where the high shelf begins */
  crest: number;
  /** offset (m, along +perp) of the foot — where the ramp leaves the low shelf */
  foot: number;
  /** high / low shelf elevations (m) */
  hi: number;
  lo: number;
  /** +1 when the high side is +perp, −1 when it is −perp */
  up: number;
}

/** How far across the OSM line to look for the measured step (m). */
const REACH_M = 6;
/** Scan step (m). */
const SCAN_M = 0.25;
/** Window over which the steepest drop is measured (m). */
const WINDOW_M = 1;
/** Shelf levels are read this far beyond the steepest point (m). */
const SHELF_M = 2.5;
/** A drop smaller than this is no retaining step (kerbs, rims, noise). */
const MIN_STEP_M = 1.5;
/** The foot / crest is where the ramp comes within this of its shelf (m). */
const SHELF_TOLERANCE_M = 0.2;

type HeightAt = (x: number, y: number) => number | null;

interface Scan {
  z: number[];
}

function scanAcross(
  heightAt: HeightAt,
  x: number,
  y: number,
  px: number,
  py: number
): Scan | null {
  const z: number[] = [];
  const reach = REACH_M + SHELF_M;
  const steps = Math.round((2 * reach) / SCAN_M);
  for (let k = 0; k <= steps; k++) {
    const s = -reach + k * SCAN_M;
    const h = heightAt(x + px * s, y + py * s);
    if (h === null) {
      return null;
    }
    z.push(h);
  }
  return { z };
}

/** Scan index → offset along +perp (m). */
function offsetOf(k: number): number {
  return -(REACH_M + SHELF_M) + k * SCAN_M;
}

/** Index of the centre of the steepest WINDOW_M window within REACH_M of the
 *  line, and its signed rise (towards +perp). */
function steepest(scan: Scan): { i: number; rise: number } {
  const w = Math.round(WINDOW_M / SCAN_M / 2);
  const first = Math.round(SHELF_M / SCAN_M);
  const last = scan.z.length - 1 - first;
  let best = 0;
  let at = -1;
  for (
    let i = Math.max(first, w);
    i <= Math.min(last, scan.z.length - 1 - w);
    i++
  ) {
    const d = scan.z[i + w] - scan.z[i - w];
    if (Math.abs(d) > Math.abs(best)) {
      best = d;
      at = i;
    }
  }
  return { i: at, rise: best };
}

/** Walks from index `k0` in direction `dir` until the ramp is within
 *  SHELF_TOLERANCE_M of `level` (at most SHELF_M); returns that offset. */
function shelfEdge(
  scan: Scan,
  k0: number,
  dir: number,
  reached: (z: number) => boolean
): number {
  const n = Math.round(SHELF_M / SCAN_M);
  for (let k = 1; k <= n; k++) {
    if (reached(scan.z[k0 + dir * k])) {
      return offsetOf(k0 + dir * k);
    }
  }
  return offsetOf(k0 + dir * n);
}

/**
 * The measured step near a wall vertex at (x, y) with unit perpendicular
 * (px, py), or null when the terrain has no step of at least MIN_STEP_M
 * within REACH_M of the line (freestanding walls, rims — or data too blurred
 * to tell, where the caller keeps its old placement).
 */
export function snapToStep(
  heightAt: HeightAt,
  x: number,
  y: number,
  px: number,
  py: number
): StepSnap | null {
  const scan = scanAcross(heightAt, x, y, px, py);
  if (!scan) {
    return null;
  }
  const { i, rise } = steepest(scan);
  if (i < 0) {
    return null;
  }
  const up = rise > 0 ? 1 : -1;
  const shelf = Math.round(SHELF_M / SCAN_M);
  const hi = scan.z[i + up * shelf];
  const lo = scan.z[i - up * shelf];
  if (hi - lo < MIN_STEP_M) {
    return null;
  }
  return {
    up,
    hi,
    lo,
    crest: shelfEdge(scan, i, up, (z) => z >= hi - SHELF_TOLERANCE_M),
    foot: shelfEdge(scan, i, -up, (z) => z <= lo + SHELF_TOLERANCE_M),
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The foot a face must stand in front of: the 20th percentile toward the
 *  low side (−up) — a median would leave every locally wider stretch of the
 *  ramp (stairs down the quay, a buttress) poking through the face as a
 *  spike; the outermost value would let one stray scan drag a whole run
 *  out. */
function outerFoot(feet: number[], up: number): number {
  const s = [...feet].sort((a, b) => (a - b) * up);
  return s[Math.floor(s.length * 0.2)];
}

/** The snaps within `radius` of `i` that agree with the window's majority
 *  high side, or null when fewer than half the window snapped at all. */
function agreeingNeighbours(
  snaps: (StepSnap | null)[],
  i: number,
  radius: number
): StepSnap[] | null {
  const lo = Math.max(0, i - radius);
  const hi = Math.min(snaps.length - 1, i + radius);
  const near: StepSnap[] = [];
  for (let k = lo; k <= hi; k++) {
    const s = snaps[k];
    if (s) {
      near.push(s);
    }
  }
  if (near.length * 2 <= hi - lo + 1) {
    return null;
  }
  const ups = near.reduce((sum, s) => sum + s.up, 0);
  const up = ups >= 0 ? 1 : -1;
  const agree = near.filter((s) => s.up === up);
  return agree.length * 2 > near.length ? agree : null;
}

/**
 * Running medians of the per-vertex snaps along one wall (`radius` vertices
 * either side). A vertex whose neighbourhood mostly failed to snap, or
 * disagrees on which side is high, gets null (the caller's fallback); a gap
 * inside a well-snapped run is filled from its neighbours, so the ribbon
 * does not hop back to the OSM line for one vertex.
 */
export function smoothSnaps(
  snaps: (StepSnap | null)[],
  radius = 3
): (StepSnap | null)[] {
  return snaps.map((_, i) => {
    const agree = agreeingNeighbours(snaps, i, radius);
    if (!agree) {
      return null;
    }
    const up = agree[0].up;
    return {
      up,
      hi: median(agree.map((s) => s.hi)),
      lo: median(agree.map((s) => s.lo)),
      foot: outerFoot(
        agree.map((s) => s.foot),
        up
      ),
      crest: median(agree.map((s) => s.crest)),
    };
  });
}
