/**
 * The plinths on the LoD2 walls' street side (pipeline/bake/plinths.py:
 * level pieces of each wall's open stretches, on the DGM1) as geometry the
 * building bake appends to the tile's mesh (scripts/bake-city-mesh.ts): per
 * piece a stone band standing proud of the wall — its front face rolling
 * over a rounded shoulder into its top, and its ends — so the plinth throws
 * a soft shadow line, without cutting the LoD2 wall; and the Gurtgesims
 * over the ground floor along the same stretches, a slim rounded band in
 * the same register (`corniceMesh`), and the Traufgesims under a level
 * eave (`EAVE_CORNICE`). All are rounded where they meet the light,
 * mitred where two walls meet and run on from house to house along a row
 * (`joinStretches`).
 * Pure, no THREE.
 */
import type { PlinthFeature } from "./features";
import { type JoinPoint, joinsAlong, SINK } from "./ground-join";

/** How the band stands: how far it stands out of the wall, how far it
 *  reaches back into it (LoD2's walls stand a decimetre or so off the
 *  footprint line) and how tall the rounded shoulder is that turns its
 *  front into its top — soft, so the light rolls over it rather than
 *  breaking on an edge. */
export const PLINTH = { proud: 0.07, back: 0.15, round: 0.12 } as const;
/** The band's foot under the lowest ground read along it. */
export const PLINTH_SINK = SINK.box;

/** The Gurtgesims over the ground floor, modelled to match the plinth: a
 *  slim rounded nose `proud` out of the wall and `height` tall, its
 *  underside flat (a soft shadow under it) and its top washed back to the
 *  wall by `wash`; its underside at the first storey line. */
export const CORNICE = {
  proud: 0.06,
  back: 0.15,
  height: 0.14,
  wash: 0.03,
} as const;

/** Past this turn two runs meeting at a vertex end square, not mitred. */
const MITRE_MAX_DEG = 135;
/** Ends this close meet. */
const MEET_M = 0.02;

/** A cross-section in the wall's frame: out of the wall, up. */
type Profile = readonly (readonly [number, number])[];

/** Triangles with a normal per vertex: one smooth across a rounded
 *  profile's facets, NaN (flat) on the ends. */
export interface Shaded {
  normals: number[];
  positions: number[];
}

/** One straight run of a profile: its ends (EPSG), and at each end the
 *  mitre — how a point `o` out of the wall moves: `o·m` from the end — or
 *  none (a square end, capped). */
interface Run {
  a: readonly number[];
  b: readonly number[];
  ma?: readonly [number, number];
  mb?: readonly [number, number];
  /** the mitred end's corner where `o` is 0 (EPSG), the shifted walls'
   *  meeting point */
  ca?: readonly number[];
  cb?: readonly number[];
  /** how far the host's wall stands out of the footprint line at a, b */
  sa: number;
  sb: number;
}

/** How far the host's wall stands out of the footprint line at a and at
 *  b, read between two heights (metres along the run's outward normal;
 *  negative where it stands back) — LoD2's walls stand up to a couple of
 *  decimetres off it and often turned a little against it, and a band
 *  laid on the line would sink into the wall at one end and stand off it
 *  at the other. */
export type WallShift = (
  a: readonly number[],
  b: readonly number[],
  z0: number,
  z1: number
) => readonly [number, number];

const noShift: WallShift = () => [0, 0];

/**
 * A straight run of `profile` along the wall from a to b (the street to its
 * right), pushed onto `out` as triangles counter-clockwise from outside: a
 * face per profile edge except those in `hidden` (in the wall, in the
 * ground), shaded smooth over the vertices in `smooth`, and a cap on each
 * end not mitred. The profile runs up the front, over the top and down
 * the back, convex.
 */
