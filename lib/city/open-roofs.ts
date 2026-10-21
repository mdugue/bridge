/**
 * Roofs on posts: a platform roof, a fuel station's canopy, a carport, a
 * bus shelter — a roof with nothing under it but its posts. Two sources
 * draw them: the OSM roofs LoD2 lacks, measured in DOM1
 * (pipeline/bake/structures.py, `kind: "roof"`, lib/city/structures.ts),
 * and the LoD2 objects whose ALKIS function says roof (`Überdachung`,
 * `Carport`), which LoD2 models as a solid block down to the ground — a
 * platform under one vanished, a fuel station's pumps stood inside it
 * (scripts/bake-city-mesh.ts `withOpenRoofs`). Both stand on the same
 * posts (`roofPosts`) under a slab of the same depth (`roofDepth`). Flat
 * non-indexed triangles wound counter-clockwise seen from outside, like
 * every structure. No THREE, no DOM.
 */
import type { Point2 } from "./polyline";
import type { StructureMesh } from "./small-buildings";

/** ALKIS functions of a roof on posts (`51009_1610` Überdachung,
 *  `51009_1611` Carport): LoD2 draws them as blocks. */
export const OPEN_ROOF_FUNCTIONS = ["51009_1610", "51009_1611"] as const;

/** Whether an ALKIS function is a roof on posts. */
export function isOpenRoof(fn: unknown): boolean {
  return (
    typeof fn === "string" &&
    (OPEN_ROOF_FUNCTIONS as readonly string[]).includes(fn)
  );
}

/** A roof's depth, its slab from top to underside (m): a carport's 0.2 m
 *  up to a platform roof's 0.7 m, with the square root of its area. */
export const ROOF_DEPTH = { min: 0.2, max: 0.7, perRootM2: 0.04 } as const;

/** The slab's depth of a roof covering `area` m². */
export function roofDepth(area: number): number {
  const d = ROOF_DEPTH.perRootM2 * Math.sqrt(Math.max(area, 0));
  return Math.min(Math.max(d, ROOF_DEPTH.min), ROOF_DEPTH.max);
}

/** A post's side (m). */
export const POST_M = 0.3;
/** A roof narrower than this (m) stands on posts along both long edges (a
 *  carport, a shelter); a wider one on rows under its middle (a platform
 *  roof's centre posts, a fuel station's two rows). */
export const NARROW_M = 5;
/** Posts along a wide roof's rows, centre to centre at most (m). */
const POST_SPAN_M = 8;
/** Rows across a wide roof at most this far apart (m). */
const ROW_SPAN_M = 10;
/** Posts along a narrow roof's edges at most this far apart (m). */
const EDGE_SPAN_M = 4;
/** How far a post stands inside the roof's edge (m). */
const POST_INSET_M = 0.4;
/** Under this much clear height (m) a roof is not opened: a bin shelter,
 *  a cellar's entrance — a block reads as well. */
export const MIN_CLEAR_M = 1.8;

/** The smallest rectangle around the points: its centre, its long axis `u`
 *  and short axis `v` (unit vectors), and its length and width along
 *  them. Rotating calipers over the convex hull. */
export function minimumRectangle(points: readonly Point2[]): {
  centre: Point2;
  length: number;
  u: Point2;
  v: Point2;
  width: number;
} | null {
  const hull = convexHull(points);
  if (hull.length < 3) {
    return null;
  }
  let best: ReturnType<typeof minimumRectangle> = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) {
      continue;
    }
    const e: Point2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const n: Point2 = [-e[1], e[0]];
    const along = hull.map((p) => p[0] * e[0] + p[1] * e[1]);
    const across = hull.map((p) => p[0] * n[0] + p[1] * n[1]);
    const [s0, s1] = [Math.min(...along), Math.max(...along)];
    const [t0, t1] = [Math.min(...across), Math.max(...across)];
    const area = (s1 - s0) * (t1 - t0);
    if (area < bestArea) {
      bestArea = area;
      const s = (s0 + s1) / 2;
      const t = (t0 + t1) / 2;
      const centre: Point2 = [e[0] * s + n[0] * t, e[1] * s + n[1] * t];
      best =
        s1 - s0 >= t1 - t0
          ? { centre, length: s1 - s0, u: e, v: n, width: t1 - t0 }
          : { centre, length: t1 - t0, u: n, v: e, width: s1 - s0 };
    }
  }
  return best;
}

/** The convex hull, counter-clockwise (Andrew's monotone chain). */
function convexHull(points: readonly Point2[]): Point2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) {
    return p;
  }
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point2[] = [];
  for (const q of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0
    ) {
      lower.pop();
    }
    lower.push(q);
  }
  const upper: Point2[] = [];
  for (const q of [...p].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0
    ) {
      upper.pop();
    }
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Whether a point lies inside the rings (the first the outline, the rest
 *  holes; even-odd) at least `inset` from every edge. */
