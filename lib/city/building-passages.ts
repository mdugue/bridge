/**
 * Passages through buildings — the pure half of scripts/bake-city-mesh.ts
 * `withPassages`. OSM maps a gateway into a courtyard, a city gate or a
 * passage under a hall as a way tagged `tunnel=building_passage`
 * (pipeline/bake/passages.py, which writes the axis it runs on through
 * the walls, its width, the ground along it and what each LoD2 object
 * holds of it); LoD2 draws the building over it as a closed shell, solid
 * from the ground up. Here the passage is cut through and lined:
 *
 * - its clear height (`passageHeight`): OSM's `maxheight`, else a drive's
 *   `DRIVE_H`, a track's `TRACK_H` or a footway's `WALK_H`, or the ground
 *   storey's less a
 *   lintel where that is taller (a palace's 5.5 m storey) — never closer
 *   than `KEEP_M` under the lowest eave over it; a building too low for
 *   `MIN_CLEAR_M` keeps its wall;
 * - the volume it takes (`passageRegions`): per segment of the axis a
 *   convex prism, its width across, mitred into the next at a bend, from
 *   `SINK.wall` under the ground at each vertex up to the clear height
 *   over it, so it follows a passage that falls (the Zwinger's to its
 *   pond, 4 m);
 * - every wall triangle of the objects it runs through clipped to what
 *   lies outside it (`cutOut`): the walls it crosses open, the floor goes;
 * - its lining (`passageLining`): the walls along it, from the same depth
 *   under the ground to the ceiling, facing in, and the ceiling, facing
 *   down — where the ground beside a wall is higher than at the axis, the
 *   wall reaches further under it; where lower, its foot shows no gap,
 *   for it stands `SINK.wall` under the axis' lowest ground nearby. A
 *   passage that ends inside its building is shut there by a wall across
 *   it (one of `sides`), and where two passages cross or run side by side
 *   each one's lining is cut to what lies outside the other (`cutOut`).
 *
 * The openings are rectangles: no source gives an arch's form. Flat x, y,
 * z triples in the recentred data frame (Z up) in and out, wound
 * counter-clockwise seen from outside. No THREE, no DOM.
 */
import { SINK } from "./ground-join";

/** A drive's clear height (m): a fire lane's 3.5 m under DIN 14090 and a
 *  gateway's head room; a footway's. */
export const DRIVE_H = 3.8;
export const WALK_H = 3;
/** A track's (m): a contact wire's lowest in a structure, 4.95 m (EBO). */
export const TRACK_H = 5;
/** What a ground storey keeps over a passage (m): its lintel and floor. */
export const LINTEL_M = 0.6;
/** What a building keeps over a passage under its lowest eave (m). */
export const KEEP_M = 1;
/** The lowest passage worth an opening (m). */
export const MIN_CLEAR_M = 2.2;

/** The highway kinds a vehicle drives through (passages.py `DRIVES`). */
const DRIVES = new Set([
  "living_street",
  "primary",
  "residential",
  "road",
  "secondary",
  "service",
  "tertiary",
  "track",
  "unclassified",
]);

/** A building a passage runs through, as its height reads it. */
export interface PassageHost {
  /** its lowest eave (m, data frame) */
  eaveZ: number;
  /** its ground storey (m) */
  storeyH: number;
}

/**
 * A passage's clear height (m), or null where its buildings stand too low
 * for one: OSM's (`tagged`), else the kind's or the lowest ground storey's
 * less `LINTEL_M`, the taller; at most `KEEP_M` under the lowest eave over
 * the highest ground along it (`groundTop`).
 */
export function passageHeight(
  kind: string,
  tagged: number | null,
  groundTop: number,
  hosts: readonly PassageHost[]
): number | null {
  if (hosts.length === 0) {
    return null;
  }
  const storey = Math.min(...hosts.map((h) => h.storeyH));
  const own = DRIVES.has(kind)
    ? DRIVE_H
    : kind === "railway"
      ? TRACK_H
      : WALK_H;
  const wanted = tagged ?? Math.max(own, storey - LINTEL_M);
  const room = Math.min(...hosts.map((h) => h.eaveZ)) - groundTop - KEEP_M;
  const h = Math.min(wanted, room);
  return h >= MIN_CLEAR_M ? h : null;
}

/** A half-space a x + b y + c z + d ≤ 0. */
export type Plane = readonly [number, number, number, number];