function extrude(
  out: Shaded,
  run: Run,
  offset: { cx: number; cy: number },
  profile: Profile,
  hidden: readonly number[],
  smooth: readonly number[]
): void {
  const { a, b } = run;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-3) {
    return;
  }
  const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: [number, number] = [t[1], -t[0]];
  const at = (end: 0 | 1, [o, z]: readonly [number, number]): number[] => {
    const p = end === 0 ? a : b;
    const s = end === 0 ? run.sa : run.sb;
    const m = (end === 0 ? run.ma : run.mb) ?? n;
    const c = (end === 0 ? run.ca : run.cb) ?? [
      p[0] + n[0] * s,
      p[1] + n[1] * s,
    ];
    return [c[0] - offset.cx + m[0] * o, c[1] - offset.cy + m[1] * o, z];
  };
  // each profile edge's normal in the wall's frame (out, up)
  const edge = profile.map((p, k) => {
    const q = profile[(k + 1) % profile.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[1] - p[1]) / l, -(q[0] - p[0]) / l];
  });
  const normalAt = (k: number, v: number): number[] => {
    const e = edge[k];
    const other = edge[(v === k ? k - 1 + profile.length : v) % profile.length];
    const both = smooth.includes(v) ? [e[0] + other[0], e[1] + other[1]] : e;
    const l = Math.hypot(both[0], both[1]) || 1;
    return [(n[0] * both[0]) / l, (n[1] * both[0]) / l, both[1] / l];
  };
  const flat = [Number.NaN, Number.NaN, Number.NaN];
  const tri = (ps: number[][], ns: number[][]) => {
    for (const p of ps) {
      out.positions.push(...p);
    }
    for (const nn of ns) {
      out.normals.push(...nn);
    }
  };
  profile.forEach((p, k) => {
    if (hidden.includes(k)) {
      return;
    }
    const kq = (k + 1) % profile.length;
    const q = profile[kq];
    const np = normalAt(k, k);
    const nq = normalAt(k, kq);
    tri([at(0, p), at(1, p), at(1, q)], [np, np, nq]);
    tri([at(0, p), at(1, q), at(0, q)], [np, nq, nq]);
  });
  for (let k = 1; k + 1 < profile.length; k++) {
    if (!run.ma) {
      tri(
        [at(0, profile[0]), at(0, profile[k]), at(0, profile[k + 1])],
        [flat, flat, flat]
      );
    }
    if (!run.mb) {
      tri(
        [at(1, profile[0]), at(1, profile[k + 1]), at(1, profile[k])],
        [flat, flat, flat]
      );
    }
  }
}

/** A plinth piece: its ends (EPSG), foot and top. */
export interface PlinthPiece {
  a: readonly number[];
  b: readonly number[];
  foot: number;
  top: number;
  /** the host's wall out of the footprint line at a, b (`WallShift`) */
  sa: number;
  sb: number;
}

/**
 * The plinth's pieces as the mesh draws them: each feature line with its
 * foot (`PLINTH_SINK` under its ground) and top, and the pieces that meet
 * round a corner of the footprint (the bake ends them on its vertex) given
 * one foot and one top, the lowest and highest of them — so the mitre
 * closes and no band stands proud of its neighbour at the corner. Each
 * follows its own wall (`WallShift`).
 */
export function plinthPieces(
  f: PlinthFeature,
  shift: WallShift = noShift
): PlinthPiece[] {
  const p = f.properties;
  if (!p) {
    return [];
  }
  const pieces = f.geometry.coordinates
    .map((line, i) => ({
      a: line[0],
      b: line.at(-1) ?? line[0],
      foot: p.g[i] - PLINTH_SINK,
      top: p.top[i],
    }))
    .filter((q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) > 1e-3)
    .map((q) => {
      const [sa, sb] = shift(q.a, q.b, q.top - 0.6, q.top - 0.2);
      return { ...q, sa, sb };
    });
  const root = cornerGroups(pieces);
  const level = new Map<number, { foot: number; top: number }>();
  pieces.forEach((q, i) => {
    const r = root[i];
    const l = level.get(r);
    level.set(r, {
      foot: Math.min(l?.foot ?? q.foot, q.foot),
      top: Math.max(l?.top ?? q.top, q.top),
    });
  });
  return pieces.map((q, i) => ({ ...q, ...level.get(root[i]) }));
}

/** Per run, the root of the runs it is joined to round corners. */
function cornerGroups(
  runs: readonly { a: readonly number[]; b: readonly number[] }[]
): number[] {
  const group = runs.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (group[r] !== r) {
      r = group[r];
    }
    return r;
  };
  for (const [i, j] of corners(runs)) {
    group[root(i)] = root(j);
  }
  return runs.map((_, i) => root(i));
}

/** The pairs [i, j] where run i's end meets run j's start round a corner
 *  (turning, but by no more than `MITRE_MAX_DEG`). */
