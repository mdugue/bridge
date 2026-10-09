/**
 * The facade the street photos' traits model (pipeline/bake/windows.py:
 * per LoD2 wall the measured axis spacing, grid, window size, frames,
 * sill bands, lisenes, ornament) as geometry the building bake puts into
 * the tile's mesh (scripts/bake-city-mesh.ts `appendWindows`), soft and
 * abstract like the shopfronts' *Weiche Nische*: each window is a shallow
 * niche cut into the LoD2 wall — the wall turning into it over a rounded
 * lip, a short reveal, a rounded cove into its back, the back a shade
 * darker as if in its own shadow. No glass, no mullions, no frame boards.
 * A Fasche, where one was measured, is a soft raised surround whose inner
 * edge rolls into the reveal; a sill band, lisenes and an ornament field
 * are soft bands standing out of the wall.
 *
 * The axes are centred on the wall at the measured spacing — their place
 * is not measured (two drives' poses differ by ~0.6 m), their rhythm is;
 * a loose grid shifts them a little, by a hash. Only the upper storeys:
 * the ground floor (doors, shopfronts, the plinth) is left as it is.
 *
 * The cut: the host's triangles that lie in the wall's plane (one LoD2
 * face: coplanar, edge-connected) are re-triangulated with the niches'
 * openings as holes, from the face's own outline vertices and the holes'
 * corners only — no vertex lands on an edge a neighbouring face shares
 * (a T-junction cracks open once the glTF quantises it). A window that
 * does not lie inside one face with `FACE_MARGIN_M` to spare is dropped;
 * a face whose re-triangulation does not keep its area keeps its old
 * triangles and gets no window; everything that lies along the wall is
 * at least two position quanta off it (`QUANTUM_M`) or in it.
 * Pure, no DOM.
 */
import type { Triangulate } from "./structures";
import type { V3 } from "./doors";
import {
  dir3,
  type EdgePoint,
  type Frame,
  polygon,
  QUANTUM_M,
  ROUND_STEPS,
  type Rect,
  type Shaded,
  softBand,
  softEdge,
} from "./shopfronts";

/** What windows.py models on a wall (metres). */
export interface FacadeModel {
  /** the axes' spacing along the wall */
  axis: number;
  /** a band of horizontal joints recurring at the storey under the
   *  windows */
  sill?: boolean;
  /** a soft raised surround round each window */
  frame?: boolean;
  /** a regular grid, or a loose one (the axes a little off) */
  grid: "loose" | "regular";
  /** the window's height */
  h: number;
  /** flat lisenes between the axes */
  lisene?: boolean;
  /** an ornament field over each window */
  orn?: boolean;
  /** the storey's height, where it was measured */
  storey?: number;
  /** the window's width */
  w: number;
}

/** A measured wall (`windows_<tile>.json`): its frame as in
 *  shopfronts_<tile>.json, the traits, and the model where one is drawn. */
export interface WindowWall {
  a: [number, number];
  b: [number, number];
  eave: number;
  imgs: number;
  L: number;
  model?: FacadeModel;
  n: [number, number];
  oid: string;
  seqs: number;
  traits: Record<string, number>;
  wi: number;
  z?: [number, number];
}

/** A tile's facade traits, per Building gml:id. */
export interface WindowFile {
  attribution: string;
  buildings: Record<string, WindowWall[]>;
  /** per feature [Spearman ρ between two sequences, walls] on this tile */
  reliability: Record<string, [number | null, number]>;
}

/** A niche (m): the lip's round from the wall into the reveal, the
 *  niche's depth behind the wall, the cove's round into its back. */
export const NICHE = { cove: 0.04, depth: 0.14, lip: 0.06 } as const;
/** A Fasche (m): its width round the window, how far it stands out of
 *  the wall, its rounds (outer shoulder, inner edge), how far its foot
 *  reaches back into the wall. */
export const FASCHE = {
  back: 0.03,
  inner: 0.035,
  proud: 0.075,
  round: 0.04,
  width: 0.15,
} as const;
/** A sill band (m): under each storey's windows, its height, how far it
 *  stands out and its round, and the wall it leaves under its windows */
export const SILL_BAND = {
  gap: 0.06,
  height: 0.12,
  proud: 0.1,
  round: 0.045,
} as const;
/** A lisene (m): its width between two axes (at most), how far it stands
 *  out, its round, and the wall it keeps clear of the windows */
