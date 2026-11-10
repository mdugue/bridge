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
  /** each cut opening's edge on the wall's face as a loop from its s0z0
   *  corner round by s1z0, s1z1 and s0z1: its corners and every vertex
   *  the wall's remainder has on it, the same points (no T-junction
   *  between the wall and the reveals for the glTF's quantisation to
   *  crack open) */
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

/** Whether a triangle's (s, z) bounds overlap an opening's. */
function overlaps(two: readonly (readonly number[])[], o: Opening): boolean {
  let [s0, s1, z0, z1] = [
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const [s, z] of two) {
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return s1 > o.s0 && s0 < o.s1 && z1 > o.z0 && z0 < o.z1;
}

/**
 * Cuts `openings` into the wall: the triangles of `triangles` lying on it
 * (facing `axes.n`, on its plane) lose the rectangles, each remainder
 * triangulated on its own triangle's plane. An opening the wall covers
 * less than `minCover` of (MIN_COVER) stays uncut (not in `openings`).
 * With `keep`, what was cut out comes back too (`taken`): a sign painted
 * on the wall, the same plane in another object, which takes whatever of
 * it the wall covers (`minCover` 0).
 */
export function cutWall(
  axes: WallAxes,
  openings: readonly Opening[],
  triangles: readonly WallTriangle[],
  { keep = false, minCover = MIN_COVER } = {}
): WallCut {
  const flats = facing(axes, triangles);
  const kept: Opening[] = [];
  const planes: Flat[] = [];
  // per triangle the openings that cut it
  const cuts = new Map<Flat, ClipPolygon[]>();
  for (const o of openings) {
    const rect: ClipPolygon = [rectRing(o)];
    const [sc, zc] = [(o.s0 + o.s1) / 2, (o.z0 + o.z1) / 2];
    let covered = 0;
    let best: { f: Flat; a: number } | undefined;
    const on: Flat[] = [];
    for (const f of flats) {
      // (one apart from it in (s, z) cannot cut it: no clipping asked)
      if (!overlaps(f.two, o)) {
        continue;
      }
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
    if (!best || area <= 0 || covered < minCover * area) {
      continue;
    }
    kept.push(o);
    for (const f of on) {
      cuts.set(f, [...(cuts.get(f) ?? []), rect]);
    }
    planes.push(best.f);
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
  const corners = kept.map((o, k) => edgeLoop(axes, o, planes[k], replaced));
  return { openings: kept, replaced, corners, taken };
}

/** Where along an opening's edge loop (s0z0 → s1z0 → s1z1 → s0z1) a
 *  point of it lies, 0…4; undefined off the edge. */
function loopAt(o: Opening, s: number, z: number): number | undefined {
  const e = 1e-6;
  const inS = s > o.s0 - e && s < o.s1 + e;
  const inZ = z > o.z0 - e && z < o.z1 + e;
  if (Math.abs(z - o.z0) < e && inS) {
    return (s - o.s0) / (o.s1 - o.s0);
  }
  if (Math.abs(s - o.s1) < e && inZ) {
    return 1 + (z - o.z0) / (o.z1 - o.z0);
  }
  if (Math.abs(z - o.z1) < e && inS) {
    return 2 + (o.s1 - s) / (o.s1 - o.s0);
  }
  if (Math.abs(s - o.s0) < e && inZ) {
    // the s0z0 corner closes the loop at 0, not 4
    const t = 3 + (o.z1 - z) / (o.z1 - o.z0);
    return t > 4 - 1e-9 ? 0 : t;
  }
  return undefined;
}

/** An opening's edge loop: its corners (the wall's own vertex there, else
 *  lifted onto `plane`) and the remainder's vertices along it, in order. */
function edgeLoop(
  axes: WallAxes,
  o: Opening,
  plane: Flat,
  replaced: readonly CutTriangle[]
): V3[] {
  const origin = axes.at(0, 0, 0);
  const found = new Map<number, V3>();
  for (const { positions } of replaced) {
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const q: V3 = [positions[i], positions[i + 1], positions[i + 2]];
      const at = loopAt(o, dot(sub(q, origin), axes.t), q[2]);
      if (at !== undefined) {
        found.set(Math.round(at * 1e6), q);
      }
    }
  }
  for (const [k, [cs, cz]] of [
    [o.s0, o.z0],
    [o.s1, o.z0],
    [o.s1, o.z1],
    [o.s0, o.z1],
  ].entries()) {
    const key = k * 1e6;
    if (!found.has(key)) {
      found.set(key, lift(plane, [cs, cz]));
    }
  }
  return [...found.entries()].toSorted(([a], [b]) => a - b).map(([, q]) => q);
}

/** Two triangles over a quad, wound to face `want`. */
function quad(out: number[], [a, b, c, d]: readonly V3[], want: V3): void {
  const n = cross(sub(b, a), sub(c, a));
  const [p, q, r, s] = dot(n, want) < 0 ? [a, d, c, b] : [a, b, c, d];
  out.push(...p, ...q, ...r, ...p, ...r, ...s);
}

/** An opening's box behind the wall's face: the reveals (sill, head, two
 *  sides, each facing into the opening), a strip between each pair of
 *  the edge loop's points (`cutWall`'s `corners`), and the glass at the
 *  back, a fan over the loop's back. */
export function openingBox(
  axes: WallAxes,
  loop: readonly V3[],
  depth = SHOP_WINDOW_DEPTH_M
): { glass: number[]; reveals: number[] } {
  const [n0, n1] = [axes.n[0], axes.n[1]];
  const backOf = (p: V3): V3 => [p[0] - n0 * depth, p[1] - n1 * depth, p[2]];
  const minusT: V3 = [-axes.t[0], -axes.t[1], 0];
  const reveals: number[] = [];
  for (let k = 0; k < loop.length; k += 1) {
    const a = loop[k];
    const b = loop[(k + 1) % loop.length];
    const ds = dot(sub(b, a), axes.t);
    const dz = b[2] - a[2];
    // along the bottom (+s) the sill faces up, up the s1 side it faces
    // −t, back along the head down, down the s0 side +t
    let want: V3 = Math.abs(ds) >= Math.abs(dz) ? [0, 0, 1] : minusT;
    if (Math.abs(ds) >= Math.abs(dz) && ds < 0) {
      want = [0, 0, -1];
    } else if (Math.abs(ds) < Math.abs(dz) && dz < 0) {
      want = axes.t;
    }
    quad(reveals, [a, b, backOf(b), backOf(a)], want);
  }
  const back = loop.map(backOf);
  const mid: V3 = [0, 1, 2].map(
    (c) => back.reduce((sum, p) => sum + p[c], 0) / back.length
  ) as V3;
  const glass: number[] = [];
  for (let k = 0; k < back.length; k += 1) {
    const a = back[k];
    const b = back[(k + 1) % back.length];
    const n = cross(sub(a, mid), sub(b, mid));
    const wound = dot(n, axes.n) < 0 ? [mid, b, a] : [mid, a, b];
    for (const q of wound) {
      glass.push(...q);
    }
  }
  return { glass, reveals };
}