function corners(
  runs: readonly { a: readonly number[]; b: readonly number[] }[]
): [number, number][] {
  const out: [number, number][] = [];
  const dir = (r: { a: readonly number[]; b: readonly number[] }) => {
    const l = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    return [(r.b[0] - r.a[0]) / l, (r.b[1] - r.a[1]) / l];
  };
  const minCos = Math.cos((MITRE_MAX_DEG * Math.PI) / 180);
  runs.forEach((r, i) => {
    runs.forEach((s, j) => {
      if (i === j || Math.hypot(r.b[0] - s.a[0], r.b[1] - s.a[1]) > MEET_M) {
        return;
      }
      const [u, v] = [dir(r), dir(s)];
      const cos = u[0] * v[0] + u[1] * v[1];
      if (cos < 0.9998 && cos > minCos) {
        out.push([i, j]);
      }
    });
  });
  return out;
}

/** Below this sine of their turn two runs meeting at a corner share one
 *  shift there: nearly in line, their shifted walls would meet far off. */
const SHARED_SHIFT_SIN = 0.4;

/** The runs with their mitres: where run i meets run j round a corner at
 *  P, both end on the point where their shifted walls meet (n₁·X = s₁,
 *  n₂·X = s₂ from P) and run out of it along `m = A⁻¹(1, 1)` — the
 *  bisector, `(n₁ + n₂) / (1 + n₁·n₂)` — so a point `o` out of either
 *  wall lands on the same spot. */
function mitred(
  runs: readonly {
    a: readonly number[];
    b: readonly number[];
    sa: number;
    sb: number;
  }[],
  pairs: readonly (readonly [number, number])[] = corners(runs)
): Run[] {
  const out: Run[] = runs.map((r) => ({ ...r }));
  const normal = (r: { a: readonly number[]; b: readonly number[] }) => {
    const l = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    return [(r.b[1] - r.a[1]) / l, -(r.b[0] - r.a[0]) / l];
  };
  for (const [i, j] of pairs) {
    const [n1, n2] = [normal(runs[i]), normal(runs[j])];
    const det = n1[0] * n2[1] - n1[1] * n2[0];
    let [s1, s2] = [out[i].sb, out[j].sa];
    if (Math.abs(det) < SHARED_SHIFT_SIN) {
      s1 = s2 = (s1 + s2) / 2;
      out[i].sb = s1;
      out[j].sa = s2;
    }
    const solve = (u: number, v: number): [number, number] => [
      (u * n2[1] - v * n1[1]) / det,
      (n1[0] * v - n2[0] * u) / det,
    ];
    const m = solve(1, 1);
    const x = solve(s1, s2);
    const p = runs[i].b;
    const c = [p[0] + x[0], p[1] + x[1]];
    out[i].mb = m;
    out[i].cb = c;
    out[j].ma = m;
    out[j].ca = c;
  }
  return out;
}

/**
 * A plinth's triangles (mesh frame: x = epsgX − cx, y = epsgY − cy, z up),
 * counter-clockwise from outside, with their normals. Only the faces one
 * can see: the front rolling over its rounded shoulder into the top, and
 * the square ends — no back (in the wall), no bottom (in the ground); the
 * pieces meeting round a corner mitred into one another.
 */
export function plinthMesh(
  f: PlinthFeature,
  offset: { cx: number; cy: number },
  shift: WallShift = noShift
): Shaded {
  const joined = joinStretches(plinthStretches(f, 0), "plinth");
  return (
    bandMeshes(joined, offset, "plinth", (_, ...at) => shift(...at)).get(0) ??
    empty()
  );
}

/** The plinth's section: up the front, over a quarter-round shoulder
 *  into the top, back into the wall. */
function plinthProfile(foot: number, top: number): Profile {
  const { proud, back, round } = PLINTH;
  const shoulder = [0, 30, 60, 90].map((deg): [number, number] => {
    const r = (deg * Math.PI) / 180;
    return [proud * Math.cos(r), top - round + round * Math.sin(r)];
  });
  return [[-back, foot], [proud, foot], ...shoulder, [-back, top]];
}

/** The Gurtgesims's section: a flat underside, a half-round nose, a wash
 *  back to the wall. */
function corniceProfile(z: number): Profile {
  const { proud, back, height, wash } = CORNICE;
  const rx = proud * 0.7;
  const cx = proud - rx;
  const nose = [-90, -45, 0, 45, 90].map((deg): [number, number] => {
    const r = (deg * Math.PI) / 180;
    return [cx + rx * Math.cos(r), z + height / 2 + (height / 2) * Math.sin(r)];
  });
  return [[-back, z], ...nose, [-back, z + height + wash]];
}

/**
 * The Gurtgesims along the same open stretches as the plinth, at one
 * height `z` (its underside: the first storey line over the host's base),
 * level however the ground falls: the plinth's pieces joined end to end
 * into straight runs first, so a run has two ends, not one per piece, and
 * the runs meeting round a corner mitred into one another.
 */