export const LISENE = {
  clear: 0.12,
  proud: 0.085,
  round: 0.04,
  width: 0.45,
} as const;
/** An ornament field over a window (m): its height, the wall under it,
 *  how far it stands out, its round. */
export const ORNAMENT = {
  gap: 0.14,
  height: 0.32,
  proud: 0.07,
  round: 0.035,
} as const;
/** The rows (m): a window's sill above its storey line, the wall kept
 *  under the next storey line (the lintel), under the eave, and at the
 *  wall's ends; two windows keep at least `gap` of wall between them. */
export const ROWS = {
  eaveClear: 0.75,
  edge: 0.6,
  gap: 0.35,
  lintel: 0.35,
  sill: 0.9,
} as const;
/** A loose grid shifts each axis by up to this share of the spacing. */
export const LOOSE_JITTER = 0.08;
/** A window smaller than this either way is none. */
export const MIN_WINDOW_M = 0.6;
/** A window keeps this far inside its LoD2 face's outline (its cut,
 *  frame and bands included). */
export const FACE_MARGIN_M = 0.12;
/** How far from the footprint line the wall is looked for, either way. */
const WALL_REACH_M = 0.6;
/** A wall face: this square on the wall's normal, this upright. */
const FACE_COS = 0.999;
const FACE_UPRIGHT = 0.01;
/** Two triangles of one face lie this close to one plane. */
const PLANE_TOL_M = 0.003;

if (2 * QUANTUM_M > Math.min(NICHE.depth, FASCHE.proud, LISENE.proud)) {
  throw new Error("windows.ts: a part lies within two quanta of its wall");
}

/** A window on the wall: along it (m from `a`) and up (absolute). */
export type Window = Rect;

/** 0…1 from a string and a number: a loose axis' fixed offset. */
function hash01(key: string, k: number): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The axes' centres along a wall of `length`: at the spacing, centred,
 *  `edge` of wall at either end beside the outer windows; on a loose
 *  grid each a little off, by a hash. */
export function axes(
  length: number,
  m: Pick<FacadeModel, "axis" | "grid" | "w">,
  key: string
): number[] {
  const room = length - 2 * ROWS.edge - m.w;
  if (room < 0 || m.axis <= m.w + ROWS.gap - 1e-9) {
    return [];
  }
  const n = Math.floor(room / m.axis + 1e-9) + 1;
  const out = Array.from(
    { length: n },
    (_, k) => length / 2 + (k - (n - 1) / 2) * m.axis
  );
  if (m.grid === "loose") {
    const free = Math.min(LOOSE_JITTER * m.axis, (m.axis - m.w - ROWS.gap) / 2);
    for (let k = 0; k < n; k++) {
      out[k] += (2 * hash01(key, k) - 1) * free;
    }
  }
  return out;
}

/** The storeys' window rows: sill and head (absolute) per upper storey,
 *  the first `firstLine` up (the ground floor's top), one `storey` apart,
 *  each window `h` tall at most (under its lintel), none past `top`. */
export function rows(
  firstLine: number,
  storey: number,
  h: number,
  top: number
): [number, number][] {
  const height = Math.min(h, storey - ROWS.sill - ROWS.lintel);
  if (height < MIN_WINDOW_M) {
    return [];
  }
  const out: [number, number][] = [];
  for (let line = firstLine; ; line += storey) {
    const z0 = line + ROWS.sill;
    if (z0 + height > top + 1e-9) {
      return out;
    }
    out.push([z0, z0 + height]);
  }
}

/** The host's facts the layout reads (scripts/bake-city-mesh.ts' row). */
export interface WindowHost {
  baseZ: number;
  eaveH: number;
  storeyH: number;
}

/**
 * The windows of a wall's model: per upper storey a row on the axes
 * (`axes`, `rows`), from the first storey line over the host's base (its
 * Gurtgesims, plinths.ts) — or `above`, the top of a shopfront on the
 * wall — up to `ROWS.eaveClear` under the eave (the Traufgesims) and the
 * wall's own eave.
 */