/** A passage as the cut reads it: its axis (recentred, plan), the ground
 *  under each vertex, its width and clear height. */
export interface PassageAxis {
  axis: readonly [number, number][];
  ground: readonly number[];
  h: number;
  w: number;
}

const unit = (x: number, y: number): [number, number] => {
  const l = Math.hypot(x, y);
  return l > 0 ? [x / l, y / l] : [0, 0];
};

/** The plane through height `z0` at `p` rising to `z1` over `len` m along
 *  `d`, as a half-space below it (`below`) or above it. */
function slope(
  p: readonly [number, number],
  d: readonly [number, number],
  len: number,
  z0: number,
  z1: number,
  below: boolean
): Plane {
  const g = len > 0 ? (z1 - z0) / len : 0;
  // z − z0 − g·((x, y) − p)·d ≤ 0 below the plane
  const a = -g * d[0];
  const b = -g * d[1];
  const c0 = -z0 + g * (p[0] * d[0] + p[1] * d[1]);
  return below ? [a, b, 1, c0] : [-a, -b, -1, -c0];
}

/**
 * The volume a passage takes, one convex prism per segment of its axis
 * (each a list of half-spaces): its width across, mitred into the next
 * segment at a bend (the bisector), run on square at the axis' ends, from
 * `SINK.wall` under the ground at each end up to `h` over it.
 */
export function passageRegions(p: PassageAxis): Plane[][] {
  const { axis, ground, h, w } = p;
  const dirs = axis
    .slice(1)
    .map((b, k) => unit(b[0] - axis[k][0], b[1] - axis[k][1]));
  const out: Plane[][] = [];
  for (let k = 0; k < dirs.length; k++) {
    const a = axis[k];
    const b = axis[k + 1];
    const d = dirs[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) {
      continue;
    }
    const m: [number, number] = [-d[1], d[0]];
    const e0 = k === 0 ? d : unit(dirs[k - 1][0] + d[0], dirs[k - 1][1] + d[1]);
    const e1 =
      k === dirs.length - 1
        ? d
        : unit(d[0] + dirs[k + 1][0], d[1] + dirs[k + 1][1]);
    const dot = (n: readonly [number, number], q: readonly [number, number]) =>
      n[0] * q[0] + n[1] * q[1];
    out.push([
      // past the start: −e0·(x − a) ≤ 0
      [-e0[0], -e0[1], 0, dot(e0, a)],
      // before the end: e1·(x − b) ≤ 0
      [e1[0], e1[1], 0, -dot(e1, b)],
      // within half the width either side
      [m[0], m[1], 0, -dot(m, a) - w / 2],
      [-m[0], -m[1], 0, dot(m, a) - w / 2],
      slope(a, d, len, ground[k] + h, ground[k + 1] + h, true),
      slope(a, d, len, ground[k] - SINK.wall, ground[k + 1] - SINK.wall, false),
    ]);
  }
  return out;
}

const EPS = 1e-6;
const side = (pl: Plane, v: readonly number[]): number =>
  pl[0] * v[0] + pl[1] * v[1] + pl[2] * v[2] + pl[3];

/** A convex polygon clipped to one side of a plane (inside: ≤ 0). */
function clip(poly: number[][], pl: Plane, inside: boolean): number[][] {
  const out: number[][] = [];
  const s = (v: number[]) => (inside ? side(pl, v) : -side(pl, v));
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = s(a);
    const fb = s(b);
    if (fa <= EPS) {
      out.push(a);
    }
    if ((fa < -EPS && fb > EPS) || (fa > EPS && fb < -EPS)) {
      const t = fa / (fa - fb);
      out.push([
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
        a[2] + t * (b[2] - a[2]),
      ]);
    }
  }
  return out;
}

/** Twice a planar polygon's area. */
function area2(poly: number[][]): number {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let k = 1; k + 1 < poly.length; k++) {
    const [a, b, c] = [poly[0], poly[k], poly[k + 1]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    x += u[1] * v[2] - u[2] * v[1];
    y += u[2] * v[0] - u[0] * v[2];
    z += u[0] * v[1] - u[1] * v[0];
  }
  return Math.hypot(x, y, z);
}

