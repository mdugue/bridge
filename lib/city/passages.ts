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
 *
 * A deck's bake asks for passages of its own (`under`, pipeline/bake/
 * bridge.py; photo QA B10, V13): every street and path the DGM closes under
 * a drawn deck, as wide as it is mapped, and the bridge a Land's DGM still
 * holds, opened across the deck down to the level ground either side.
 * `deckPassages` reads them; they open to the ground they run on, no
 * lower, and end square at their last points.
 */
import type { Point2 } from "./polyline";

/** A passage: the line through the fill (its rims included) and its level
 *  at each point. */
export interface Passage {
  coords: Point2[];
  /** its ends square at the first and last point, not rounded past them
   *  (a passage across a deck ends at the deck's edges) */
  flat?: boolean;
  /** how far under its level the floor is opened (m, PASSAGE_FLOOR_M) */
  floor?: number;
  /** half the passage's width (m) */
  half: number;
  y: number[];
}

/** One of a deck's baked passages (BridgeFeature `under`): its points
 *  (EPSG), the level at each, half its width. */
export interface DeckUnder {
  c: Point2[];
  h: number;
  y: number[];
}

/** The passages the decks' bake asks for (`under`), opened to their own
 *  level (the street under the deck meets its own level beyond it) with
 *  square ends. A deck is listed by each tile it reaches: pass each once. */
export function deckPassages(
  decks: readonly { properties?: { under?: readonly DeckUnder[] } | null }[]
): Passage[] {
  return decks.flatMap((f) =>
    (f.properties?.under ?? [])
      .filter((u) => u.c.length >= 2 && u.y.length === u.c.length && u.h > 0)
      .map((u) => ({
        coords: u.c.map(([x, y]): Point2 => [x, y]),
        flat: true,
        floor: 0,
        half: u.h,
        y: [...u.y],
      }))
  );
}

/** A cut opens a passage when at least this share of it lies under a
 *  drawn deck (any kind): the fill under a bridge, not a tunnel or a
 *  station's cover. The build opens it (scripts/line-levels.ts
 *  `sitePassages`), the rail layer draws the track through it. */
export const PASSAGE_UNDER_DECK = 0.3;

/** The passage floor lies this far under the line's level (m): the TIN's
 *  error, so no triangle closes it again. */
export const PASSAGE_FLOOR_M = 0.15;

/** Half a passage's width for a line of `tracks` tracks (m): 4 m between
 *  track centres and a shoulder of 1.5 m either side. */
export function passageHalf(tracks: number): number {
  return 2 * Math.max(1, tracks) + 1.5;
}

/** The nearest point of a polyline to (x, y): its distance and the level
 *  there (linear between the points). A flat passage reaches no point
 *  beyond its ends. */
function nearest(
  p: Passage,
  x: number,
  y: number
): { d: number; level: number } | null {
  let best: { d: number; level: number } | null = null;
  const last = p.coords.length - 2;
  for (let i = 0; i <= last; i++) {
    const [ax, ay] = p.coords[i];
    const [bx, by] = p.coords[i + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey;
    const along = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
    if (p.flat && ((i === 0 && along < 0) || (i === last && along > 1))) {
      continue;
    }
    const t = Math.min(1, Math.max(0, along));
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
    const floor = p.floor ?? PASSAGE_FLOOR_M;
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
          out[idx] = Math.min(out[idx], hit.level - floor);
        }
      }
    }
  }
  return out;
}