export function windowLayout(
  w: Pick<WindowWall, "L" | "eave" | "oid" | "wi" | "z">,
  m: FacadeModel,
  host: WindowHost,
  above = Number.NEGATIVE_INFINITY
): Window[] {
  if (m.w < MIN_WINDOW_M) {
    return [];
  }
  const ground = Math.min(...(w.z ?? [host.baseZ]));
  const storey = m.storey ?? Math.max(host.storeyH, 2.4);
  let first = host.baseZ + Math.max(host.storeyH, 2.4);
  while (first + ROWS.sill < above) {
    first += storey;
  }
  const top =
    Math.min(host.baseZ + host.eaveH, ground + w.eave) - ROWS.eaveClear;
  const xs = axes(w.L, m, `${w.oid}/${w.wi}`);
  return rows(first, storey, m.h, top).flatMap(([z0, z1]) =>
    xs.map((s) => ({ s0: s - m.w / 2, s1: s + m.w / 2, z0, z1 }))
  );
}

/** How far a window's parts reach round it on the wall (m): its cut, its
 *  frame, its ornament field above. */
export function reach(m: FacadeModel): {
  bottom: number;
  side: number;
  top: number;
} {
  const side = m.frame ? FASCHE.width : NICHE.lip;
  return {
    side,
    bottom: side,
    top: m.orn ? side + ORNAMENT.gap + ORNAMENT.height : side,
  };
}

// --- the wall's face in the mesh --------------------------------------------

/** One LoD2 face on the wall: its triangles (first vertex index), its own
 *  frame (`at(s, out, z)`: s along the wall from the footprint's `a`, out
 *  of the face's plane, absolute height — LoD2's face is not exactly on
 *  or along the footprint line), its outline loops in (s, z) with each
 *  point's vertex index, and its area. */
export interface WallFace {
  area: number;
  frame: Frame;
  loops: { pts: [number, number][]; vertex: number[] }[];
  triangles: number[];
}

const vkey = (p: ArrayLike<number>, i: number) =>
  `${p[3 * i]},${p[3 * i + 1]},${p[3 * i + 2]}`;

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Twice the signed area of a loop in (s, z), halved. */
function loopArea(pts: readonly [number, number][]): number {
  let a = 0;
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  });
  return a / 2;
}

/** A triangle's normal (unit, mesh frame) and twice its area. */
function faceNormal(
  positions: ArrayLike<number>,
  t: number
): { n: V3; area2: number } {
  const p = (i: number, c: number) => positions[3 * (t + i) + c];
  const e1 = [p(1, 0) - p(0, 0), p(1, 1) - p(0, 1), p(1, 2) - p(0, 2)];
  const e2 = [p(2, 0) - p(0, 0), p(2, 1) - p(0, 1), p(2, 2) - p(0, 2)];
  const n: V3 = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const len = Math.hypot(...n);
  return {
    n: len > 0 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 0],
    area2: len,
  };
}

/** A face's frame: its plane through its vertices, s along the wall from
 *  the footprint's `a`. */
function faceFrame(
  w: Pick<WindowWall, "a" | "b" | "L">,
  offset: { cx: number; cy: number },
  normal: V3,
  positions: ArrayLike<number>,
  tris: readonly number[]
): Frame {
  const h = Math.hypot(normal[0], normal[1]);
  const n: V3 = [normal[0] / h, normal[1] / h, 0];
  const tw = [(w.b[0] - w.a[0]) / w.L, (w.b[1] - w.a[1]) / w.L];
  // along the face, the wall's way
  const along = tw[0] * -n[1] + tw[1] * n[0] >= 0 ? 1 : -1;
  const t: V3 = [-n[1] * along, n[0] * along, 0];
  const [ax, ay] = [w.a[0] - offset.cx, w.a[1] - offset.cy];
  let o = 0;
  let count = 0;
  for (const tri of tris) {
    for (let k = 0; k < 3; k++) {
      const i = 3 * (tri + k);
      o += (positions[i] - ax) * n[0] + (positions[i + 1] - ay) * n[1];
      count++;
    }
  }
  o /= Math.max(count, 1);
  const ox = ax + n[0] * o;
  const oy = ay + n[1] * o;
  return {
    n,
    t,
    at: (s, out, z) => [
      ox + t[0] * s + n[0] * out,
      oy + t[1] * s + n[1] * out,
      z,
    ],
  };
}