/** The part of a convex polygon outside a convex region, as polygons. */
function outside(poly: number[][], region: readonly Plane[]): number[][][] {
  const out: number[][][] = [];
  let rest = poly;
  for (const pl of region) {
    const fs = rest.map((v) => side(pl, v));
    if (fs.every((f) => f >= -EPS)) {
      out.push(rest); // all of it beyond this plane: outside the region
      return out;
    }
    if (fs.every((f) => f <= EPS)) {
      continue;
    }
    out.push(clip(rest, pl, false));
    rest = clip(rest, pl, true);
    if (rest.length < 3) {
      return out;
    }
  }
  return out; // what is left lies inside: cut away
}

/** Below this (m²) a clipped piece is a sliver and dropped. */
const SLIVER_M2 = 1e-4;

/**
 * One triangle (flat x, y, z ×3) cut down to what lies outside every
 * region: none, the triangle itself, or a fan per piece, its winding kept.
 */
export function cutOut(
  tri: readonly number[],
  regions: readonly (readonly Plane[])[]
): number[] {
  let pieces: number[][][] = [
    [tri.slice(0, 3), tri.slice(3, 6), tri.slice(6, 9)],
  ];
  for (const region of regions) {
    pieces = pieces.flatMap((p) => outside(p, region));
  }
  const out: number[] = [];
  for (const p of pieces) {
    if (p.length < 3 || area2(p) / 2 < SLIVER_M2) {
      continue;
    }
    for (let k = 1; k + 1 < p.length; k++) {
      out.push(...p[0], ...p[k], ...p[k + 1]);
    }
  }
  return out;
}

/** Whether a triangle can touch a region at all: no plane of it has the
 *  whole triangle beyond. */
export function touches(
  tri: readonly number[],
  region: readonly Plane[]
): boolean {
  return region.every(
    (pl) =>
      side(pl, tri.slice(0, 3)) < EPS ||
      side(pl, tri.slice(3, 6)) < EPS ||
      side(pl, tri.slice(6, 9)) < EPS
  );
}

/** The ground under the axis at plan point `q`: its nearest segment's,
 *  interpolated along it. */
export function groundUnder(
  p: Pick<PassageAxis, "axis" | "ground">,
  q: readonly [number, number]
): number {
  let best = Number.POSITIVE_INFINITY;
  let z = p.ground[0];
  for (let k = 0; k + 1 < p.axis.length; k++) {
    const a = p.axis[k];
    const b = p.axis[k + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t =
      l2 > 0
        ? Math.min(
            Math.max(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2, 0),
            1
          )
        : 0;
    const d = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
    if (d < best) {
      best = d;
      z = p.ground[k] + t * (p.ground[k + 1] - p.ground[k]);
    }
  }
  return z;
}

/** A polygon triangulation (flat x, y; hole starts → index triples). */
export type Triangulate = (data: number[], holes: number[]) => number[];

/**
 * A passage's lining in one object: the walls along it (each piece walked
 * with the passage on its left, recentred), from `SINK.wall` under the
 * ground to the ceiling, facing in; and the ceiling over its plan (outer
 * rings, recentred) at `h` over the ground, facing down.
 */
export function passageLining(
  p: PassageAxis,
  part: {
    roof: readonly (readonly [number, number])[][];
    sides: readonly (readonly [number, number])[][];
  },
  triangulate: Triangulate
): number[] {
  const out: number[] = [];
  const floor = (q: readonly [number, number]) => groundUnder(p, q) - SINK.wall;
  const top = (q: readonly [number, number]) => groundUnder(p, q) + p.h;
  for (const piece of part.sides) {
    for (let k = 0; k + 1 < piece.length; k++) {
      const a = piece[k];
      const b = piece[k + 1];
      const A = [a[0], a[1], floor(a)];
      const B = [b[0], b[1], floor(b)];
      const C = [b[0], b[1], top(b)];
      const D = [a[0], a[1], top(a)];
      // the passage on the walk's left: wound A D C, A C B
      out.push(...A, ...D, ...C, ...A, ...C, ...B);
    }
  }
  for (const ring of part.roof) {
    const open =
      ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring;
    const tris = triangulate(
      open.flatMap((q) => [q[0], q[1]]),
      []
    );
    for (let k = 0; k + 2 < tris.length; k += 3) {
      const [a, b, c] = [open[tris[k]], open[tris[k + 1]], open[tris[k + 2]]];
      const ccw =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      // clockwise seen from above faces down
      const [q, r] = ccw ? [c, b] : [b, c];
      out.push(a[0], a[1], top(a), q[0], q[1], top(q), r[0], r[1], top(r));
    }
  }
  return out;
}
