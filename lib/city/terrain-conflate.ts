/**
 * Wall → terrain conflation (a "breakline burn"). DOM-free, THREE-free, pure —
 * unit-tested alongside terrain-geometry.
 *
 * The problem: a retaining/city wall (e.g. the Brühlsche Terrasse) is a sharp
 * vertical step in reality, but the DGM1 raster smooths it into a gentle bank.
 * So the OSM wall ribbon either floats over the ramp or gets swallowed by it —
 * the ground never "steps" on both sides the way it should.
 *
 * The fix, deterministic and source-portable (any DEM + any OSM wall lines): for
 * each wall we read the terrain's natural shelf level a short distance out on
 * each side (`PROBE_M`), then snap nearby cells toward the HIGH-side level on one
 * side of the line and the LOW-side level on the other. The result is a sharp
 * step concentrated AT the wall, feathering back to the untouched DGM within a
 * narrow band — so the wall ribbon now skins a real step instead of a smooth
 * bank. Nearest-wall-wins (max influence) keeps overlapping/parallel walls sane.
 *
 * Gating keeps it honest: only earth-retaining kinds (retaining_wall / city_wall
 * / embankment) reshape ground , and only where the two sides actually differ by
 * `MIN_STEP_M` — so freestanding garden walls and flat fountain rims leave the
 * terrain alone. A `MAX_STEP_M` clamp stops a bad height tag gouging a canyon.
 */
import { subdividePolyline } from "./polyline";
import {
  isInvalidElevation,
  sampleHeightfield,
  type TerrainBounds,
} from "./terrain-geometry";

export interface WallLine {
  /** Site-CRS coordinates (NOT recentered), as baked by pipeline/bake/walls.py */
  coords: [number, number][];
  /** OSM barrier/man_made kind; only retaining kinds reshape the ground */
  kind: string;
}

export interface ConflateInput {
  /** [minX, minY, maxX, maxY] in the projected CRS — same as the terrain mesh */
  bounds: TerrainBounds;
  /** n*n elevation samples, row-major, row 0 = north (the DGM raster) */
  elevations: ArrayLike<number>;
  /** grid size (n x n) */
  n: number;
  /** wall centrelines (site CRS) with their kind */
  walls: WallLine[];
}

/** Kinds whose purpose is to hold back earth → they legitimately step the ground. */
const CONFLATE_KINDS = new Set([
  "retaining_wall",
  "city_wall",
  "embankment",
  "cliff",
]);

const PROBE_M = 11; // perpendicular reach to read each side's shelf level (m)
const MIN_STEP_M = 1.5; // skip walls whose two sides barely differ (kerbs, rims)
const MAX_STEP_M = 18; // clamp so a bad height tag can't gouge a canyon (m)
const FLAT_M = 2; // |perp| within which the snap is full — keeps the step solid
const BAND_M = 11; // |perp| beyond which the terrain is left untouched (m)

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Per-wall-vertex step descriptor: the two shelf levels + the high-side normal. */
interface Step {
  /** high / low shelf levels (m) */
  hi: number;
  /** unit vector pointing to the HIGH side */
  hx: number;
  hy: number;
  lo: number;
  /** wall tangent (unit) — for the along-wall slab test */
  tx: number;
  ty: number;
  x: number;
  y: number;
}

/** Reads both shelf levels around one wall vertex; null when there is no step. */
function stepAt(
  input: ConflateInput,
  x: number,
  y: number,
  tx: number,
  ty: number
): Step | null {
  const px = -ty;
  const py = tx; // unit perpendicular
  const sample = (sx: number, sy: number): number | null =>
    sampleHeightfield(input, sx, sy);
  const g = sample(x, y);
  let aLvl = sample(x + px * PROBE_M, y + py * PROBE_M);
  let bLvl = sample(x - px * PROBE_M, y - py * PROBE_M);
  if (aLvl === null && bLvl === null) {
    return null;
  }
  aLvl ??= g ?? bLvl ?? 0;
  bLvl ??= g ?? aLvl;
  let step = Math.abs(aLvl - bLvl);
  if (step < MIN_STEP_M) {
    return null;
  }
  step = Math.min(step, MAX_STEP_M);
  const hi = Math.max(aLvl, bLvl);
  const lo = hi - step;
  // High side is +perp when aLvl is the larger of the two.
  const sign = aLvl >= bLvl ? 1 : -1;
  return { hx: px * sign, hy: py * sign, hi, lo, tx, ty, x, y };
}

/**
 * Burns the wall steps into a COPY of the elevation grid and returns it. The
 * input grid is never mutated; NoData cells are left as-is (no lifting holes).
 */
export function conflateWalls(input: ConflateInput): Float32Array {
  const { elevations, n, bounds, walls } = input;
  const [minX, minY, maxX, maxY] = bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  const cell = Math.min(dx, dy);

  const out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    out[i] = elevations[i];
  }
  const weight = new Float32Array(n * n); // best (nearest) influence per cell
  const target = new Float32Array(n * n);

  for (const wall of walls) {
    if (!CONFLATE_KINDS.has(wall.kind) || wall.coords.length < 2) {
      continue;
    }
    const pts = subdividePolyline(wall.coords, cell);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const s = stepAt(input, pts[i][0], pts[i][1], tx, ty);
      if (s) {
        stampStep(out, weight, target, s, { n, minX, maxY, dx, dy });
      }
    }
  }

  for (let i = 0; i < n * n; i++) {
    if (weight[i] > 0) {
      out[i] += (target[i] - out[i]) * weight[i];
    }
  }
  return out;
}

interface StampGrid {
  dx: number;
  dy: number;
  maxY: number;
  minX: number;
  n: number;
}

/** Snaps the cells in one wall vertex's band toward its hi/lo shelf (max-wins). */
function stampStep(
  out: Float32Array,
  weight: Float32Array,
  target: Float32Array,
  s: Step,
  g: StampGrid
): void {
  const { n, minX, maxY, dx, dy } = g;
  const colC = (s.x - minX) / dx - 0.5;
  const rowC = (maxY - s.y) / dy - 0.5;
  const rCol = Math.ceil(BAND_M / dx) + 1;
  const rRow = Math.ceil(BAND_M / dy) + 1;
  const col0 = Math.max(0, Math.floor(colC - rCol));
  const col1 = Math.min(n - 1, Math.ceil(colC + rCol));
  const row0 = Math.max(0, Math.floor(rowC - rRow));
  const row1 = Math.min(n - 1, Math.ceil(rowC + rRow));
  for (let row = row0; row <= row1; row++) {
    const cy = maxY - (row + 0.5) * dy;
    for (let col = col0; col <= col1; col++) {
      const cx = minX + (col + 0.5) * dx;
      const dpx = cx - s.x;
      const dpy = cy - s.y;
      const dPerp = dpx * s.hx + dpy * s.hy; // + = high side
      if (Math.abs(dPerp) > BAND_M) {
        continue;
      }
      const dTan = dpx * s.tx + dpy * s.ty; // along the wall
      if (Math.abs(dTan) > cellSlab(dx, dy)) {
        continue;
      }
      const idx = row * n + col;
      if (isInvalidElevation(out[idx])) {
        continue;
      }
      const w = 1 - smoothstep(FLAT_M, BAND_M, Math.abs(dPerp));
      if (w <= weight[idx]) {
        continue;
      }
      weight[idx] = w;
      target[idx] = dPerp >= 0 ? s.hi : s.lo;
    }
  }
}

/** Half-width of the along-wall slab so consecutive vertices' bands overlap. */
function cellSlab(dx: number, dy: number): number {
  return Math.min(dx, dy) * 0.75;
}