/**
 * The host's faces on a wall: its triangles facing out along the wall's
 * normal (within FACE_COS, upright), within WALL_REACH_M of the footprint
 * line and along it, grouped into faces (edge-connected, one plane within
 * PLANE_TOL_M), each in its own frame with its outline (the edges only one
 * of its triangles has, chained). A face whose outline does not chain is
 * left out.
 */
export function wallFaces(
  w: Pick<WindowWall, "a" | "b" | "L" | "n">,
  offset: { cx: number; cy: number },
  positions: ArrayLike<number>,
  triangles: readonly number[]
): WallFace[] {
  const [ax, ay] = [w.a[0] - offset.cx, w.a[1] - offset.cy];
  const tw = [(w.b[0] - w.a[0]) / w.L, (w.b[1] - w.a[1]) / w.L];
  const cands: { t: number; o: number; n: V3; area2: number }[] = [];
  for (const t of triangles) {
    const { n, area2 } = faceNormal(positions, t);
    if (
      area2 < 1e-8 ||
      n[0] * w.n[0] + n[1] * w.n[1] < FACE_COS ||
      Math.abs(n[2]) > FACE_UPRIGHT
    ) {
      continue;
    }
    let o = 0;
    const s: number[] = [];
    for (let k = 0; k < 3; k++) {
      const dx = positions[3 * (t + k)] - ax;
      const dy = positions[3 * (t + k) + 1] - ay;
      o += (dx * w.n[0] + dy * w.n[1]) / 3;
      s.push(dx * tw[0] + dy * tw[1]);
    }
    if (
      Math.abs(o) > WALL_REACH_M ||
      Math.max(...s) < -0.5 ||
      Math.min(...s) > w.L + 0.5
    ) {
      continue;
    }
    cands.push({ t, o, n, area2 });
  }
  const parent = cands.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      r = parent[r];
    }
    return r;
  };
  const byEdge = new Map<string, number[]>();
  cands.forEach(({ t }, ci) => {
    for (let k = 0; k < 3; k++) {
      const key = edgeKey(
        vkey(positions, t + k),
        vkey(positions, t + ((k + 1) % 3))
      );
      byEdge.set(key, [...(byEdge.get(key) ?? []), ci]);
    }
  });
  for (const list of byEdge.values()) {
    for (const j of list.slice(1)) {
      if (Math.abs(cands[j].o - cands[list[0]].o) <= PLANE_TOL_M) {
        parent[find(j)] = find(list[0]);
      }
    }
  }
  const groups = new Map<number, number[]>();
  cands.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const out: WallFace[] = [];
  for (const members of groups.values()) {
    const tris = members.map((i) => cands[i].t);
    const normal: V3 = [0, 0, 0];
    for (const i of members) {
      for (let c = 0; c < 3; c++) {
        normal[c] += cands[i].n[c] * cands[i].area2;
      }
    }
    const frame = faceFrame(w, offset, normal, positions, tris);
    const face = faceOutline(tris, positions, frame);
    if (face) {
      out.push({ ...face, frame });
    }
  }
  return out;
}

/** A point's (s, out, z) in a frame. */
function inFrame(f: Frame, p: V3): V3 {
  const o = f.at(0, 0, 0);
  const dx = p[0] - o[0];
  const dy = p[1] - o[1];
  return [dx * f.t[0] + dy * f.t[1], dx * f.n[0] + dy * f.n[1], p[2]];
}

const vertexAt = (positions: ArrayLike<number>, i: number): V3 => [
  positions[3 * i],
  positions[3 * i + 1],
  positions[3 * i + 2],
];

/** A face's outline: its boundary edges (directed as their triangles
 *  wind them) chained into loops, in (s, z); undefined where they do not
 *  chain (a vertex two loops share). */
