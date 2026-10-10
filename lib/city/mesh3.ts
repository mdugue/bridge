/**
 * Triangle soups for the stylised parts the city is dressed with — rails,
 * tram tracks, bridge decks, landing stages — in the Y-up scene frame:
 * positions and per-vertex normals, every triangle wound to face its
 * normal, so every material can stay FrontSide. The build bakes the rails,
 * trams and riverside into the fine terrain glTF with them
 * (scripts/bake-lines.ts, ADR 0029); the viewer draws the bridges with the
 * same helpers (app/_components/rail-layer.ts). No THREE, no DOM: a
 * polygon's triangulation is handed in (`Triangulate`, three's
 * `ShapeUtils.triangulateShape` on both sides).
 */

/** A 2D point of a contour handed to a `Triangulate`. */
export interface XY {
  x: number;
  y: number;
}

/**
 * A polygon's triangulation: `contour` and its `holes` (a closing point
 * equal to the first is dropped) → triangles as index triples into the
 * contour followed by the holes. three's `ShapeUtils.triangulateShape`.
 */
export type Triangulate = (
  contour: readonly XY[],
  holes: readonly (readonly XY[])[]
) => number[][];

/** Accumulates a non-indexed triangle soup (positions + per-vertex normals). */
export interface Mesh3 {
  /** per vertex, a bridge deck's frame (bridge-surface.ts `aDeck`): its
   *  station, offset, and the outline's left and right offsets there */
  deck?: number[];
  nrm: number[];
  pos: number[];
}

export function mesh3(): Mesh3 {
  return { pos: [], nrm: [] };
}

export type P3 = [number, number, number];

/** A point of a line in the Y-up scene frame. */
export interface Pt {
  x: number;
  y: number;
  z: number;
}

/**
 * Pushes a triangle, AUTO-WINDING it so its front face matches `n`. This is the
 * single guarantee that lets every material be FrontSide: regardless of the
 * input vertex order, the emitted winding agrees with the supplied normal, so no
 * face can vanish under back-face culling.
 */
export function pushTri(
  acc: Mesh3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number
): void {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const gx = uy * vz - uz * vy;
  const gy = uz * vx - ux * vz;
  const gz = ux * vy - uy * vx;
  if (gx * nx + gy * ny + gz * nz >= 0) {
    acc.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  } else {
    acc.pos.push(ax, ay, az, cx, cy, cz, bx, by, bz);
  }
  acc.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

/**
 * Two triangles p0 p1 p2, p0 p2 p3 facing `n`. Indexed, not spread: WebKit
 * runs a spread in a call through the iterator protocol, and a tile's tram
 * tracks are ~10⁵ quads — on an iPhone the spreads alone held a frame for
 * a quarter of a second.
 */
export function quad(acc: Mesh3, p0: P3, p1: P3, p2: P3, p3: P3, n: P3): void {
  quadXYZ(
    acc,
    p0[0],
    p0[1],
    p0[2],
    p1[0],
    p1[1],
    p1[2],
    p2[0],
    p2[1],
    p2[2],
    p3[0],
    p3[1],
    p3[2],
    n[0],
    n[1],
    n[2]
  );
}

/** `quad` on plain numbers: nothing allocated per quad. */
export function quadXYZ(
  acc: Mesh3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
  nx: number,
  ny: number,
  nz: number
): void {
  pushTri(acc, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz);
  pushTri(acc, ax, ay, az, cx, cy, cz, dx, dy, dz, nx, ny, nz);
}

/** A ring in the Y-up frame (lib/city/decks.ts `Ring2`'s shape). */
interface RingXZ {
  pts: readonly { x: number; z: number }[];
}

/**
 * Triangulates a footprint into a top face at per-vertex `topY` plus a continuous
 * outward-facing fascia dropping `depth` — one solid slab volume, not stacked
 * planes. Used for ballast areas, bridge decks, and platforms. `underside`
 * closes the slab from below too (a bridge deck, seen from under it).
 */
export function addFootprint(
  acc: Mesh3,
  ring: RingXZ,
  topY: number[],
  depth: number,
  triangulate: Triangulate,
  underside = false
): void {
  const { pts } = ring;
  if (pts.length < 3) {
    return;
  }
  const tris = triangulate(
    pts.map((p) => ({ x: p.x, y: p.z })),
    []
  );
  for (const [a, b, c] of tris) {
    pushTri(
      acc,
      pts[a].x,
      topY[a],
      pts[a].z,
      pts[b].x,
      topY[b],
      pts[b].z,
      pts[c].x,
      topY[c],
      pts[c].z,
      0,
      1,
      0
    );
    if (underside) {
      pushTri(
        acc,
        pts[a].x,
        topY[a] - depth,
        pts[a].z,
        pts[b].x,
        topY[b] - depth,
        pts[b].z,
        pts[c].x,
        topY[c] - depth,
        pts[c].z,
        0,
        -1,
        0
      );
    }
  }
  const winding = ringWinding(pts);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const [nx, nz] = outward(pts, i, winding);
    quad(
      acc,
      [pts[i].x, topY[i], pts[i].z],
      [pts[j].x, topY[j], pts[j].z],
      [pts[j].x, topY[j] - depth, pts[j].z],
      [pts[i].x, topY[i] - depth, pts[i].z],
      [nx, 0, nz]
    );
  }
}

