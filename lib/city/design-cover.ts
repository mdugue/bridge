/**
 * Which existing buildings a design replaces (ADR 0053): the design's plan
 * as a mask of 1 m cells, and the LoD2 objects whose footprint it covers
 * for the most part. The layer hides those (city-layer.ts `setHidden`) and
 * brings them back when the design moves or goes. No THREE, no DOM.
 *
 * The plan counts what stands: every triangle of the design laid flat,
 * cell by cell, except the flat ones at its lowest level — a ground plate,
 * a lawn, the site plan a model often stands on — which would otherwise
 * take every house on the plot with them. A wall laid flat is a line and
 * marks the cells it crosses.
 */

import type { DesignPlacement } from "./design-placement";
import { DEG2RAD } from "./pose";

/** A design's plan: cells of `cell` m from (x0, y0), EPSG; 1 where it
 *  stands. */
export interface PlanMask {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
}

/** The plan's cell (m). */
export const PLAN_CELL_M = 1;
/** A triangle flatter than this (its normal's vertical share) and below
 *  GROUND_BAND_M over the design's lowest point is ground, not building. */
const FLAT = 0.9;
const GROUND_BAND_M = 0.5;
/** The share of a footprint the plan must cover to take the building. */
export const COVER_SHARE = 0.5;
/** The most cells a plan may have (a design 4 km across at 1 m): past it
 *  the cell grows. */
const MAX_CELLS = 16_000_000;

/**
 * The plan of a design's triangles: `positions` three per vertex — x, y
 * (EPSG) and z (NHN), or the design's own about its anchor with `place` —
 * and `index` three per triangle (none: in order). A Float64 copy of the
 * placed vertices lives for the call (a phone's design: 3 MB at most).
 */
export function planMask(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  place?: DesignPlacement,
  cell = PLAN_CELL_M
): PlanMask | null {
  const vertices = Math.floor(positions.length / 3);
  if (vertices < 3) {
    return null;
  }
  // `place`: the positions are the design's own about its anchor (x east,
  // y up, z south), placed as `placePoint` does
  const turn = (place?.rotation ?? 0) * DEG2RAD;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const xy = new Float64Array(vertices * 3);
  for (let v = 0; v < vertices; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    if (place) {
      xy[v * 3] = place.east + px * c - pz * s;
      xy[v * 3 + 1] = place.north - px * s - pz * c;
      xy[v * 3 + 2] = place.base + py;
    } else {
      xy[v * 3] = px;
      xy[v * 3 + 1] = py;
      xy[v * 3 + 2] = pz;
    }
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let v = 0; v < vertices; v++) {
    minX = Math.min(minX, xy[v * 3]);
    maxX = Math.max(maxX, xy[v * 3]);
    minY = Math.min(minY, xy[v * 3 + 1]);
    maxY = Math.max(maxY, xy[v * 3 + 1]);
    minZ = Math.min(minZ, xy[v * 3 + 2]);
  }
  let size = cell;
  while (((maxX - minX) / size + 2) * ((maxY - minY) / size + 2) > MAX_CELLS) {
    size *= 2;
  }
  const cols = Math.ceil((maxX - minX) / size) + 1;
  const rows = Math.ceil((maxY - minY) / size) + 1;
  const mask: PlanMask = {
    x0: minX,
    y0: minY,
    cell: size,
    cols,
    rows,
    cells: new Uint8Array(cols * rows),
  };
  const triangles = (index ? index.length : vertices) / 3;
  const at = (t: number, k: number) => (index ? index[t * 3 + k] : t * 3 + k);
  const p = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const v = at(t, k);
      p[k * 3] = xy[v * 3];
      p[k * 3 + 1] = xy[v * 3 + 1];
      p[k * 3 + 2] = xy[v * 3 + 2];
    }
    if (!isGround(p, minZ)) {
      markTriangle(mask, p);
    }
  }
  return mask;
}