function faceOutline(
  tris: readonly number[],
  positions: ArrayLike<number>,
  f: Frame
): Omit<WallFace, "frame"> | undefined {
  const count = new Map<string, number>();
  const edges: { a: string; b: string; ia: number }[] = [];
  let area = 0;
  for (const t of tris) {
    area += faceNormal(positions, t).area2 / 2;
    for (let k = 0; k < 3; k++) {
      const ia = t + k;
      const a = vkey(positions, ia);
      const b = vkey(positions, t + ((k + 1) % 3));
      const key = edgeKey(a, b);
      count.set(key, (count.get(key) ?? 0) + 1);
      edges.push({ a, b, ia });
    }
  }
  const next = new Map<string, { b: string; ia: number }>();
  for (const e of edges) {
    if (count.get(edgeKey(e.a, e.b)) !== 1) {
      continue;
    }
    if (next.has(e.a)) {
      return undefined;
    }
    next.set(e.a, { b: e.b, ia: e.ia });
  }
  const loops: WallFace["loops"] = [];
  const seen = new Set<string>();
  for (const start of next.keys()) {
    if (seen.has(start)) {
      continue;
    }
    const pts: [number, number][] = [];
    const vertex: number[] = [];
    let at = start;
    let step = next.get(at);
    while (step && !seen.has(at)) {
      seen.add(at);
      const [s, , z] = inFrame(f, vertexAt(positions, step.ia));
      pts.push([s, z]);
      vertex.push(step.ia);
      at = step.b;
      step = next.get(at);
    }
    if (at !== start || pts.length < 3) {
      return undefined;
    }
    loops.push({ pts, vertex });
  }
  return loops.length > 0 ? { area, loops, triangles: [...tris] } : undefined;
}

/** Whether (x, y) lies inside a loop (even-odd). */
function inside(pts: readonly [number, number][], x: number, y: number) {
  let isIn = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      isIn = !isIn;
    }
  }
  return isIn;
}

/** Whether the segment p→q meets the rectangle (Liang–Barsky). */
function segmentMeets(
  [px, py]: readonly [number, number],
  [qx, qy]: readonly [number, number],
  r: Rect
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dy = qy - py;
  for (const [p, q] of [
    [-dx, px - r.s0],
    [dx, r.s1 - px],
    [-dy, py - r.z0],
    [dy, r.z1 - py],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) {
        return false;
      }
      continue;
    }
    const t = q / p;
    if (p < 0) {
      t0 = Math.max(t0, t);
    } else {
      t1 = Math.min(t1, t);
    }
    if (t0 > t1) {
      return false;
    }
  }
  return true;
}

/** Whether a rectangle lies inside a face with `margin` to spare: its
 *  centre inside the face (even-odd over its loops: in the outer, out of
 *  its holes) and no outline edge within margin of it. */
export function fitsFace(face: WallFace, r: Rect, margin: number): boolean {
  const grown: Rect = {
    s0: r.s0 - margin,
    s1: r.s1 + margin,
    z0: r.z0 - margin,
    z1: r.z1 + margin,
  };
  const hits = face.loops.filter((l) =>
    inside(l.pts, (r.s0 + r.s1) / 2, (r.z0 + r.z1) / 2)
  ).length;
  if (hits % 2 === 0) {
    return false;
  }
  return face.loops.every(({ pts }) =>
    pts.every((p, i) => !segmentMeets(p, pts[(i + 1) % pts.length], grown))
  );
}

/** A face's extent along the wall (its outline's s). */
export function faceSpan(face: WallFace): [number, number] {
  const s = face.loops.flatMap((l) => l.pts.map((p) => p[0]));
  return [Math.min(...s), Math.max(...s)];
}

const ringOf = (r: Rect): [number, number][] => [
  [r.s0, r.z0],
  [r.s1, r.z0],
  [r.s1, r.z1],
  [r.s0, r.z1],
];

/**
 * A face re-triangulated with `holes` cut out of it (in its frame's
 * (s, z)), as mesh positions wound to face out of the wall (as the face's
 * own triangles were); undefined where the result does not keep the face's
 * area less the holes' (a loop earcut could not resolve) or the face has
 * two outer loops. The outline's points keep their own vertices bit for
 * bit; the holes' corners lie in the face's plane. `triangulate` is the
 * build's earcut (structures.ts' `Triangulate`).
 */