export function corniceMesh(
  f: PlinthFeature,
  offset: { cx: number; cy: number },
  z: number,
  shift: WallShift = noShift
): Shaded {
  const joined = joinStretches(lineStretches(f, 0, z), "line");
  return (
    bandMeshes(joined, offset, "cornice", (_, ...at) => shift(...at)).get(0) ??
    empty()
  );
}

/** The Traufgesims under the eave, in the same register as the
 *  Gurtgesims but heavier: a quarter-round rolling out of the wall from
 *  its underside to `proud`, `rise` tall, and a short lip up to the eave
 *  `height` over its underside — soft, a band of light under the roof's
 *  edge and a soft shadow under it. */
export const EAVE_CORNICE = {
  proud: 0.16,
  back: 0.15,
  height: 0.32,
  rise: 0.24,
} as const;

/** A band's stretch along a wall (EPSG ends, the street to its right):
 *  the object it belongs to and its level — a plinth's foot and top, a
 *  cornice's underside (`lo` = `hi`). */
export interface Stretch {
  a: readonly number[];
  b: readonly number[];
  lo: number;
  hi: number;
  host: number;
}

/** A plinth feature's pieces as stretches of `host`. */
export function plinthStretches(f: PlinthFeature, host: number): Stretch[] {
  return plinthPieces(f).map((q) => ({
    a: q.a,
    b: q.b,
    lo: q.foot,
    hi: q.top,
    host,
  }));
}

/** A cornice along a plinth feature's stretches, its underside at `z`:
 *  the pieces joined end to end into straight runs, so a run has two
 *  ends, not one per piece. */
export function lineStretches(
  f: PlinthFeature,
  host: number,
  z: number
): Stretch[] {
  return straightRuns(f.geometry.coordinates).map(([a, b]) => ({
    a,
    b,
    lo: z,
    hi: z,
    host,
  }));
}

/** Two stretches' ends this far apart, in line, are one band across the
 *  gap: the next house's wall a few decimetres on (LoD2's footprints stop
 *  short of one another, and the bake leaves the party wall's end out). */
export const BRIDGE_M = 1.2;
/** …turning by no more than this, and standing no further aside. */
const BRIDGE_COS = Math.cos((20 * Math.PI) / 180);
const BRIDGE_ASIDE_M = 0.4;

/** How the levels of stretches that meet are made one: a plinth's take the
 *  lowest foot and highest top (a corner always, so its mitre closes), a
 *  cornice's the mean underside, weighted by length. */
export type Levelling = "plinth" | "line";

interface Link {
  i: number;
  j: number;
  d: number;
  corner: boolean;
}

/** Where stretch i's end meets stretch j's start: at a corner (within
 *  `MEET_M`, turning by no more than `MITRE_MAX_DEG`), in line, or across
 *  a gap of up to `BRIDGE_M`. An end and a start take one link each, the
 *  nearest. */
function links(st: readonly Stretch[]): Link[] {
  const cell = (x: number, y: number) =>
    `${Math.floor(x / BRIDGE_M)},${Math.floor(y / BRIDGE_M)}`;
  const starts = new Map<string, number[]>();
  st.forEach((s, j) => {
    const k = cell(s.a[0], s.a[1]);
    starts.set(k, [...(starts.get(k) ?? []), j]);
  });
  const dir = (s: Stretch) => {
    const l = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
    return [(s.b[0] - s.a[0]) / l, (s.b[1] - s.a[1]) / l];
  };
  const minCos = Math.cos((MITRE_MAX_DEG * Math.PI) / 180);
  const found: Link[] = [];
  st.forEach((s, i) => {
    const [cx, cy] = [
      Math.floor(s.b[0] / BRIDGE_M),
      Math.floor(s.b[1] / BRIDGE_M),
    ];
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const j of starts.get(`${gx},${gy}`) ?? []) {
          const link = linkOf(s, st[j], dir, minCos);
          if (j !== i && link) {
            found.push({ i, j, ...link });
          }
        }
      }
    }
  });
  found.sort((p, q) => p.d - q.d);
  const [ends, heads] = [new Set<number>(), new Set<number>()];
  return found.filter((l) => {
    if (ends.has(l.i) || heads.has(l.j)) {
      return false;
    }
    ends.add(l.i);
    heads.add(l.j);
    return true;
  });
}

