/**
 * A shop window as a real opening in its LoD2 wall (the building bake,
 * scripts/bake-city-mesh.ts `appendShopfronts`): the wall's triangles cut
 * round each measured bay, a box of reveals into the building (sill, head
 * and sides in the wall's own clay) and the glass at its back — the same
 * logic as the clay's windows over it (a recess the eye looks into, its
 * reveals lit by what reaches past the wall), only real at every distance
 * and as wide as the bay the street photos measured.
 *
 * Works in the wall's own terms: `s` metres along it (from the shopfront's
 * `a`), `z` absolute height, the wall's plane found from the triangles
 * themselves (LoD2 walls are seldom exactly where the footprint line is).
 * A bay the wall's triangles do not cover (a jog, a passage) is not cut.
 * Pure, no THREE.
 */
import earcut from "earcut";
import { difference, intersection } from "polygon-clipping";
import type { Polygon as ClipPolygon, Ring } from "polygon-clipping";
import type { V3 } from "./doors";

/** How deep a shop window's reveals run into the wall (m) — a window's are
 *  9–18 cm by type; a shop window, set in its frame, a little deeper. */
export const SHOP_WINDOW_DEPTH_M = 0.2;
/** How much of an opening the wall's triangles must cover to cut it. */
const MIN_COVER = 0.95;
/** A wall triangle: facing the wall's way within this (cos) … */
const FACING_COS = 0.985;
/** … and standing within this of its plane (m). */
const PLANE_M = 0.12;

/** An opening on the wall: along it (m from `a`) and up (absolute). */
export interface Opening {
  s0: number;
  s1: number;
  z0: number;
  z1: number;
}

/** The wall's frame: a point at `s` along it, `out` of it, height `z`. */
export interface WallAxes {
  at: (s: number, out: number, z: number) => V3;
  n: V3;
  t: V3;
}

/** A triangle the cut may take a piece of: its corners and an id. */
export interface WallTriangle {
  id: number;
  p: readonly [V3, V3, V3];
}

/** A triangle replaced by the cut: its id, the triangles that take its
 *  place (positions, flat, wound as it was). */
export interface CutTriangle {
  id: number;
  positions: number[];
}