/** Whether a triangle lies flat at the design's lowest level. */
function isGround(p: readonly number[], minZ: number): boolean {
  if (Math.max(p[2], p[5], p[8]) > minZ + GROUND_BAND_M) {
    return false;
  }
  const ax = p[3] - p[0];
  const ay = p[4] - p[1];
  const az = p[5] - p[2];
  const bx = p[6] - p[0];
  const by = p[7] - p[1];
  const bz = p[8] - p[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  return len === 0 || Math.abs(nz) / len >= FLAT;
}

/**
 * Marks the cells a triangle laid flat touches: those whose middle it
 * covers, and those its edges cross (a wall laid flat is all edge).
 */
function markTriangle(mask: PlanMask, p: readonly number[]): void {
  const { x0, y0, cell, cols, rows, cells } = mask;
  const cx = (x: number) => (x - x0) / cell;
  const cy = (y: number) => (y - y0) / cell;
  const ax = cx(p[0]);
  const ay = cy(p[1]);
  const bx = cx(p[3]);
  const by = cy(p[4]);
  const qx = cx(p[6]);
  const qy = cy(p[7]);
  const set = (c: number, r: number) => {
    if (c >= 0 && r >= 0 && c < cols && r < rows) {
      cells[r * cols + c] = 1;
    }
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2);
    for (let i = 0; i <= steps; i++) {
      const f = steps === 0 ? 0 : i / steps;
      set(Math.floor(x1 + (x2 - x1) * f), Math.floor(y1 + (y2 - y1) * f));
    }
  };
  line(ax, ay, bx, by);
  line(bx, by, qx, qy);
  line(qx, qy, ax, ay);
  const area = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay);
  if (Math.abs(area) < 1e-9) {
    return;
  }
  const c0 = Math.max(0, Math.floor(Math.min(ax, bx, qx)));
  const c1 = Math.min(cols - 1, Math.ceil(Math.max(ax, bx, qx)));
  const r0 = Math.max(0, Math.floor(Math.min(ay, by, qy)));
  const r1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by, qy)));
  for (let r = r0; r <= r1; r++) {
    const y = r + 0.5;
    for (let c = c0; c <= c1; c++) {
      const x = c + 0.5;
      const w0 = (bx - x) * (qy - y) - (qx - x) * (by - y);
      const w1 = (qx - x) * (ay - y) - (ax - x) * (qy - y);
      const w2 = (ax - x) * (by - y) - (bx - x) * (ay - y);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        cells[r * cols + c] = 1;
      }
    }
  }
}

/** Whether EPSG (x, y) lies in a cell the plan marks. */
export function inPlan(mask: PlanMask, x: number, y: number): boolean {
  const c = Math.floor((x - mask.x0) / mask.cell);
  const r = Math.floor((y - mask.y0) / mask.cell);
  return (
    c >= 0 &&
    r >= 0 &&
    c < mask.cols &&
    r < mask.rows &&
    mask.cells[r * mask.cols + c] === 1
  );
}

/** Even-odd test of a point against one ring. */
function inRing(ring: readonly [number, number][], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * The share of an object's footprint (its polygons, EPSG rings) the plan
 * covers, sampled at the plan's cells; a footprint smaller than a cell is
 * asked at its first vertex.
 */
export function coveredShare(
  mask: PlanMask,
  polys: readonly (readonly [number, number][])[]
): number {
  let inside = 0;
  let covered = 0;
  for (const ring of polys) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const right = mask.x0 + mask.cols * mask.cell;
    const top = mask.y0 + mask.rows * mask.cell;
    if (maxX < mask.x0 || minX > right || maxY < mask.y0 || minY > top) {
      continue;
    }
    const step = mask.cell;
    let samples = 0;
    for (let y = minY + step / 2; y < maxY; y += step) {
      for (let x = minX + step / 2; x < maxX; x += step) {
        if (inRing(ring, x, y)) {
          samples++;
          if (inPlan(mask, x, y)) {
            covered++;
          }
        }
      }
    }
    if (samples === 0 && ring.length > 0) {
      samples = 1;
      if (inPlan(mask, ring[0][0], ring[0][1])) {
        covered++;
      }
    }
    inside += samples;
  }
  return inside === 0 ? 0 : covered / inside;
}

/** The objects of a tile whose footprints the plan covers for at least
 *  `share`: what the design takes. */
export function coveredObjects(
  mask: PlanMask,
  footprints: readonly (readonly (readonly [number, number][])[])[],
  share = COVER_SHARE
): Set<number> {
  const out = new Set<number>();
  footprints.forEach((polys, i) => {
    if (polys.length > 0 && coveredShare(mask, polys) >= share) {
      out.add(i);
    }
  });
  return out;
}

/**
 * The plan's outline for the minimap: the convex hull of its marked cells'
 * corners (EPSG, anticlockwise), or null for an empty plan.
 */
export function planHull(mask: PlanMask): [number, number][] | null {
  const points: [number, number][] = [];
  for (let r = 0; r < mask.rows; r++) {
    // a row's first and last marked cell carry its hull corners
    let first = -1;
    let last = -1;
    for (let c = 0; c < mask.cols; c++) {
      if (mask.cells[r * mask.cols + c] === 1) {
        if (first < 0) {
          first = c;
        }
        last = c;
      }
    }
    if (first >= 0) {
      const y = mask.y0 + r * mask.cell;
      const xa = mask.x0 + first * mask.cell;
      const xb = mask.x0 + (last + 1) * mask.cell;
      points.push([xa, y], [xa, y + mask.cell], [xb, y], [xb, y + mask.cell]);
    }
  }
  return points.length < 3 ? null : convexHull(points);
}

/** Andrew's monotone chain, anticlockwise. */
export function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of sorted.toReversed()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
