/**
 * The triangle-soup kit the runtime's line and bridge layers build their
 * meshes with (rail-layer.ts, tram-layer.ts, riverside-layer.ts,
 * catenary-layer.ts): an accumulator of positions and per-vertex normals
 * in the Y-up scene frame, the primitives that push into it — a triangle
 * or quad wound to face its normal (the one guarantee: every material is
 * FrontSide), a ribbon along a run of points, a footprint's slab, a box
 * column, a strut — and the finish into a mesh of the scene-wide material
 * of one colour (`meshFrom`, or `meshSteps` a run at a time). A module of
 * its own so that every layer can import it: inside rail-layer.ts the
 * catenary and the track bed, which rail-layer imports, could not.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Material,
  Mesh,
  MeshStandardNodeMaterial,
  ShapeUtils,
  Vector2,
} from "three/webgpu";
import { finished, type Steps } from "@/lib/city/build-steps";
import type { Ring2 } from "@/lib/city/decks";
import { sceneMaterial } from "./three-utils";

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

export type P3 = [number, number, number];

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

/** Numbers copied into floats per step (build-steps.ts): a yard's or a
 *  tile's tram tracks are millions. */
const FLOAT_RUN = 1 << 16;

function* floats(src: readonly number[]): Steps<Float32Array> {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += FLOAT_RUN) {
    const end = Math.min(src.length, i + FLOAT_RUN);
    for (let k = i; k < end; k++) {
      out[k] = src[k];
    }
    yield;
  }
  return out;
}

function* finishGeo(acc: Mesh3): Steps<BufferGeometry | null> {
  if (acc.pos.length === 0) {
    return null;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(yield* floats(acc.pos), 3));
  g.setAttribute("normal", new BufferAttribute(yield* floats(acc.nrm), 3));
  if (acc.deck?.length === (acc.pos.length / 3) * 4) {
    g.setAttribute("aDeck", new BufferAttribute(yield* floats(acc.deck), 4));
  }
  g.computeBoundingSphere();
  return g;
}

export interface MatOpts {
  offsetUnits?: number;
  roughness?: number;
}

/**
 * The scene-wide lit material of one colour and finish (the key holds every
 * setting, so two layers asking for the same look share one build). The
 * polygon offset pulls a surface lying on the ground (ballast, rails, a
 * track bed) in front of the terrain it covers.
 */
export function material(
  color: number,
  opts: MatOpts = {}
): MeshStandardNodeMaterial {
  const roughness = opts.roughness ?? 0.95;
  const offsetUnits = opts.offsetUnits ?? 0;
  const key = `rail:${color.toString(16)}:${roughness}:${offsetUnits}`;
  return sceneMaterial(key, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(color),
      roughness,
    });
    if (offsetUnits) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = offsetUnits;
    }
    return m;
  });
}

/**
 * Triangulates a footprint into a top face at per-vertex `topY` plus a continuous
 * outward-facing fascia dropping `depth` — one solid slab volume, not stacked
 * planes. Used for ballast areas, bridge decks, and platforms. `underside`
 * closes the slab from below too (a bridge deck, seen from under it).
 */
export function addFootprint(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  depth: number,
  underside = false
): void {
  const { pts } = ring;
  if (pts.length < 3) {
    return;
  }
  const contour = pts.map((p) => new Vector2(p.x, p.z));
  const tris = ShapeUtils.triangulateShape(contour, []);
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

export interface Pt {
  x: number;
  y: number;
  z: number;
}

export function tangentsXZ(pts: Pt[]): Vector2[] {
  const t: Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const v = new Vector2(b.x - a.x, b.z - a.z);
    if (v.lengthSq() === 0) {
      v.set(1, 0);
    }
    t.push(v.normalize());
  }
  return t;
}

/**
 * A ribbon of half-width `half` offset `lateral` from a run of points: a
 * top face and a vertical web of depth `web` down each side (a rail, a
 * groove, a track bed; no webs at 0). Shared with the tram layer.
 */
export function addRibbon(
  acc: Mesh3,
  pts: Pt[],
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

export interface MeshOpts {
  cast: boolean;
  /** a material of its own (the bridges' surfaces) instead of the plain one */
  material?: Material;
  offsetUnits?: number;
  roughness?: number;
}

export function meshFrom(
  acc: Mesh3,
  color: number,
  opts: MeshOpts
): Mesh | null {
  return finished(meshSteps(acc, color, opts));
}

/** `meshFrom` in steps: its floats copied a run at a time. */
export function* meshSteps(
  acc: Mesh3,
  color: number,
  opts: MeshOpts
): Steps<Mesh | null> {
  const geo = yield* finishGeo(acc);
  if (!geo) {
    return null;
  }
  const m = new Mesh(
    geo,
    opts.material ??
      material(color, {
        offsetUnits: opts.offsetUnits,
        roughness: opts.roughness,
      })
  );
  m.castShadow = opts.cast;
  m.receiveShadow = true;
  return m;
}

/** A square prism from `a` to `b` (half-section `half`), wound outward. */
export function addStrut(acc: Mesh3, a: P3, b: P3, half: number): void {
  const d: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  if (len < 1e-3) {
    return;
  }
  const dn: P3 = [d[0] / len, d[1] / len, d[2] / len];
  const up: P3 = Math.abs(dn[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const side = unit(cross(dn, up));
  const top = unit(cross(side, dn));
  const corner = (p: P3, i: number): P3 => {
    const ss = i === 0 || i === 3 ? half : -half;
    const tt = i < 2 ? half : -half;
    return [
      p[0] + side[0] * ss + top[0] * tt,
      p[1] + side[1] * ss + top[1] * tt,
      p[2] + side[2] * ss + top[2] * tt,
    ];
  };
  const normals: P3[] = [
    top,
    [-side[0], -side[1], -side[2]],
    [-top[0], -top[1], -top[2]],
    side,
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(
      acc,
      corner(a, i),
      corner(a, j),
      corner(b, j),
      corner(b, i),
      normals[i]
    );
  }
  quad(acc, corner(b, 0), corner(b, 1), corner(b, 2), corner(b, 3), dn);
  quad(acc, corner(a, 0), corner(a, 1), corner(a, 2), corner(a, 3), [
    -dn[0],
    -dn[1],
    -dn[2],
  ]);
}

export function cross(a: P3, b: P3): P3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function unit(v: P3): P3 {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