/** What cutting the openings into a wall gives. */
export interface WallCut {
  /** the openings the wall covered, cut */
  openings: Opening[];
  /** the triangles that lost a piece, each with its remainder */
  replaced: CutTriangle[];
  /** each cut opening's corners on the wall's face (s0z0, s1z0, s1z1,
   *  s0z1) */
  corners: V3[][];
  /** what the openings took out of the wall, triangulated on each
   *  triangle's own plane and wound as it was (positions, flat) — a
   *  painted sign laid back flush; empty unless asked for */
  taken: number[];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A triangle in the wall's terms, with what maps a point back onto it. */
interface Flat {
  id: number;
  three: [V3, V3, V3];
  two: [number, number][];
  normal: V3;
}

/** The triangles among `triangles` facing the wall's way, in the wall's
 *  (s, z). */
function facing(axes: WallAxes, triangles: readonly WallTriangle[]): Flat[] {
  const origin = axes.at(0, 0, 0);
  const out: Flat[] = [];
  for (const { id, p } of triangles) {
    const three: [V3, V3, V3] = [p[0], p[1], p[2]];
    const normal = cross(sub(three[1], three[0]), sub(three[2], three[0]));
    const len = Math.hypot(...normal);
    if (len < 1e-9 || dot(normal, axes.n) < FACING_COS * len) {
      continue;
    }
    out.push({
      id,
      three,
      two: three.map((q): [number, number] => [
        dot(sub(q, origin), axes.t),
        q[2],
      ]),
      normal: [normal[0] / len, normal[1] / len, normal[2] / len],
    });
  }
  return out;
}

/** How far out of the wall's frame `f`'s plane stands at (s, z) (m, along
 *  the wall's normal): a LoD2 wall turns a little off the footprint line,
 *  so it is read where the opening is, not at the triangle's corners. */
function standOff(axes: WallAxes, f: Flat, s: number, z: number): number {
  const p = axes.at(s, 0, z);
  return dot(sub(f.three[0], p), f.normal) / dot(axes.n, f.normal);
}

const rectRing = (o: Opening): Ring => [
  [o.s0, o.z0],
  [o.s1, o.z0],
  [o.s1, o.z1],
  [o.s0, o.z1],
  [o.s0, o.z0],
];

/** The area of a clipped polygon set (shoelace, holes subtracted). */
function areaOf(polys: readonly ClipPolygon[]): number {
  let sum = 0;
  for (const poly of polys) {
    for (const [k, ring] of poly.entries()) {
      let a = 0;
      for (let i = 0; i + 1 < ring.length; i += 1) {
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      sum += (k === 0 ? 1 : -1) * Math.abs(a / 2);
    }
  }
  return sum;
}

/** A point of the wall's (s, z) on triangle `f`'s plane (barycentric);
 *  one of its own corners exactly as it was, so the remainder still shares
 *  its vertices with the wall around it (lib/city/windows.ts joins a
 *  wall's triangles by them). */
function lift(f: Flat, [s, z]: readonly number[]): V3 {
  const own = f.two.findIndex(
    ([u, v]) => Math.abs(u - s) < 1e-9 && Math.abs(v - z) < 1e-9
  );
  if (own !== -1) {
    return f.three[own];
  }
  const [[x0, y0], [x1, y1], [x2, y2]] = f.two;
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  const l0 = ((y1 - y2) * (s - x2) + (x2 - x1) * (z - y2)) / d;
  const l1 = ((y2 - y0) * (s - x2) + (x0 - x2) * (z - y2)) / d;
  const l2 = 1 - l0 - l1;
  const [a, b, c] = f.three;
  return [
    l0 * a[0] + l1 * b[0] + l2 * c[0],
    l0 * a[1] + l1 * b[1] + l2 * c[1],
    l0 * a[2] + l1 * b[2] + l2 * c[2],
  ];
}

/** `polys` (in the wall's s, z) as triangles on `f`'s plane, wound to
 *  face as `f` does. */
function triangulate(f: Flat, polys: readonly ClipPolygon[]): number[] {
  const out: number[] = [];
  for (const poly of polys) {
    const flat: number[] = [];
    const holes: number[] = [];
    const pts: [number, number][] = [];
    for (const [k, ring] of poly.entries()) {
      if (k > 0) {
        holes.push(pts.length);
      }
      // the clipper closes its rings: drop the repeated first point
      for (const q of ring.slice(0, -1)) {
        pts.push([q[0], q[1]]);
        flat.push(q[0], q[1]);
      }
    }
    const index = earcut(flat, holes, 2);
    for (let i = 0; i + 2 < index.length; i += 3) {
      const tri = [index[i], index[i + 1], index[i + 2]].map((k) =>
        lift(f, pts[k])
      );
      const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
      if (Math.hypot(...n) < 1e-9) {
        continue;
      }
      const order = dot(n, f.normal) < 0 ? [0, 2, 1] : [0, 1, 2];
      for (const k of order) {
        out.push(...tri[k]);
      }
    }
  }
  return out;
}

/**
 * Cuts `openings` into the wall: the triangles of `triangles` lying on it
 * (facing `axes.n`, on its plane) lose the rectangles, each remainder
 * triangulated on its own triangle's plane. An opening the wall covers
 * less than MIN_COVER of stays uncut (not in `openings`). With `keep`,
 * what was cut out comes back too (`taken`): a sign painted on the wall,
 * the same plane in another object.
 */
export function cutWall(
  axes: WallAxes,
  openings: readonly Opening[],
  triangles: readonly WallTriangle[],
  keep = false
): WallCut {
  const flats = facing(axes, triangles);
  const kept: Opening[] = [];
  const corners: V3[][] = [];
  // per triangle the openings that cut it
  const cuts = new Map<Flat, ClipPolygon[]>();
  for (const o of openings) {
    const rect: ClipPolygon = [rectRing(o)];
    const [sc, zc] = [(o.s0 + o.s1) / 2, (o.z0 + o.z1) / 2];
    let covered = 0;
    let best: { f: Flat; a: number } | undefined;
    const on: Flat[] = [];
    for (const f of flats) {
      const a = areaOf(intersection([[...f.two, f.two[0]]], rect));
      if (a <= 1e-6 || Math.abs(standOff(axes, f, sc, zc)) > PLANE_M) {
        continue;
      }
      on.push(f);
      covered += a;
      if (a > (best?.a ?? 0)) {
        best = { f, a };
      }
    }
    const area = (o.s1 - o.s0) * (o.z1 - o.z0);
    if (!best || area <= 0 || covered < MIN_COVER * area) {
      continue;
    }
    kept.push(o);
    for (const f of on) {
      cuts.set(f, [...(cuts.get(f) ?? []), rect]);
    }
    const plane = best.f;
    corners.push(
      [
        [o.s0, o.z0],
        [o.s1, o.z0],
        [o.s1, o.z1],
        [o.s0, o.z1],
      ].map((p) => lift(plane, p))
    );
  }
  const replaced: CutTriangle[] = [];
  const taken: number[] = [];
  for (const [f, rects] of cuts) {
    const tri: ClipPolygon = [[...f.two, f.two[0]]];
    replaced.push({
      id: f.id,
      positions: triangulate(f, difference(tri, ...rects)),
    });
    if (keep) {
      for (const rect of rects) {
        taken.push(...triangulate(f, intersection(tri, rect)));
      }
    }
  }
  return { openings: kept, replaced, corners, taken };
}

/** Two triangles over a quad, wound to face `want`. */
function quad(out: number[], [a, b, c, d]: readonly V3[], want: V3): void {
  const n = cross(sub(b, a), sub(c, a));
  const [p, q, r, s] = dot(n, want) < 0 ? [a, d, c, b] : [a, b, c, d];
  out.push(...p, ...q, ...r, ...p, ...r, ...s);
}

/** An opening's box behind the wall's face: the reveals (sill, head, two
 *  sides, each facing into the opening) and the glass at the back. */
export function openingBox(
  axes: WallAxes,
  corners: readonly V3[],
  depth = SHOP_WINDOW_DEPTH_M
): { glass: number[]; reveals: number[] } {
  const [n0, n1] = [axes.n[0], axes.n[1]];
  const back = corners.map((p): V3 => [
    p[0] - n0 * depth,
    p[1] - n1 * depth,
    p[2],
  ]);
  const [f0, f1, f2, f3] = corners;
  const [b0, b1, b2, b3] = back;
  const reveals: number[] = [];
  const minusT: V3 = [-axes.t[0], -axes.t[1], 0];
  quad(reveals, [f0, f1, b1, b0], [0, 0, 1]);
  quad(reveals, [f3, f2, b2, b3], [0, 0, -1]);
  quad(reveals, [f0, f3, b3, b0], axes.t);
  quad(reveals, [f1, f2, b2, b1], minusT);
  const glass: number[] = [];
  quad(glass, back, axes.n);
  return { glass, reveals };
}
