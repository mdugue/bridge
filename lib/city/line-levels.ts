/**
 * The levels of a site's railway and tram lines, solved with the whole
 * line in view (lib/city/levels.ts) — the build step's half
 * (scripts/line-levels.ts, run by scripts/prepare-data.ts). DOM-free,
 * THREE-free, pure.
 *
 * A tile's file holds pieces of the lines: the trams cut at the tile's
 * edge, the DLM's rails merged only from the segments the tile touches
 * (they run a little past it, and the neighbour's file has them again).
 * A layer solving a piece alone sees a gap or a fill that reaches past its
 * end from one side only and cannot tell it from a deck end. So each piece
 * is solved with its context: past each end, the line that runs on through
 * that end in another piece (any tile's, a switch's straightest branch),
 * followed for LEVEL_CONTEXT_M. Only the piece's own samples are kept — as
 * its runs off the ground (`LevelRun`, the feature's `lv`), indexed by the
 * very samples the layer takes (`subdividePolyline` at LEVEL_STEP).
 */
import { type DeckPoly, decksAt } from "./decks";
import { epsgToWorld } from "./ground-clamp";
import {
  encodeRuns,
  LEVEL_CUT_M,
  LEVEL_GRADE,
  LEVEL_SPAN_M,
  LEVEL_STEP,
  type LevelLine,
  type LevelRun,
  type LevelSample,
  lineLevels,
} from "./levels";
import { type Point2, subdividePolyline } from "./polyline";

/** One piece of a line as a tile's file has it. */
export interface LinePiece {
  coords: Point2[];
  line: LevelLine;
  /** what the source says of the piece (OSM's bridge tag) */
  prefer?: "deck" | "ground";
}

/** What a line's height is read from. */
export interface LevelGround {
  /** the decks (`bridgeDecks`) in the world frame of `offset` */
  decks: DeckPoly[];
  heightAt: (x: number, y: number) => number | null;
  offset: { cx: number; cy: number };
}

/** The decks a line may ride: the heavy rails only rail decks (a road
 *  bridge over the tracks is not what the train runs on), a tram any. */
export const RIDES: Readonly<Record<LevelLine, readonly string[] | undefined>> =
  {
    rail: ["rail"],
    tram: undefined,
  };

/**
 * A deck this close beside a line (m) is one it may ride: a track laid
 * along a deck's edge runs a metre past its outline here and there (the
 * outline is the DLM's, the track OSM's).
 */
export const DECK_REACH_M = 2;

/** How far past a piece's end its context runs (m): a gap or a fill that
 *  reaches past the end is seen whole. */
export const LEVEL_CONTEXT_M = Math.max(LEVEL_SPAN_M, LEVEL_CUT_M) + 50;
/** A line runs on through an end within this distance (m)… */
const THROUGH_M = 1.5;
/** …in a direction this close to the end's own (cosine). */
const THROUGH_COS = 0.9;
/** Hops from piece to piece while gathering one end's context. */
const MAX_HOPS = 4;
/** The spatial index's cell (m). */
const CELL_M = 8;

/** The samples of a piece as its layer takes them. */
export function pieceSamples(piece: LinePiece): Point2[] {
  return subdividePolyline(piece.coords, LEVEL_STEP[piece.line]);
}

interface Sampled {
  line: LevelLine;
  pts: Point2[];
  prefer?: "deck" | "ground";
}

/** Every sample of every piece by grid cell. */
class SampleIndex {
  private cells = new Map<string, { piece: number; i: number }[]>();
  constructor(readonly pieces: readonly Sampled[]) {
    pieces.forEach((p, piece) => {
      p.pts.forEach((pt, i) => {
        const k = this.key(pt[0], pt[1]);
        let cell = this.cells.get(k);
        if (!cell) {
          cell = [];
          this.cells.set(k, cell);
        }
        cell.push({ piece, i });
      });
    });
  }
  private key(x: number, y: number): string {
    return `${Math.floor(x / CELL_M)}:${Math.floor(y / CELL_M)}`;
  }
  /** Samples of `line` within `r` of (x, y) on pieces other than `not`. */
  near(x: number, y: number, r: number, line: LevelLine, not: number) {
    const out: { piece: number; i: number }[] = [];
    const cx = Math.floor(x / CELL_M);
    const cy = Math.floor(y / CELL_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of this.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const p = this.pieces[s.piece];
          const pt = p.pts[s.i];
          if (
            s.piece !== not &&
            p.line === line &&
            Math.hypot(pt[0] - x, pt[1] - y) <= r
          ) {
            out.push(s);
          }
        }
      }
    }
    return out;
  }
}