export function cutFace(
  face: WallFace,
  holes: readonly Rect[],
  positions: ArrayLike<number>,
  triangulate: Triangulate
): number[] | undefined {
  const loops = face.loops.toSorted(
    (p, q) => Math.abs(loopArea(q.pts)) - Math.abs(loopArea(p.pts))
  );
  const [outer, ...own] = loops;
  if (own.some((l) => !inside(outer.pts, l.pts[0][0], l.pts[0][1]))) {
    return undefined;
  }
  const cut = holes.map(ringOf);
  const rings = [outer.pts, ...own.map((l) => l.pts), ...cut];
  const starts: number[] = [];
  let at = 0;
  for (const ring of rings) {
    if (at > 0) {
      starts.push(at);
    }
    at += ring.length;
  }
  const flat = triangulate(rings.flat(2), starts);
  const tris: [number, number, number][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    tris.push([flat[i], flat[i + 1], flat[i + 2]]);
  }
  // the triangulation indexes contour ++ holes
  const points: V3[] = [
    ...[outer, ...own].flatMap((l) =>
      l.vertex.map((v) => vertexAt(positions, v))
    ),
    ...cut.flatMap((ring) => ring.map(([s, z]) => face.frame.at(s, 0, z))),
  ];
  const facing = face.frame.n;
  const out: number[] = [];
  let area = 0;
  for (const [i, j, k] of tris) {
    const [a, b, c] = [points[i], points[j], points[k]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    area += Math.hypot(nx, ny, nz) / 2;
    const ok = nx * facing[0] + ny * facing[1] + nz * facing[2] >= 0;
    out.push(...a, ...(ok ? [...b, ...c] : [...c, ...b]));
  }
  const holeArea = holes.reduce(
    (acc, r) => acc + (r.s1 - r.s0) * (r.z1 - r.z0),
    0
  );
  const want = face.area - holeArea;
  return Math.abs(area - want) <= 2e-3 * face.area + 1e-3 ? out : undefined;
}

// --- the niches and bands ---------------------------------------------------

/** A quarter round of radius r from angle a0 to a1 (radians) about
 *  (ce, co) in a section (e, o), its normal outward from the centre
 *  (`sign` −1: towards it). */
function quarter(
  ce: number,
  co: number,
  r: number,
  a0: number,
  a1: number,
  sign: 1 | -1
): EdgePoint[] {
  const out: EdgePoint[] = [];
  for (let k = 0; k <= ROUND_STEPS; k++) {
    const a = a0 + ((a1 - a0) * k) / ROUND_STEPS;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push({ e: ce + r * c, o: co + r * s, nu: sign * c, no: sign * s });
  }
  return out;
}

/** The niche's section from the wall's plane (`e0` out of the window's
 *  edge) into its back: the lip's quarter round (none where `e0` is 0:
 *  a frame's inner edge turns in instead), the reveal, the cove. */
function nicheSection(lipped: boolean): EdgePoint[] {
  const { cove, depth, lip } = NICHE;
  const coveO = -(depth - cove);
  return [
    // the wall (normal out) rolling over the lip into the reveal (normal
    // towards the window's middle), convex: about (lip, −lip)
    ...(lipped
      ? quarter(lip, -lip, lip, Math.PI / 2, Math.PI, 1)
      : [{ e: 0, o: 0, nu: -1, no: 0 }]),
    { e: 0, o: coveO, nu: -1, no: 0 },
    // the reveal turning into the back, concave: about (−cove, coveO)
    ...quarter(-cove, coveO, cove, 0, -Math.PI / 2, -1),
  ];
}

/** A Fasche's section from its foot in the wall (`FASCHE.width` out of the
 *  window's edge) over its shoulder and front to its inner edge rolling
 *  down to the wall's plane at the window's edge. */
function frameSection(): EdgePoint[] {
  const { back, inner, proud, round, width } = FASCHE;
  return [
    { e: width, o: -back, nu: 1, no: 0 },
    ...quarter(width - round, proud - round, round, 0, Math.PI / 2, 1),
    ...quarter(inner, proud - inner, inner, Math.PI / 2, Math.PI, 1),
    { e: 0, o: 0, nu: -1, no: 0 },
  ];
}

export interface WindowMesh {
  /** the niches' backs: a shade darker */
  backs: Shaded;
  /** the Faschen, the sill bands, the lisenes, the ornament fields */
  bands: Shaded;
  /** the lips, reveals and coves: the wall's own clay */
  reveals: Shaded;
}

/** The section's points with their `e` from the rectangle's edge. */
const sweep = (out: Shaded, f: Frame, r: Rect, section: readonly EdgePoint[]) =>
  softEdge(out, f, r, section, { s: [], z: [] });

/** A window's niche (and its Fasche) on the face's frame `f`. */
export function nicheMesh(out: WindowMesh, f: Frame, r: Rect, m: FacadeModel) {
  if (m.frame) {
    sweep(out.bands, f, r, frameSection());
    sweep(out.reveals, f, r, nicheSection(false));
  } else {
    sweep(out.reveals, f, r, nicheSection(true));
  }
  const { cove, depth } = NICHE;
  const n = dir3(f, 0, 1, 0);
  polygon(
    out.backs,
    [
      f.at(r.s0 + cove, -depth, r.z0 + cove),
      f.at(r.s1 - cove, -depth, r.z0 + cove),
      f.at(r.s1 - cove, -depth, r.z1 - cove),
      f.at(r.s0 + cove, -depth, r.z1 - cove),
    ],
    [n, n, n, n],
    n
  );
}

/** The opening a window cuts into its wall: the window, with its lip
 *  where it has no Fasche. */
export function cutOf(r: Rect, m: FacadeModel): Rect {
  const e = m.frame ? 0 : NICHE.lip;
  return { s0: r.s0 - e, s1: r.s1 + e, z0: r.z0 - e, z1: r.z1 + e };
}

/** The bands a face's windows carry: a sill band under each row (across
 *  its windows, a window's spacing beyond the outer ones at most, inside
 *  the face), lisenes between neighbouring axes, an ornament field over
 *  each window, all inside the face */
export function bandMeshes(
  out: WindowMesh,
  f: Frame,
  wins: readonly Rect[],
  m: FacadeModel,
  span: [number, number]
): void {
  const flat = { inner: 0, open: false };
  const side = reach(m).side;
  if (m.sill) {
    const byRow = new Map<number, Rect[]>();
    for (const r of wins) {
      byRow.set(r.z0, [...(byRow.get(r.z0) ?? []), r]);
    }
    for (const [z0, row] of byRow) {
      const top = z0 - side - SILL_BAND.gap;
      const s0 = Math.max(
        span[0],
        Math.min(...row.map((r) => r.s0)) - side - 0.3
      );
      const s1 = Math.min(
        span[1],
        Math.max(...row.map((r) => r.s1)) + side + 0.3
      );
      softBand(
        out.bands,
        f,
        { s0, s1, z0: top - SILL_BAND.height, z1: top },
        [],
        { ...flat, proud: SILL_BAND.proud, round: SILL_BAND.round }
      );
    }
  }
  if (m.lisene) {
    const cols = [...new Set(wins.map((r) => (r.s0 + r.s1) / 2))].toSorted(
      (p, q) => p - q
    );
    const z0 = Math.min(...wins.map((r) => r.z0)) - side;
    const z1 = Math.max(...wins.map((r) => r.z1)) + reach(m).top;
    for (let k = 0; k + 1 < cols.length; k++) {
      const left = Math.max(
        ...wins.filter((r) => (r.s0 + r.s1) / 2 === cols[k]).map((r) => r.s1)
      );
      const right = Math.min(
        ...wins
          .filter((r) => (r.s0 + r.s1) / 2 === cols[k + 1])
          .map((r) => r.s0)
      );
      const room = right - left - 2 * (side + LISENE.clear);
      const width = Math.min(LISENE.width, room);
      if (width < 0.2) {
        continue;
      }
      const mid = (left + right) / 2;
      softBand(
        out.bands,
        f,
        { s0: mid - width / 2, s1: mid + width / 2, z0, z1 },
        [],
        { ...flat, proud: LISENE.proud, round: LISENE.round }
      );
    }
  }
  if (m.orn) {
    for (const r of wins) {
      const z0 = r.z1 + side + ORNAMENT.gap;
      softBand(
        out.bands,
        f,
        { s0: r.s0, s1: r.s1, z0, z1: z0 + ORNAMENT.height },
        [],
        { ...flat, proud: ORNAMENT.proud, round: ORNAMENT.round }
      );
    }
  }
}

/** The whole rectangle a window's parts take on the wall (`reach`), and
 *  the band under it. */
export function footprintOf(r: Rect, m: FacadeModel): Rect {
  const g = reach(m);
  const under = m.sill ? SILL_BAND.gap + SILL_BAND.height : 0;
  return {
    s0: r.s0 - g.side,
    s1: r.s1 + g.side,
    z0: r.z0 - g.bottom - under,
    z1: r.z1 + g.top,
  };
}
