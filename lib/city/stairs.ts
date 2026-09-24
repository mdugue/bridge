/**
 * Stairs from OSM `highway=steps` (pipeline/bake/stairs.py): the flight's
 * profile, the terrain burn under it, and the step geometry. DOM-free,
 * THREE-free, pure — the WebGL layer (stair-layer.ts) wraps the arrays.
 *
 * The problem is the wall problem at a smaller scale: the DGM1 smooths a
 * flight of steps into a bank (the one next to the Italienisches Dörfchen
 * read as a grassy slope). The bake gives each flight its axis (bottom →
 * top), width, step count and the two landing heights; here
 *
 * - `burnStairs` lowers the terrain grid under the flight to just below the
 *   ramp through the steps' inner corners, so no ground pokes through a
 *   tread (only ever lowers; a narrow margin beside the flight may sink by
 *   at most `MARGIN_DIG_M`, so a flight along a retaining wall does not dig
 *   into the terrace above it);
 * - `stairGeometry` builds the flight as solid blocks: a tread per step, a
 *   riser at each step's front and the two side cheeks, all reaching below
 *   the burned ground.
 *
 * Step k (0-based) spans [k, k+1]·L/n along the axis with its tread at
 * z0 + (k+1)·rise, so the last tread is the top landing and every tread
 * lies on or above the ramp z0 → z1.
 */
import type { StairFeature } from "./features";
import type { RecenterOffset } from "./ground-clamp";
import type { Point2 } from "./polyline";
import { isInvalidElevation, type TerrainBounds } from "./terrain-geometry";

export interface StairLine {
  /** axis, bottom → top, EPSG coordinates (NOT recentered) */
  coords: Point2[];
  /** number of steps (risers) */
  n: number;
  /** bottom and top landing elevations (m) */
  z: [number, number];
  /** width (m) */
  w: number;
}

/** How far below the ramp the burn puts the ground (m). */
export const STAIR_BURN_M = 0.12;
/** The most the margin beside a flight may sink (m). */
export const MARGIN_DIG_M = 0.5;
/** How far below the ramp the cheeks and the first riser reach (m). */
const BURY_M = 0.6;

/** The bake's feature as a flight, or null when it is not one. */
export function stairLineOf(f: StairFeature): StairLine | null {
  const p = f.properties;
  const coords = f.geometry?.coordinates;
  if (
    f.geometry?.type !== "LineString" ||
    !coords ||
    coords.length < 2 ||
    !p ||
    !(p.w > 0 && p.n >= 1) ||
    p.z?.length !== 2 ||
    !p.z.every(Number.isFinite)
  ) {
    return null;
  }
  return { coords, n: Math.round(p.n), w: p.w, z: [p.z[0], p.z[1]] };
}

