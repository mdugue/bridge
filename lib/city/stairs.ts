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
 * - `raiseTerraces` lifts the ground inside the raised OSM areas the bake
 *   found a lifted flight climbing onto (the Brühlsche Terrasse stands on
 *   casemates, so the bare-earth DGM runs flat under it);
 * - `burnStairs` sets the terrain grid under the flight to just below the
 *   ramp through the steps' inner corners — lifting it where the DGM runs
 *   below (the player walks on the grid, so the ground must climb with the
 *   steps) — and lowers every grid vertex beside it whose triangles reach
 *   under the flight, so no ground pokes through a tread (never across a
 *   wall: a flight between walls does not dig into the terrace beyond them);
 * - `stairGeometry` builds the flight as solid blocks: a tread per step, a
 *   riser at each step's front and the two side cheeks, reaching below the
 *   bottom landing.
 *
 * Step k (0-based) spans [k, k+1]·L/n along the axis with its tread at
 * z0 + (k+1)·rise, so the last tread is the top landing and every tread
 * lies on or above the ramp z0 → z1.
 */
import type { StairFeature, TerraceFeature } from "./features";
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
/** How far beyond the flight's edge the burn reaches, in grid cells: every
 *  vertex of a triangle under the flight lies within √2 cells of it. */
const BURN_REACH_CELLS = 1.5;
/** How far below the bottom landing the cheeks and the first riser reach
 *  (m): the flight is a solid block, whatever the ground does beside it. */
const BURY_M = 0.6;

/** A raised area the build lifts the ground to (pipeline/bake/stairs.py). */
export interface Terrace {
  /** polygons, each outer ring then holes, EPSG coordinates */
  polygons: Point2[][][];
  /** the level (m) */
  z: number;
}

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

/** The bake's terrace feature, or null when it is not one. */
export function terraceOf(f: TerraceFeature): Terrace | null {
  const z = f.properties?.z;
  const g = f.geometry;
  if (!(g && Number.isFinite(z))) {
    return null;
  }
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polygons.length > 0 ? { polygons, z: z as number } : null;
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

interface AxisHit {
  /** distance from the axis (m) */
  d: number;
  /** the nearest point on the axis */
  px: number;
  py: number;
  /** arc length of that point, clamped to the axis */
  s: number;
}

/** The nearest point on the axis, and whether it is past either end. */
function nearestOnAxis(
  coords: Point2[],
  x: number,
  y: number
): (AxisHit & { beyond: boolean }) | null {
  const lengths = arcLengths(coords);
  let best: (AxisHit & { beyond: boolean }) | null = null;
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
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    const d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) {
      const beyond = (i === 0 && raw < 0) || (i === last && raw > 1);
      best = { d, px, py, s: lengths[i] + t * len, beyond };
    }
  }
  return best;
}

/** Where a point projects onto the axis: arc length and distance, or null
 *  when it lies beyond either end. */
export function projectOntoAxis(
  coords: Point2[],
  x: number,
  y: number
): { d: number; s: number } | null {
  const hit = nearestOnAxis(coords, x, y);
  return hit && !hit.beyond ? { d: hit.d, s: hit.s } : null;
}

/** Whether segments ab and cd cross. */
function crosses(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const side = (p: Point2, q: Point2, r: Point2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether any wall runs between a point and the axis point nearest it. */
function behindWall(walls: Point2[][], from: Point2, to: Point2): boolean {
  for (const wall of walls) {
    for (let i = 0; i < wall.length - 1; i++) {
      if (crosses(from, to, wall[i], wall[i + 1])) {
        return true;
      }
    }
  }
  return false;
}

/** The walls whose extent overlaps the axis's, grown by `reach` (a cheap
 *  prefilter). */
function wallsNear(
  walls: Point2[][],
  coords: Point2[],
  reach: number
): Point2[][] {
  const box = (pts: Point2[], pad: number) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [
      Math.min(...xs) - pad,
      Math.min(...ys) - pad,
      Math.max(...xs) + pad,
      Math.max(...ys) + pad,
    ];
  };
  const [ax0, ay0, ax1, ay1] = box(coords, reach);
  return walls.filter((w) => {
    const [wx0, wy0, wx1, wy1] = box(w, 0);
    return wx0 <= ax1 && wx1 >= ax0 && wy0 <= ay1 && wy1 >= ay0;
  });
}

export interface StairBurnInput {
  /** [minX, minY, maxX, maxY] in the projected CRS — same as the terrain mesh */
  bounds: TerrainBounds;
  /** n*n elevation samples, row-major, row 0 = north */
  elevations: ArrayLike<number>;
  /** grid size (n x n) */
  n: number;
  /** extra depth (m) below `STAIR_BURN_M`: a mesh that only approximates
   *  the grid (the fine level's TIN, within its tolerance) could otherwise
   *  poke through a tread */
  margin?: number;
  stairs: StairLine[];
  /** wall lines (EPSG): the burn never reaches across one */
  walls?: Point2[][];
}

/**
 * Sets the grid under every flight to `STAIR_BURN_M` below its ramp, in a
 * COPY of the elevations. Vertices under the flight take the ramp height
 * whether the DGM lies above it or below — the player walks on this grid,
 * so a flight onto a structure the DGM lacks must lift it. Vertices beyond
 * the flight's edge, up to `BURN_REACH_CELLS` cells out (its ends
 * included), are only lowered, so no triangle under a tread keeps a vertex
 * above it; one with a wall between it and the axis is left alone. NoData
 * stays NoData.
 */
export function burnStairs(input: StairBurnInput): Float32Array {
  const { elevations, n, bounds, stairs, margin = 0 } = input;
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
    const half = stair.w / 2;
    const reach = half + cell * BURN_REACH_CELLS;
    const walls = wallsNear(input.walls ?? [], stair.coords, reach);
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
        const x = minX + (col + 0.5) * dx;
        const hit = isInvalidElevation(z)
          ? null
          : nearestOnAxis(stair.coords, x, y);
        if (!hit || hit.d > reach) {
          continue;
        }
        if (hit.d > half && behindWall(walls, [x, y], [hit.px, hit.py])) {
          continue;
        }
        const target = rampAt(stair, hit.s, length) - STAIR_BURN_M - margin;
        // Under the flight the ground IS the ramp, lifted where the DGM runs
        // below it (a flight onto a structure the DGM lacks): the player
        // walks on this grid, not on the steps. Beside it, only lowered.
        out[idx] = hit.d <= half && !hit.beyond ? target : Math.min(z, target);
      }
    }
  }
  return out;
}