/** The unit direction from a to b, or null for a zero step. */
function unit(a: Point2, b: Point2): Point2 | null {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
}

/** Context samples carried along from one piece. */
interface ContextPoint {
  piece: number;
  pt: Point2;
}

/**
 * The samples a line runs on through past the end `pts[end]` (heading
 * `dir`, outward), from other pieces, up to LEVEL_CONTEXT_M.
 */
function runOn(
  index: SampleIndex,
  from: number,
  at: Point2,
  dir: Point2,
  hops: number
): ContextPoint[] {
  const line = index.pieces[from].line;
  let best: { piece: number; step: 1 | -1; i: number; cos: number } | null =
    null;
  for (const s of index.near(at[0], at[1], THROUGH_M, line, from)) {
    const pts = index.pieces[s.piece].pts;
    const a = pts[Math.max(s.i - 1, 0)];
    const b = pts[Math.min(s.i + 1, pts.length - 1)];
    const t = unit(a, b);
    if (!t) {
      continue;
    }
    const cos = t[0] * dir[0] + t[1] * dir[1];
    const step = cos >= 0 ? 1 : -1;
    if (Math.abs(cos) >= THROUGH_COS && (!best || Math.abs(cos) > best.cos)) {
      best = { piece: s.piece, step, i: s.i, cos: Math.abs(cos) };
    }
  }
  if (!best) {
    return [];
  }
  const pts = index.pieces[best.piece].pts;
  const out: ContextPoint[] = [];
  let run = 0;
  let last = at;
  for (let i = best.i; i >= 0 && i < pts.length; i += best.step) {
    const pt = pts[i];
    // only what lies ahead of the end
    if ((pt[0] - at[0]) * dir[0] + (pt[1] - at[1]) * dir[1] <= 0.5) {
      continue;
    }
    run += Math.hypot(pt[0] - last[0], pt[1] - last[1]);
    last = pt;
    out.push({ piece: best.piece, pt });
    if (run >= LEVEL_CONTEXT_M) {
      return out;
    }
  }
  const tail = out.at(-1);
  const before = out.at(-2)?.pt ?? at;
  const heading = tail ? unit(before, tail.pt) : null;
  if (hops > 1 && tail && heading) {
    out.push(...runOn(index, best.piece, tail.pt, heading, hops - 1));
  }
  return out;
}

/** A piece's samples with its context either side. */
function withContext(
  index: SampleIndex,
  piece: number
): { pts: ContextPoint[]; own: number } {
  const pts = index.pieces[piece].pts;
  if (pts.length < 2) {
    return { pts: pts.map((pt) => ({ piece, pt })), own: 0 };
  }
  const startDir = unit(pts[1], pts[0]);
  const endDir = unit(pts.at(-2) ?? pts[0], pts.at(-1) ?? pts[0]);
  const before = startDir
    ? runOn(index, piece, pts[0], startDir, MAX_HOPS).reverse()
    : [];
  const after = endDir
    ? runOn(index, piece, pts.at(-1) ?? pts[0], endDir, MAX_HOPS)
    : [];
  return {
    pts: [...before, ...pts.map((pt) => ({ piece, pt })), ...after],
    own: before.length,
  };
}

/**
 * The runs off the ground (`LevelRun`) of every piece, in the pieces'
 * order: each piece's samples, with its context, solved as one line.
 */
export function solvePieces(
  pieces: readonly LinePiece[],
  ground: LevelGround
): LevelRun[][] {
  const sampled: Sampled[] = pieces.map((p) => ({
    line: p.line,
    pts: pieceSamples(p),
    prefer: p.prefer,
  }));
  const index = new SampleIndex(sampled);
  return sampled.map((p, piece) => {
    const { pts, own } = withContext(index, piece);
    let d = 0;
    const samples: LevelSample[] = pts.map((c, k) => {
      if (k > 0) {
        const q = pts[k - 1].pt;
        d += Math.hypot(c.pt[0] - q[0], c.pt[1] - q[1]);
      }
      const w = epsgToWorld(c.pt[0], c.pt[1], ground.offset);
      return {
        d,
        ground: ground.heightAt(c.pt[0], c.pt[1]),
        decks: decksAt(
          ground.decks,
          w.x,
          w.z,
          RIDES[p.line],
          "all",
          DECK_REACH_M
        ),
        prefer: sampled[c.piece].prefer,
      };
    });
    const levels = lineLevels(samples, { grade: LEVEL_GRADE[p.line] });
    return encodeRuns(levels.slice(own, own + p.pts.length));
  });
}