export function insideBy(
  rings: readonly (readonly Point2[])[],
  p: Point2,
  inset: number
): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1]) {
        const x = ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
        if (p[0] < x) {
          inside = !inside;
        }
      }
      if (segmentDistance(p, ring[j], ring[i]) < inset) {
        return false;
      }
    }
  }
  return inside;
}

function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.min(
          Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0),
          1
        );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Evenly spread offsets over a span: `n` of them at the ends (`ends`) or
 *  each in the middle of its share. */
function spread(span: number, n: number, ends: boolean): number[] {
  if (ends) {
    return n === 1
      ? [0]
      : Array.from({ length: n }, (_, i) => -span / 2 + (span * i) / (n - 1));
  }
  return Array.from(
    { length: n },
    (_, i) => -span / 2 + (span * (i + 0.5)) / n
  );
}

/**
 * Where a roof's posts stand, on a lattice along its smallest rectangle: a
 * narrow roof (under `NARROW_M`) on both long edges from end to end, every
 * `EDGE_SPAN_M` at most; a wide one on rows under its middle, one row per
 * `ROW_SPAN_M` of width, a post every `POST_SPAN_M` along, cantilevered at
 * the ends (a platform roof's centre posts, a fuel station's two rows).
 * Only the posts at least `POST_INSET_M` inside the outline stand (a
 * curved or angled roof keeps those under it); none inside: one at the
 * point farthest in among the lattice's.
 */
export function roofPosts(rings: readonly (readonly Point2[])[]): Point2[] {
  const outer = rings[0] ?? [];
  const rect = minimumRectangle(outer);
  if (!rect) {
    return [];
  }
  const { centre, length, u, v, width } = rect;
  const narrow = width < NARROW_M;
  const edge = Math.max(width - 2 * POST_INSET_M, 0);
  const rows = narrow
    ? spread(edge, edge > 1 ? 2 : 1, true)
    : spread(width, Math.max(1, Math.ceil(width / ROW_SPAN_M)), false);
  const run = Math.max(length - 2 * POST_INSET_M, 0);
  const along = narrow
    ? spread(run, Math.max(2, Math.ceil(run / EDGE_SPAN_M) + 1), true)
    : spread(length, Math.max(1, Math.round(length / POST_SPAN_M)), false);
  const lattice = along.flatMap((s) =>
    rows.map((t): Point2 => [
      centre[0] + s * u[0] + t * v[0],
      centre[1] + s * u[1] + t * v[1],
    ])
  );
  // the lattice's edge rows lie at the inset itself: a millimetre's slack
  const posts = lattice.filter((p) => insideBy(rings, p, POST_INSET_M - 1e-3));
  if (posts.length > 0) {
    return posts;
  }
  const inside = lattice.filter((p) => insideBy(rings, p, 0));
  return inside.length > 0 ? [inside[Math.floor(inside.length / 2)]] : [];
}

function push(out: StructureMesh, roof: number, ...vs: number[][]): void {
  for (const v of vs) {
    out.positions.push(v[0], v[1], v[2]);
    out.isRoof.push(roof);
  }
}

/** Square posts of side `POST_M` from `z0` to `z1` around each point
 *  (already recentered): four walls each, no caps (the foot is in the
 *  ground, the head under the slab). */
export function postsMesh(
  posts: readonly Point2[],
  z0: number,
  z1: number,
  out: StructureMesh = { isRoof: [], positions: [] }
): StructureMesh {
  if (!(z1 > z0)) {
    return out;
  }
  const r = POST_M / 2;
  for (const [x, y] of posts) {
    // counter-clockwise from above, so the outside is on the right
    const ring: Point2[] = [
      [x - r, y - r],
      [x + r, y - r],
      [x + r, y + r],
      [x - r, y + r],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % 4];
      push(out, 0, [ax, ay, z0], [bx, by, z0], [bx, by, z1]);
      push(out, 0, [ax, ay, z0], [bx, by, z1], [ax, ay, z1]);
    }
  }
  return out;
}

/**
 * One triangle clipped to the part at or above `z` (Sutherland–Hodgman
 * against one plane): none, the triangle, or a fan of one or two keeping
 * its winding. Flat x, y, z triples in and out.
 */
export function clipAbove(tri: readonly number[], z: number): number[] {
  const pts = [0, 1, 2].map((k) => tri.slice(3 * k, 3 * k + 3));
  const kept: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 3];
    const aIn = a[2] >= z;
    const bIn = b[2] >= z;
    if (aIn) {
      kept.push(a);
    }
    if (aIn !== bIn) {
      const t = (z - a[2]) / (b[2] - a[2]);
      kept.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), z]);
    }
  }
  const out: number[] = [];
  for (let k = 1; k + 1 < kept.length; k++) {
    out.push(...kept[0], ...kept[k], ...kept[k + 1]);
  }
  return out;
}