/** Even-odd point-in-polygon over every ring (holes included). */
function insidePolygon(rings: Point2[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export interface TerraceRaiseInput {
  bounds: TerrainBounds;
  elevations: ArrayLike<number>;
  n: number;
  terraces: Terrace[];
}

/**
 * Lifts every grid vertex inside a terrace to its level, in a COPY of the
 * elevations; never lowers, NoData stays NoData.
 */
export function raiseTerraces(input: TerraceRaiseInput): Float32Array {
  const { elevations, n, bounds, terraces } = input;
  const out = Float32Array.from(elevations);
  const [minX, minY, maxX, maxY] = bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  for (const terrace of terraces) {
    for (const rings of terrace.polygons) {
      const outer = rings[0] ?? [];
      const xs = outer.map((p) => p[0]);
      const ys = outer.map((p) => p[1]);
      const col0 = Math.max(0, Math.floor((Math.min(...xs) - minX) / dx));
      const col1 = Math.min(n - 1, Math.ceil((Math.max(...xs) - minX) / dx));
      const row0 = Math.max(0, Math.floor((maxY - Math.max(...ys)) / dy));
      const row1 = Math.min(n - 1, Math.ceil((maxY - Math.min(...ys)) / dy));
      for (let row = row0; row <= row1; row++) {
        const y = maxY - (row + 0.5) * dy;
        for (let col = col0; col <= col1; col++) {
          const idx = row * n + col;
          const x = minX + (col + 0.5) * dx;
          if (!isInvalidElevation(out[idx]) && insidePolygon(rings, x, y)) {
            out[idx] = Math.max(out[idx], terrace.z);
          }
        }
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

/** Warm sandstone (sRGB), a shade deeper than the pale ground around a
 *  flight so it never reads as a snow-covered bank. */
export const STAIR_STONE = 0xc4_b0_90;
/** Risers clearly darker than the treads, cheeks between: every step edge
 *  reads, even under a flat, overcast light. */
const STAIR_SHADE = [1, 0.62, 0.8];

function srgbToLinear(c: number): number {
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear RGB per vertex for a flight's `kinds` (the mesh's COLOR_0). */
export function stairColors(kinds: number[]): Float32Array<ArrayBuffer> {
  const stone = [16, 8, 0].map((shift) =>
    srgbToLinear(((STAIR_STONE >> shift) & 0xff) / 255)
  );
  const out = new Float32Array(kinds.length * 3);
  for (const [i, kind] of kinds.entries()) {
    const shade = STAIR_SHADE[kind] ?? 1;
    out[i * 3] = stone[0] * shade;
    out[i * 3 + 1] = stone[1] * shade;
    out[i * 3 + 2] = stone[2] * shade;
  }
  return out;
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
  const base = stair.z[0] - BURY_M;
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
    cheek(out, bl, al, [base, base], h, [a.px, a.py]);
    cheek(out, ar, br, [base, base], h, [-a.px, -a.py]);
  };
  for (const [j, sections] of segments.entries()) {
    for (let i = 0; i < sections.length - 1; i++) {
      block(sections[i], sections[i + 1]);
    }
    const next = segments[j + 1]?.[0];
    const end = sections.at(-1);
    if (next && end) {
      joint(out, end, next, half, tread(stepOf(end.s)), base);
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
    const lo = k === 0 ? base : tread(k - 1);
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