function linkOf(
  s: Stretch,
  t: Stretch,
  dir: (s: Stretch) => number[],
  minCos: number
): { d: number; corner: boolean } | undefined {
  const g = [t.a[0] - s.b[0], t.a[1] - s.b[1]];
  const d = Math.hypot(g[0], g[1]);
  const [u, v] = [dir(s), dir(t)];
  const cos = u[0] * v[0] + u[1] * v[1];
  if (d <= MEET_M) {
    return cos > minCos ? { d, corner: cos < 0.9998 } : undefined;
  }
  const along = u[0] * g[0] + u[1] * g[1];
  const aside = Math.abs(u[0] * g[1] - u[1] * g[0]);
  return d <= BRIDGE_M &&
    cos >= BRIDGE_COS &&
    aside <= BRIDGE_ASIDE_M &&
    along > -BRIDGE_ASIDE_M
    ? { d, corner: false }
    : undefined;
}

/**
 * The stretches drawn as one band where they meet: each gap of up to
 * `BRIDGE_M` between one stretch's end and the next's start, in line,
 * closed (both run on to the gap's middle), and the levels of stretches
 * that meet made one (`Levelling`) as long as they lie within `tolerance`
 * of each other — the nearest first, so a long row on a falling street
 * steps where its houses do rather than drifting. Returns the stretches
 * and the corners to mitre (only between stretches of one level).
 */
export function joinStretches(
  stretches: readonly Stretch[],
  levelling: Levelling,
  tolerance = levelling === "plinth" ? 0.2 : 0.6
): { stretches: Stretch[]; corners: [number, number][] } {
  const st = stretches.map((s) => ({ ...s }));
  const ls = links(st);
  const parent = st.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      r = parent[r];
    }
    return r;
  };
  const span = st.map((s) => ({ min: s.hi, max: s.hi }));
  const byStep = [...ls].sort(
    (p, q) =>
      Math.abs(st[p.i].hi - st[p.j].hi) - Math.abs(st[q.i].hi - st[q.j].hi)
  );
  for (const l of byStep) {
    const [r1, r2] = [root(l.i), root(l.j)];
    const lo = Math.min(span[r1].min, span[r2].min);
    const hi = Math.max(span[r1].max, span[r2].max);
    const forced = l.corner && levelling === "plinth";
    if (r1 !== r2 && (forced || hi - lo <= tolerance)) {
      parent[r1] = r2;
      span[r2] = { min: lo, max: hi };
    }
  }
  const level = new Map<number, { lo: number; hi: number; w: number }>();
  st.forEach((s, i) => {
    const r = root(i);
    const w = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const l = level.get(r) ?? {
      lo: Number.POSITIVE_INFINITY,
      hi: levelling === "plinth" ? Number.NEGATIVE_INFINITY : 0,
      w: 0,
    };
    level.set(
      r,
      levelling === "plinth"
        ? { lo: Math.min(l.lo, s.lo), hi: Math.max(l.hi, s.hi), w: 0 }
        : { lo: 0, hi: l.hi + s.hi * w, w: l.w + w }
    );
  });
  st.forEach((s, i) => {
    const l = level.get(root(i));
    if (l) {
      const z = l.w > 0 ? l.hi / l.w : l.hi;
      s.lo = levelling === "plinth" ? l.lo : z;
      s.hi = z;
    }
  });
  for (const { i, j, d } of ls) {
    if (d > MEET_M) {
      const [s, t] = [st[i], st[j]];
      const mid = [(s.b[0] + t.a[0]) / 2, (s.b[1] + t.a[1]) / 2];
      s.b = onLine(s.a, s.b, mid);
      t.a = onLine(t.b, t.a, mid);
    }
  }
  const corners = ls
    .filter(
      (l) => l.corner && st[l.i].lo === st[l.j].lo && st[l.i].hi === st[l.j].hi
    )
    .map((l): [number, number] => [l.i, l.j]);
  return { stretches: st, corners };
}

