/**
 * The LoD2 roofs that miss the measured surface, rebuilt from DOM1 in the
 * shape it shows (pipeline/bake/roofs.py), put in place of their objects'
 * LoD2 triangles in the city mesh (scripts/bake-city-mesh.ts).
 *
 * Every part of an object is a prism from the object's own LoD2 base (the
 * lowest vertex of its LoD2 shell: where its walls stood on the ground
 * before) up to the part's roof — flat at its measured `z`, or, for a face
 * (a pitched roof, a vault, a dome), its measured surface: an
 * error-bounded TIN of the surface grid (`FACE_TIN_MAX_ERROR`), its
 * vertices inside the outline triangulated with the outline's own points
 * where the height along it bends, the walls' tops on those same points —
 * as flat non-indexed triangles wound counter-clockwise seen from outside
 * (the clay material draws front faces). No floor: it lies under the
 * ground, and a ray from the sun through a part leaves by the walls facing
 * away, the back faces the shadow pass draws, wherever it reaches anything
 * that can be seen (a floor would add a sixth of the site's triangles). Two
 * parts side by side each stand their own wall on the shared edge; the
 * lower one's is inside the higher, the higher one's shows above the lower
 * roof — the step. Ground beside the building higher than the base: the
 * walls run into it, as the LoD2 walls did; lower: the base is the LoD2's,
 * which already reached the lowest ground under the footprint (ADR 0035).
 */
import Delatin from "delatin";
import Delaunator from "delaunator";
import { ShapeUtils, Vector2 } from "three";
import type {
  MeasuredRoofFeature,
  MeasuredSurface,
} from "../lib/city/features";
import type { Point2 } from "../lib/city/polyline";

/**
 * Delatin tolerance (m) of a measured face: every grid point of its surface
 * lies within this of the mesh. A plane face collapses to a few triangles,
 * a dome or a vault keeps them where it bends.
 */
export const FACE_TIN_MAX_ERROR = 0.25;

/** One object's triangles in the recentered data frame (Z-up). */
export interface PrismMesh {
  /** 1 on roof vertices, 0 elsewhere */
  isRoof: number[];
  /** per vertex, the normal a face's roof shades with (smoothed over the
   *  face); NaN where the triangle's own flat normal is meant */
  normals: number[];
  /** x, y, z per vertex */
  positions: number[];
}

/** The measured parts by LoD2 object id. */
export function measuredRoofsById(
  features: readonly MeasuredRoofFeature[]
): Map<string, MeasuredRoofFeature[]> {
  const out = new Map<string, MeasuredRoofFeature[]>();
  for (const f of features) {
    const id = f.properties?.id;
    if (id === undefined || f.geometry.type !== "Polygon") {
      continue;
    }
    const parts = out.get(id);
    if (parts) {
      parts.push(f);
    } else {
      out.set(id, [f]);
    }
  }
  return out;
}