/** +1 when the ring runs counter-clockwise in (x, z), else −1. */
export function ringWinding(pts: readonly { x: number; z: number }[]): 1 | -1 {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area >= 0 ? 1 : -1;
}

/**
 * The outward normal (x, z; the edge's length) of ring edge i, from the
 * ring's winding. (A test against the ring's centroid, used before, points
 * the inner edge of a curved deck inwards: its centroid lies off the deck,
 * and those faces were culled from outside.)
 */
export function outward(
  pts: readonly { x: number; z: number }[],
  i: number,
  winding: 1 | -1
): [number, number] {
  const j = (i + 1) % pts.length;
  return [(pts[j].z - pts[i].z) * winding, -(pts[j].x - pts[i].x) * winding];
}

/** Axis-aligned box column (4 sides + top) for a bridge pier. */
export function addColumn(
  acc: Mesh3,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  h: number
): void {
  const c: [number, number][] = [
    [cx - h, cz - h],
    [cx + h, cz - h],
    [cx + h, cz + h],
    [cx - h, cz + h],
  ];
  for (let s = 0; s < 4; s++) {
    const a = c[s];
    const b = c[(s + 1) % 4];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    if (nx * (a[0] - cx) + nz * (a[1] - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    quad(
      acc,
      [a[0], y1, a[1]],
      [b[0], y1, b[1]],
      [b[0], y0, b[1]],
      [a[0], y0, a[1]],
      [nx, 0, nz]
    );
  }
  quad(
    acc,
    [c[0][0], y1, c[0][1]],
    [c[1][0], y1, c[1][1]],
    [c[2][0], y1, c[2][1]],
    [c[3][0], y1, c[3][1]],
    [0, 1, 0]
  );
}

/** The unit tangent (x, z as x, y) of a line at each of its points, from
 *  its neighbours; (1, 0) where they coincide. */
export function tangentsXZ(pts: readonly Pt[]): XY[] {
  const t: XY[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let x = b.x - a.x;
    let y = b.z - a.z;
    if (x * x + y * y === 0) {
      x = 1;
      y = 0;
    }
    const len = Math.sqrt(x * x + y * y) || 1;
    t.push({ x: x / len, y: y / len });
  }
  return t;
}

/**
 * A ribbon of half-width `half` offset `lateral` from a run of points: a
 * top face and a vertical web of depth `web` down each side (a rail, a
 * groove, a track bed; no webs at 0).
 */
export function addRibbon(
  acc: Mesh3,
  pts: readonly Pt[],
  lateral: number,
  half: number,
  web: number
): void {
  if (pts.length < 2) {
    return;
  }
  const tan = tangentsXZ(pts);
  const side = (sign: number) =>
    pts.map((p, i) => {
      const nx = -tan[i].y;
      const nz = tan[i].x;
      return {
        x: p.x + nx * (lateral + sign * half),
        y: p.y,
        z: p.z + nz * (lateral + sign * half),
      };
    });
  const left = side(1);
  const right = side(-1);
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = left[i];
    const l1 = left[i + 1];
    const r0 = right[i];
    const r1 = right[i + 1];
    // top
    quadXYZ(
      acc,
      l0.x,
      l0.y,
      l0.z,
      r0.x,
      r0.y,
      r0.z,
      r1.x,
      r1.y,
      r1.z,
      l1.x,
      l1.y,
      l1.z,
      0,
      1,
      0
    );
    if (web <= 0) {
      continue;
    }
    // web on each side (outward normal via the tangent perpendicular)
    const nx = -tan[i].y;
    const nz = tan[i].x;
    quadXYZ(
      acc,
      l0.x,
      l0.y,
      l0.z,
      l1.x,
      l1.y,
      l1.z,
      l1.x,
      l1.y - web,
      l1.z,
      l0.x,
      l0.y - web,
      l0.z,
      nx,
      0,
      nz
    );
    quadXYZ(
      acc,
      r0.x,
      r0.y,
      r0.z,
      r1.x,
      r1.y,
      r1.z,
      r1.x,
      r1.y - web,
      r1.z,
      r0.x,
      r0.y - web,
      r0.z,
      -nx,
      0,
      -nz
    );
  }
}

/** The cross product a × b. */
export function cross(a: P3, b: P3): P3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** `v` scaled to unit length (a zero vector stays zero). */
export function unit(v: P3): P3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The unit normal of the plane through a, b, c, turned up when `up`. */
export function surfaceNormal(a: P3, b: P3, c: P3, up: boolean): P3 {
  const n = cross(
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  );
  const u = unit(n);
  return up && u[1] < 0 ? [-u[0], -u[1], -u[2]] : u;
}