/** The point on the line from `from` through `to` nearest `p`. */
function onLine(
  from: readonly number[],
  to: readonly number[],
  p: readonly number[]
): number[] {
  const l = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const u = [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
  const k = (p[0] - from[0]) * u[0] + (p[1] - from[1]) * u[1];
  return [from[0] + u[0] * k, from[1] + u[1] * k];
}

/** Which band a stretch draws. */
export type BandKind = "plinth" | "cornice" | "eave";

/** `WallShift` on a stretch's host. */
export type HostShift = (
  host: number,
  a: readonly number[],
  b: readonly number[],
  z0: number,
  z1: number
) => readonly [number, number];

/** Between which heights a band reads its wall. */
function wallBand(kind: BandKind, s: Stretch): [number, number] {
  if (kind === "plinth") {
    return [s.hi - 0.6, s.hi - 0.2];
  }
  if (kind === "cornice") {
    return [s.hi - 0.3, s.hi + CORNICE.height + 0.3];
  }
  return [s.hi - 0.6, s.hi];
}

/**
 * The bands' triangles per host (mesh frame, counter-clockwise from
 * outside, with their normals): each stretch laid on its host's wall
 * (`HostShift`) and mitred into the stretches it meets round a corner.
 */
export function bandMeshes(
  joined: { stretches: readonly Stretch[]; corners: [number, number][] },
  offset: { cx: number; cy: number },
  kind: BandKind,
  shift: HostShift
): Map<number, Shaded> {
  const st = joined.stretches;
  const runs = mitred(
    st.map((s) => {
      const [sa, sb] = shift(s.host, s.a, s.b, ...wallBand(kind, s));
      return { a: s.a, b: s.b, sa, sb };
    }),
    joined.corners
  );
  const out = new Map<number, Shaded>();
  st.forEach((s, i) => {
    if (kind === "plinth" && !(s.hi - PLINTH.round > s.lo)) {
      return;
    }
    const mesh = out.get(s.host) ?? empty();
    out.set(s.host, mesh);
    if (kind === "plinth") {
      // the edges: bottom, front, the shoulder's three facets, top, back
      extrude(
        mesh,
        runs[i],
        offset,
        plinthProfile(s.lo, s.hi),
        [0, 6],
        [2, 3, 4, 5]
      );
    } else if (kind === "cornice") {
      // the back (in the wall); smooth from the underside's front edge
      // over the nose into the wash
      const profile = corniceProfile(s.hi);
      extrude(
        mesh,
        runs[i],
        offset,
        profile,
        [profile.length - 1],
        [1, 2, 3, 4, 5]
      );
    } else {
      // the underside and the back in the wall; smooth over the quarter
      // round into the lip
      extrude(mesh, runs[i], offset, eaveProfile(s.hi), [0, 6], [1, 2, 3, 4]);
    }
  });
  return out;
}

/** The Traufgesims's section: out of the wall along its underside, round
 *  a quarter-round up to the lip, back over the top into the wall. */
function eaveProfile(z: number): Profile {
  const { proud, back, height, rise } = EAVE_CORNICE;
  const round = [0, 30, 60, 90].map((deg): [number, number] => {
    const r = (deg * Math.PI) / 180;
    return [proud * Math.sin(r), z + rise * (1 - Math.cos(r))];
  });
  return [
    [-back, z],
    ...round,
    [proud - 0.02, z + height],
    [-back, z + height],
  ];
}

const empty = (): Shaded => ({ positions: [], normals: [] });

/** The lines joined where one ends where the next starts, in line. */
export function straightRuns(
  lines: readonly (readonly (readonly number[])[])[]
): [readonly number[], readonly number[]][] {
  const out: [readonly number[], readonly number[]][] = [];
  for (const line of lines) {
    const a = line[0];
    const b = line.at(-1) ?? a;
    const last = out.at(-1);
    if (last && Math.hypot(last[1][0] - a[0], last[1][1] - a[1]) < 0.01) {
      const u = [last[1][0] - last[0][0], last[1][1] - last[0][1]];
      const v = [b[0] - a[0], b[1] - a[1]];
      const cos =
        (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
      if (cos > 0.9999) {
        last[1] = b;
        continue;
      }
    }
    out.push([a, b]);
  }
  return out;
}

/** Where a plinth meets the ground (ADR 0035): its foot along the band's
 *  front face, EPSG — `PLINTH_SINK` under the lowest ground read along
 *  its piece. Where the ground in front is higher the band only sinks
 *  deeper; where it falls away from the wall (a step down, a light well)
 *  the foot is checked here. */
export function plinthJoins(f: PlinthFeature): JoinPoint[] {
  return plinthPieces(f).flatMap(({ a, b, foot: z }) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) {
      return [];
    }
    const nx = (b[1] - a[1]) / len;
    const ny = -(b[0] - a[0]) / len;
    const end = (q: readonly number[]) => ({
      x: q[0] + nx * PLINTH.proud,
      y: q[1] + ny * PLINTH.proud,
      z,
    });
    return joinsAlong("foot", end(a), end(b));
  });
}