/** Cumulative arc length at each vertex. */
function arcLengths(coords: Point2[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    out.push(out[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  return out;
}

/** The point halfway along the axis: the tile owning it stands the flight. */
export function axisMiddle(coords: Point2[]): Point2 {
  const lengths = arcLengths(coords);
  const half = (lengths.at(-1) ?? 0) / 2;
  for (let i = 1; i < coords.length; i++) {
    if (lengths[i] >= half) {
      const t = (half - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
      const [x0, y0] = coords[i - 1];
      const [x1, y1] = coords[i];
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
  }
  return coords[0];
}

/** The ramp through the steps' inner corners at arc length s. */
function rampAt(stair: StairLine, s: number, length: number): number {
  const t = length > 0 ? Math.min(Math.max(s / length, 0), 1) : 0;
  return stair.z[0] + (stair.z[1] - stair.z[0]) * t;
}

/** Where a point projects onto the axis: arc length and distance, or null
 *  when it lies beyond either end. */
export function projectOntoAxis(
  coords: Point2[],
  x: number,
  y: number
): { d: number; s: number } | null {
  const lengths = arcLengths(coords);
  let best: { d: number; s: number; beyond: boolean } | null = null;
  const last = coords.length - 2;
  for (let i = 0; i <= last; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const len = lengths[i + 1] - lengths[i];
    if (len === 0) {
      continue;
    }
    const raw = ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len);
    const t = Math.min(Math.max(raw, 0), 1);
    const d = Math.hypot(x - (x0 + (x1 - x0) * t), y - (y0 + (y1 - y0) * t));
    if (!best || d < best.d) {
      const beyond = (i === 0 && raw < 0) || (i === last && raw > 1);
      best = { d, s: lengths[i] + t * len, beyond };
    }
  }
  return best && !best.beyond ? { d: best.d, s: best.s } : null;
}

export interface StairBurnInput {
  /** [minX, minY, maxX, maxY] in the projected CRS — same as the terrain mesh */
  bounds: TerrainBounds;
  /** n*n elevation samples, row-major, row 0 = north */
  elevations: ArrayLike<number>;
  /** grid size (n x n) */
  n: number;
  stairs: StairLine[];
}

/**
 * Lowers the grid under every flight to `STAIR_BURN_M` below its ramp, in a
 * COPY of the elevations. Cells within half the width (+ half a cell) of the
 * axis sink as far as that takes; cells up to a cell and a half further out
 * — the triangles that reach under the flight's edge — by at most
 * `MARGIN_DIG_M`. NoData stays NoData; nothing is ever raised.
 */
export function burnStairs(input: StairBurnInput): Float32Array {
  const { elevations, n, bounds, stairs } = input;
  const out = Float32Array.from(elevations);
  const [minX, minY, maxX, maxY] = bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  const cell = Math.max(dx, dy);
  for (const stair of stairs) {
    const length = arcLengths(stair.coords).at(-1) ?? 0;
    if (length === 0) {
      continue;
    }
    const core = stair.w / 2 + cell / 2;
    const reach = core + cell;
    const xs = stair.coords.map((p) => p[0]);
    const ys = stair.coords.map((p) => p[1]);
    const col0 = Math.max(0, Math.floor((Math.min(...xs) - reach - minX) / dx));
    const col1 = Math.min(
      n - 1,
      Math.ceil((Math.max(...xs) + reach - minX) / dx)
    );
    const row0 = Math.max(0, Math.floor((maxY - Math.max(...ys) - reach) / dy));
    const row1 = Math.min(
      n - 1,
      Math.ceil((maxY - Math.min(...ys) + reach) / dy)
    );
    for (let row = row0; row <= row1; row++) {
      const y = maxY - (row + 0.5) * dy;
      for (let col = col0; col <= col1; col++) {
        const idx = row * n + col;
        const z = out[idx];
        if (isInvalidElevation(z)) {
          continue;
        }
        const hit = projectOntoAxis(stair.coords, minX + (col + 0.5) * dx, y);
        if (!hit || hit.d > reach) {
          continue;
        }
        const target = rampAt(stair, hit.s, length) - STAIR_BURN_M;
        const floor =
          hit.d <= core ? target : Math.max(target, z - MARGIN_DIG_M);
        out[idx] = Math.min(z, floor);
      }
    }
  }
  return out;
}

export interface StairGeometryData {
  /** per-vertex shade: 0 tread, 1 riser, 2 cheek */
  kinds: number[];
  /** world-frame (Y-up, recentered) flat normals, xyz per vertex */
  normals: number[];
  /** world-frame (Y-up, recentered) positions, xyz per vertex, triangles */
  positions: number[];
}

export const STAIR_TREAD = 0;
export const STAIR_RISER = 1;
export const STAIR_CHEEK = 2;

/** A cross-section of the flight: the axis point and the unit perpendicular
 *  (pointing left of the climb) of the segment it lies on. */
interface Section {
  px: number;
  py: number;
  s: number;
  x: number;
  y: number;
}

function segmentNormal(a: Point2, b: Point2): [number, number] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
}

/**
 * The cross-sections of each segment: its ends and the step boundaries on
 * it, every one square to that segment. A bend is two sections at the same
 * point (no mitre: on a short step the mitred inner edge would fold back);
 * `stairGeometry` closes the outer wedge between them.
 */
function segmentSections(stair: StairLine, lengths: number[]): Section[][] {
  const length = lengths.at(-1) ?? 0;
  const out: Section[][] = [];
  for (let i = 0; i < stair.coords.length - 1; i++) {
    const a = stair.coords[i];
    const b = stair.coords[i + 1];
    const s0 = lengths[i];
    const s1 = lengths[i + 1];
    if (s1 - s0 <= 0) {
      continue;
    }
    const [px, py] = segmentNormal(a, b);
    const at = [s0];
    for (let k = 1; k < stair.n; k++) {
      const s = (k * length) / stair.n;
      if (s > s0 + 1e-4 && s < s1 - 1e-4) {
        at.push(s);
      }
    }
    at.push(s1);
    out.push(
      at.map((s) => {
        const t = (s - s0) / (s1 - s0);
        return {
          s,
          x: a[0] + (b[0] - a[0]) * t,
          y: a[1] + (b[1] - a[1]) * t,
          px,
          py,
        };
      })
    );
  }
  return out;
}

/** (x, y, elevation) in the data frame, or a data-frame vector. */
type Corner = [number, number, number];

class StairWriter {
  readonly data: StairGeometryData = { positions: [], normals: [], kinds: [] };
  constructor(private readonly offset: RecenterOffset) {}

  /** A quad from four data-frame corners (x, y, elevation), counter-
   *  clockwise seen from its front, with one flat data-frame normal. */
  quad(corners: Corner[], normal: Corner, kind: number): void {
    const [a, b, c, d] = corners;
    this.triangle([a, b, c], normal, kind);
    this.triangle([a, c, d], normal, kind);
  }

  triangle(corners: Corner[], normal: Corner, kind: number): void {
    for (const [x, y, z] of corners) {
      this.data.positions.push(x - this.offset.cx, z, -(y - this.offset.cy));
      // data (x, y, up) → world (x, up, −y)
      this.data.normals.push(normal[0], normal[2], -normal[1]);
      this.data.kinds.push(kind);
    }
  }
}

/** A side cheek from `p` to `q` (in that order, seen from outside), from
 *  the buried base up to the tread. */
function cheek(
  out: StairWriter,
  p: Point2,
  q: Point2,
  bases: [number, number],
  h: number,
  normal: [number, number]
): void {
  out.quad(
    [
      [...p, bases[0]],
      [...q, bases[1]],
      [...q, h],
      [...p, h],
    ],
    [normal[0], normal[1], 0],
    STAIR_CHEEK
  );
}

/** Closes the wedge a bend opens on its outer side: a tread triangle and a
 *  cheek across it. */
function joint(
  out: StairWriter,
  a: Section,
  b: Section,
  half: number,
  h: number,
  base: number
): void {
  const turn = a.px * b.py - a.py * b.px; // > 0: turning left, the outside is right
  if (Math.abs(turn) < 1e-6) {
    return;
  }
  const side = turn > 0 ? -1 : 1;
  const p: Point2 = [a.x + a.px * half * side, a.y + a.py * half * side];
  const q: Point2 = [b.x + b.px * half * side, b.y + b.py * half * side];
  const c: Corner = [a.x, a.y, h];
  const [first, second] = side === 1 ? [q, p] : [p, q];
  out.triangle([c, [...first, h], [...second, h]], [0, 0, 1], STAIR_TREAD);
  const nx = (a.px + b.px) * side;
  const ny = (a.py + b.py) * side;
  const nl = Math.hypot(nx, ny) || 1;
  cheek(out, first, second, [base, base], h, [nx / nl, ny / nl]);
}

/**
 * The flight as blocks, in the viewer's Y-up recentered frame. Null for a
 * flight with no length.
 */
export function stairGeometry(
  stair: StairLine,
  offset: RecenterOffset
): StairGeometryData | null {
  const lengths = arcLengths(stair.coords);
  const length = lengths.at(-1) ?? 0;
  if (!(length > 0) || stair.n < 1) {
    return null;
  }
  const rise = (stair.z[1] - stair.z[0]) / stair.n;
  const half = stair.w / 2;
  const tread = (k: number) => stair.z[0] + (k + 1) * rise;
  const base = (s: number) => rampAt(stair, s, length) - BURY_M;
  const stepOf = (s: number) =>
    Math.min(stair.n - 1, Math.floor((s / length) * stair.n + 1e-6));
  const edge = (c: Section, side: 1 | -1): [number, number] => [
    c.x + c.px * half * side,
    c.y + c.py * half * side,
  ];
  const out = new StairWriter(offset);
  const segments = segmentSections(stair, lengths);
  const block = (a: Section, b: Section) => {
    const h = tread(stepOf((a.s + b.s) / 2));
    const [al, bl, ar, br] = [edge(a, 1), edge(b, 1), edge(a, -1), edge(b, -1)];
    out.quad(
      [
        [...ar, h],
        [...br, h],
        [...bl, h],
        [...al, h],
      ],
      [0, 0, 1],
      STAIR_TREAD
    );
    cheek(out, bl, al, [base(b.s), base(a.s)], h, [a.px, a.py]);
    cheek(out, ar, br, [base(a.s), base(b.s)], h, [-a.px, -a.py]);
  };
  for (const [j, sections] of segments.entries()) {
    for (let i = 0; i < sections.length - 1; i++) {
      block(sections[i], sections[i + 1]);
    }
    const next = segments[j + 1]?.[0];
    const end = sections.at(-1);
    if (next && end) {
      joint(out, end, next, half, tread(stepOf(end.s)), base(end.s));
    }
  }
  // A riser at the front of every step, facing down the flight.
  const all = segments.flat();
  for (let k = 0; k < stair.n; k++) {
    const s = (k * length) / stair.n;
    const c = all.find((x) => x.s >= s - 1e-3);
    if (!c) {
      continue;
    }
    const lo = k === 0 ? base(0) : tread(k - 1);
    const [l, r] = [edge(c, 1), edge(c, -1)];
    // −tangent: the left perpendicular turned counter-clockwise
    out.quad(
      [
        [...l, lo],
        [...r, lo],
        [...r, tread(k)],
        [...l, tread(k)],
      ],
      [-c.py, c.px, 0],
      STAIR_RISER
    );
  }
  return out.data;
}
