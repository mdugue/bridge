/**
 * Passages through the fill under a deck: where a line has to pass under a
 * bridge but the DGM closes the way. DOM-free, THREE-free, pure.
 *
 * Under a deck no laser sees the ground, and the DGM fills it in — from
 * the embankment either side, or (where a Land's DGM keeps its bridges)
 * with the bridge itself. A track that runs under the deck then meets a
 * wall of ground: its level (lib/city/levels.ts) cuts through it ("cut"),
 * and the track would vanish into the hill. Where that cut lies under a
 * drawn deck, the terrain bake (scripts/bake-tiles.ts `shapeDgm`) opens
 * the passage: the ground along the line, as wide as its tracks, lowered
 * to the line's level — the clearance the bridge was built for. Nowhere
 * else: a cut no deck covers is a tunnel or a cover, and opening it would
 * cut a trench through a street.
 *
 * The passage's sides stand where the DGM stood: the ground beside a
 * passage is higher (the fill, the abutment) and stays; the ground beyond
 * its ends is the line's own and meets it. Nothing is raised.
 */
import type { Point2 } from "./polyline";

/** A passage: the line through the fill (its rims included) and its level
 *  at each point. */
export interface Passage {
  coords: Point2[];
  /** half the passage's width (m) */
  half: number;
  y: number[];
}

/** The passage floor lies this far under the line's level (m): the TIN's
 *  error, so no triangle closes it again. */
export const PASSAGE_FLOOR_M = 0.15;

/** Half a passage's width for a line of `tracks` tracks (m): 4 m between
 *  track centres and a shoulder of 1.5 m either side. */
export function passageHalf(tracks: number): number {
  return 2 * Math.max(1, tracks) + 1.5;
}

/** The nearest point of a polyline to (x, y): its distance and the level
 *  there (linear between the points). */
function nearest(
  p: Passage,
  x: number,
  y: number
): { d: number; level: number } | null {
  let best: { d: number; level: number } | null = null;
  for (let i = 0; i + 1 < p.coords.length; i++) {
    const [ax, ay] = p.coords[i];
    const [bx, by] = p.coords[i + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey;
    const t =
      l2 > 0
        ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / l2))
        : 0;
    const d = Math.hypot(ax + ex * t - x, ay + ey * t - y);
    if (!best || d < best.d) {
      best = { d, level: p.y[i] + (p.y[i + 1] - p.y[i]) * t };
    }
  }
  return best;
}

/** The grid (row 0 = north, cell centres) with every passage opened. */
export function carvePassages(input: {
  bounds: readonly [number, number, number, number];
  elevations: Float32Array;
  n: number;
  passages: readonly Passage[];
}): Float32Array {
  const { elevations, n, bounds, passages } = input;
  const out = Float32Array.from(elevations);
  const [minX, minY, maxX, maxY] = bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  for (const p of passages) {
    if (p.coords.length < 2) {
      continue;
    }
    const xs = p.coords.map((c) => c[0]);
    const ys = p.coords.map((c) => c[1]);
    const col0 = Math.max(
      0,
      Math.floor((Math.min(...xs) - p.half - minX) / dx)
    );
    const col1 = Math.min(
      n - 1,
      Math.ceil((Math.max(...xs) + p.half - minX) / dx)
    );
    const row0 = Math.max(
      0,
      Math.floor((maxY - Math.max(...ys) - p.half) / dy)
    );
    const row1 = Math.min(
      n - 1,
      Math.ceil((maxY - Math.min(...ys) + p.half) / dy)
    );
    for (let row = row0; row <= row1; row++) {
      const y = maxY - (row + 0.5) * dy;
      for (let col = col0; col <= col1; col++) {
        const x = minX + (col + 0.5) * dx;
        const hit = nearest(p, x, y);
        const idx = row * n + col;
        if (hit && hit.d <= p.half && Number.isFinite(out[idx])) {
          out[idx] = Math.min(out[idx], hit.level - PASSAGE_FLOOR_M);
        }
      }
    }
  }
  return out;
}