/** Twice the signed area of a ring (positive = counter-clockwise). */
function signedArea(ring: readonly Point2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

/** A GeoJSON ring without its closing point, wound as asked. */
function openRing(ring: readonly Point2[], ccw: boolean): Point2[] {
  const first = ring[0];
  const last = ring.at(-1);
  const open =
    first && last && first[0] === last[0] && first[1] === last[1]
      ? ring.slice(0, -1)
      : ring.slice();
  return signedArea(open) > 0 === ccw ? open : open.reverse();
}

/** A face's surface as a TIN: triangle k's plane z = a + b·x + c·y in
 *  `planes`, its corners counter-clockwise in `corners` (x, y), its extent
 *  in `boxes` (x0, y0, x1, y1). */
interface FaceTin {
  boxes: Float64Array;
  corners: Float64Array;
  count: number;
  planes: Float64Array;
}

/** The error-bounded TIN of a face's surface grid, its vertices on the cell
 *  centres, in the data frame. */
function faceTin(s: MeasuredSurface, z: number): FaceTin {
  const heights = Float64Array.from(s.dz, (d) => z + d / 100);
  const mesher = new Delatin(heights, s.cols, s.rows);
  mesher.run(FACE_TIN_MAX_ERROR);
  const { coords, triangles } = mesher;
  const count = triangles.length / 3;
  const corners = new Float64Array(count * 6);
  const planes = new Float64Array(count * 3);
  const boxes = new Float64Array(count * 4);
  for (let k = 0; k < count; k++) {
    const p = [0, 1, 2].map((j) => {
      const v = triangles[k * 3 + j];
      const gx = coords[v * 2];
      const gy = coords[v * 2 + 1];
      return [
        s.x + (gx + 0.5) * s.res,
        s.y - (gy + 0.5) * s.res,
        heights[gy * s.cols + gx],
      ];
    });
    // the grid's rows run south: wind each counter-clockwise from above
    if (cross2(p[0], p[1], p[2]) < 0) {
      [p[1], p[2]] = [p[2], p[1]];
    }
    const [a, b, c] = p;
    const det = cross2(a, b, c);
    // z = a0 + bx·x + by·y through the three corners
    const bx =
      ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / det;
    const by =
      ((c[2] - a[2]) * (b[0] - a[0]) - (b[2] - a[2]) * (c[0] - a[0])) / det;
    planes.set([a[2] - bx * a[0] - by * a[1], bx, by], k * 3);
    corners.set([a[0], a[1], b[0], b[1], c[0], c[1]], k * 6);
    boxes.set(
      [
        Math.min(a[0], b[0], c[0]),
        Math.min(a[1], b[1], c[1]),
        Math.max(a[0], b[0], c[0]),
        Math.max(a[1], b[1], c[1]),
      ],
      k * 4
    );
  }
  return { boxes, corners, count, planes };
}

/** Twice the signed area of the triangle (a, b, c) in plan. */
function cross2(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[]
) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function overlaps(t: FaceTin, k: number, box: readonly number[]): boolean {
  return (
    t.boxes[k * 4] <= box[2] &&
    t.boxes[k * 4 + 2] >= box[0] &&
    t.boxes[k * 4 + 1] <= box[3] &&
    t.boxes[k * 4 + 3] >= box[1]
  );
}

function tinCorner(t: FaceTin, k: number, j: number): Point2 {
  return [t.corners[k * 6 + j * 2], t.corners[k * 6 + j * 2 + 1]];
}

function planeZ(t: FaceTin, k: number, x: number, y: number): number {
  return t.planes[k * 3] + t.planes[k * 3 + 1] * x + t.planes[k * 3 + 2] * y;
}

/** The parameter interval [t0, t1] of the segment a → b inside TIN
 *  triangle k (Cyrus–Beck), or null when it misses it. */
function segmentInside(
  t: FaceTin,
  k: number,
  a: Point2,
  b: Point2
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  for (let e = 0; e < 3; e++) {
    const p = tinCorner(t, k, e);
    const q = tinCorner(t, k, (e + 1) % 3);
    const fa = (q[0] - p[0]) * (a[1] - p[1]) - (q[1] - p[1]) * (a[0] - p[0]);
    const fb = (q[0] - p[0]) * (b[1] - p[1]) - (q[1] - p[1]) * (b[0] - p[0]);
    if (fa < 0 && fb < 0) {
      return null;
    }
    if (fa < 0) {
      t0 = Math.max(t0, fa / (fa - fb));
    } else if (fb < 0) {
      t1 = Math.min(t1, fa / (fa - fb));
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

function segmentBox(a: Point2, b: Point2): number[] {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ];
}

/** Where along the segment a → b (as parameters 0..1, sorted, with both
 *  ends) it crosses the TIN's edges. */
function crossings(t: FaceTin, a: Point2, b: Point2): number[] {
  const box = segmentBox(a, b);
  const ts = [0, 1];
  for (let k = 0; k < t.count; k++) {
    const span = overlaps(t, k, box) ? segmentInside(t, k, a, b) : null;
    if (span) {
      ts.push(...span);
    }
  }
  ts.sort((x, y) => x - y);
  return ts.filter((x, i) => i === 0 || x - ts[i - 1] > 1e-9);
}

/** The TIN's height at `p` (any triangle holding it: on a shared edge two
 *  give the same), `fallback` outside it. */
function tinZ(t: FaceTin, p: Point2, fallback: number): number {
  for (let k = 0; k < t.count; k++) {
    if (!overlaps(t, k, [p[0], p[1], p[0], p[1]])) {
      continue;
    }
    const inside = [0, 1, 2].every(
      (e) =>
        cross2(tinCorner(t, k, e), tinCorner(t, k, (e + 1) % 3), p) >= -1e-9
    );
    if (inside) {
      return planeZ(t, k, p[0], p[1]);
    }
  }
  return fallback;
}

type Push = (
  roof: number,
  x: number,
  y: number,
  z: number,
  normal?: readonly number[]
) => void;

/** Inside the rings (even-odd: the outline less its courtyards). */
function insideRings(rings: Point2[][], [x, y]: Point2): boolean {
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

/** The distance from `p` to the segment a → b. */
function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const u =
    len2 > 0
      ? Math.min(
          Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0),
          1
        )
      : 0;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}

/** A TIN vertex closer than this to the outline is left to the outline's
 *  own points (a sliver otherwise). */
const OUTLINE_CLEARANCE_M = 0.25;
/** Rounds of splitting an outline edge the triangulation left out. */
const RECOVER_ROUNDS = 24;
/** How far (a share of its area) a face's roof may miss its outline. */
const COVER_TOLERANCE = 1e-3;
/** A face's facets turning more than this from each other meet at a
 *  crease (a ridge, a valley): its shading does not round it over. */
const CREASE_DEG = 30;
/** The normal of a vertex that shades with its triangle's own. */
const FLAT = [Number.NaN, Number.NaN, Number.NaN];

/** The points of the segment a → b where its height profile over the TIN
 *  bends by more than FACE_TIN_MAX_ERROR from the straight line between
 *  its ends (Douglas–Peucker over the TIN's crossings), `a` first, `b`
 *  left out. */
function profilePoints(
  t: FaceTin,
  a: Point2,
  b: Point2,
  top: number
): Point2[] {
  const at = (u: number): Point2 => [
    a[0] + u * (b[0] - a[0]),
    a[1] + u * (b[1] - a[1]),
  ];
  const us = crossings(t, a, b);
  const zs = us.map((u) => tinZ(t, at(u), top));
  const keep = new Set([0, us.length - 1]);
  const split = (i: number, j: number) => {
    let worst = -1;
    let dev = FACE_TIN_MAX_ERROR;
    for (let k = i + 1; k < j; k++) {
      const f = (us[k] - us[i]) / (us[j] - us[i]);
      const d = Math.abs(zs[k] - (zs[i] + f * (zs[j] - zs[i])));
      if (d > dev) {
        dev = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep.add(worst);
      split(i, worst);
      split(worst, j);
    }
  };
  split(0, us.length - 1);
  return [...keep]
    .sort((x, y) => x - y)
    .slice(0, -1)
    .map((k) => at(us[k]));
}

/** The outline's rings with a point wherever their height profile over
 *  the TIN bends (`profilePoints`). */
function densifiedRings(
  rings: Point2[][],
  tin: FaceTin,
  top: number
): Point2[][] {
  return rings.map((ring) =>
    ring.flatMap((a, i) =>
      profilePoints(tin, a, ring[(i + 1) % ring.length], top)
    )
  );
}

/** A face's roof: the outline's rings it was made with, its points (the
 *  rings' first, then the TIN's inside them) and its triangles over them. */
interface FaceRoof {
  points: Point2[];
  rings: Point2[][];
  triangles: number[];
}

/** For each point, the first index of a point at the same place (the
 *  triangulation skips duplicates). */
function canonicalIds(points: readonly Point2[]): number[] {
  const first = new Map<string, number>();
  return points.map((p, i) => {
    const key = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    const id = first.get(key);
    if (id !== undefined) {
      return id;
    }
    first.set(key, i);
    return i;
  });
}

/** A Delaunay triangulation of the outline's points and the TIN's vertices
 *  inside it; an outline edge it leaves out is split at its middle (the
 *  rings grow) until every one is an edge of it, then the triangles outside
 *  the outline are dropped. */
function conformingRoof(rings: Point2[][], inner: readonly Point2[]): FaceRoof {
  let current = rings;
  for (let round = 0; ; round++) {
    const points = [...current.flat(), ...inner];
    const ids = canonicalIds(points);
    const t = new Delaunator(Float64Array.from(points.flat())).triangles;
    const edges = new Set<string>();
    for (let k = 0; k < t.length; k += 3) {
      for (let e = 0; e < 3; e++) {
        const a = ids[t[k + e]];
        const b = ids[t[k + ((e + 1) % 3)]];
        edges.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
    let missing = 0;
    let start = 0;
    const next = current.map((ring) => {
      const out: Point2[] = [];
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length];
        const a = ids[start + i];
        const b = ids[start + ((i + 1) % ring.length)];
        out.push(p);
        if (a !== b && !edges.has(a < b ? `${a}|${b}` : `${b}|${a}`)) {
          missing++;
          out.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
        }
      });
      start += ring.length;
      return out;
    });
    if (missing === 0 || round >= RECOVER_ROUNDS) {
      const triangles: number[] = [];
      for (let k = 0; k < t.length; k += 3) {
        const [a, b, c] = [t[k], t[k + 1], t[k + 2]].map((v) => points[v]);
        const centroid: Point2 = [
          (a[0] + b[0] + c[0]) / 3,
          (a[1] + b[1] + c[1]) / 3,
        ];
        const area = cross2(a, b, c);
        if (Math.abs(area) > 1e-9 && insideRings(current, centroid)) {
          // counter-clockwise from above (y north)
          triangles.push(
            t[k],
            ...(area > 0 ? [t[k + 1], t[k + 2]] : [t[k + 2], t[k + 1]])
          );
        }
      }
      return { points, rings: current, triangles };
    }
    current = next;
  }
}

/** The TIN's vertices inside the outline and clear of it. */
function innerVertices(rings: Point2[][], tin: FaceTin): Point2[] {
  const out: Point2[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < tin.count; k++) {
    for (let j = 0; j < 3; j++) {
      const p = tinCorner(tin, k, j);
      const key = `${p[0]},${p[1]}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const clear = rings.every((ring) =>
        ring.every(
          (a, i) =>
            segmentDistance(p, a, ring[(i + 1) % ring.length]) >=
            OUTLINE_CLEARANCE_M
        )
      );
      if (clear && insideRings(rings, p)) {
        out.push(p);
      }
    }
  }
  return out;
}

/** A face: its surface as one triangulation of the TIN's vertices and the
 *  outline's points (`conformingRoof`), each on the TIN, and walls along
 *  the outline from `base` up to those same points. */
function facePrism(
  rings: Point2[][],
  tin: FaceTin,
  base: number,
  top: number,
  push: Push
): void {
  const roof = conformingRoof(
    densifiedRings(rings, tin, top),
    innerVertices(rings, tin)
  );
  // a triangulation that does not cover the outline exactly (the edges
  // not recovered in RECOVER_ROUNDS) would leave a hole: the part stands
  // flat at its median instead
  let covered = 0;
  for (let k = 0; k < roof.triangles.length; k += 3) {
    const [a, b, c] = [0, 1, 2].map((j) => roof.points[roof.triangles[k + j]]);
    covered += cross2(a, b, c) / 2;
  }
  const area = rings.reduce((sum, ring) => sum + signedArea(ring) / 2, 0);
  if (Math.abs(covered - area) > COVER_TOLERANCE * area) {
    flatPrism(rings, base, top, push);
    return;
  }
  const height = (p: Point2) => Math.max(tinZ(tin, p, top), base);
  const z = roof.points.map(height);
  // smooth over the face, not across a crease: each corner's normal the
  // area-weighted sum of its point's triangles that turn less than
  // CREASE_DEG from its own (the TIN's facets would otherwise show as a
  // crumpled sheet; a ridge stays a ridge)
  const t = roof.triangles;
  const facets: number[][] = [];
  const around = roof.points.map((): number[] => []);
  for (let k = 0; k < t.length; k += 3) {
    const [pa, pb, pc] = [t[k], t[k + 1], t[k + 2]].map((v) => [
      ...roof.points[v],
      z[v],
    ]);
    const u = [0, 1, 2].map((j) => pb[j] - pa[j]);
    const w = [0, 1, 2].map((j) => pc[j] - pa[j]);
    facets.push([
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ]);
    for (let j = 0; j < 3; j++) {
      around[t[k + j]].push(k / 3);
    }
  }
  const unit = (n: readonly number[]) => {
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    return n.map((x) => x / len);
  };
  const cosCrease = Math.cos((CREASE_DEG * Math.PI) / 180);
  for (let k = 0; k < t.length; k++) {
    const own = unit(facets[Math.floor(k / 3)]);
    const n = [0, 0, 0];
    for (const f of around[t[k]]) {
      const other = facets[f];
      const o = unit(other);
      if (own[0] * o[0] + own[1] * o[1] + own[2] * o[2] >= cosCrease) {
        n[0] += other[0];
        n[1] += other[1];
        n[2] += other[2];
      }
    }
    const p = roof.points[t[k]];
    push(1, p[0], p[1], z[t[k]], unit(n));
  }
  for (const ring of roof.rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const [zp, zq] = [height(p), height(q)];
      push(0, p[0], p[1], base);
      push(0, q[0], q[1], base);
      push(0, q[0], q[1], zq);
      push(0, p[0], p[1], base);
      push(0, q[0], q[1], zq);
      push(0, p[0], p[1], zp);
    }
  }
}

/** A flat part: walls from `base` to `top` and a flat roof at `top`. */
function flatPrism(rings: Point2[][], base: number, top: number, push: Push) {
  const [contour, ...holes] = rings;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      push(0, ax, ay, base);
      push(0, bx, by, base);
      push(0, bx, by, top);
      push(0, ax, ay, base);
      push(0, bx, by, top);
      push(0, ax, ay, top);
    }
  }
  const all = [contour, ...holes].flat();
  const tris = ShapeUtils.triangulateShape(
    contour.map(([x, y]) => new Vector2(x, y)),
    holes.map((h) => h.map(([x, y]) => new Vector2(x, y)))
  );
  for (const [a, b, c] of tris) {
    // counter-clockwise from above
    const [p, q, r] = [all[a], all[b], all[c]];
    const [u, v] = cross2(p, q, r) > 0 ? [q, r] : [r, q];
    push(1, p[0], p[1], top);
    push(1, u[0], u[1], top);
    push(1, v[0], v[1], top);
  }
}

/**
 * The prisms of one object's parts, `offset` subtracted from x and y (the
 * tileset's recenter offset). A part whose roof is not above `base` is
 * left out.
 */
export function measuredRoofMesh(
  parts: readonly MeasuredRoofFeature[],
  base: number,
  offset: { cx: number; cy: number }
): PrismMesh {
  const out: PrismMesh = { isRoof: [], normals: [], positions: [] };
  const push: Push = (roof, x, y, z, normal) => {
    out.positions.push(x - offset.cx, y - offset.cy, z);
    out.isRoof.push(roof);
    out.normals.push(...(normal ?? FLAT));
  };
  for (const f of parts) {
    const top = f.properties?.z;
    const [outer, ...inner] = f.geometry.coordinates;
    if (top === undefined || top <= base || outer === undefined) {
      continue;
    }
    // Outside on the right of every edge: the outer ring counter-clockwise,
    // the holes clockwise (seen from above).
    const contour = openRing(outer, true);
    if (contour.length < 3) {
      continue;
    }
    const rings = [contour, ...inner.map((h) => openRing(h, false))];
    const surface = f.properties?.surface;
    if (surface) {
      facePrism(rings, faceTin(surface, top), base, top, push);
    } else {
      flatPrism(rings, base, top, push);
    }
  }
  return out;
}
