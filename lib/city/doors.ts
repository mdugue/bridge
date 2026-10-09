/**
 * The doors on the LoD2 walls (pipeline/bake/doors.py: OSM's mapped
 * entrances snapped onto the nearest footprint edge) as geometry the
 * building bake appends to the tile's mesh (scripts/bake-city-mesh.ts):
 * per door a surround — two jambs and a lintel standing proud of the wall —
 * and the leaf set back between them, so the doorway reads as a recess in
 * the clay without cutting the LoD2 wall. No panels, no glass, no handle.
 * Pure, no THREE.
 */
import type { DoorFeature } from "./features";
import { type JoinPoint, joinsAlong, SINK } from "./ground-join";

/** How the surround stands: its jambs' and lintel's width, how far it
 *  stands out of the wall, and how far it reaches back into it (the LoD2
 *  wall is not where OSM's facade line is, to the centimetre). */
export const DOOR_SURROUND = { width: 0.14, proud: 0.06, back: 0.12 } as const;
/** How far the leaf stands out of the wall: behind the surround's face, so
 *  the doorway reads as a recess. */
export const DOOR_LEAF_PROUD = 0.02;
/** A door stands on one ground sample (the lowest in front of it). */
export const DOOR_SINK = SINK.box;

export interface DoorMesh {
  leaf: number[];
  surround: number[];
}

export type V3 = [number, number, number];

/** How far from the footprint line a door looks for its wall, either way:
 *  LoD2's walls stand up to a decimetre or two off it. */
export const DOOR_WALL_REACH = 0.6;

/**
 * How far the host's wall stands out of the footprint line at the door
 * (metres along the door's outward normal; negative where it stands back):
 * rays along the surround's face at knee and head height, against the
 * host's triangles, the outermost hit. 0 where no ray meets the wall within
 * `DOOR_WALL_REACH`. The door is laid on this, or a wall standing proud of
 * the line would swallow its leaf.
 */
export function wallShift(
  f: DoorFeature,
  offset: { cx: number; cy: number },
  /** mesh positions, flat */
  positions: ArrayLike<number>,
  /** the host's triangles: each one's first vertex index */
  triangles: readonly number[]
): number {
  const p = f.properties;
  if (!p) {
    return 0;
  }
  const { at, n } = doorFrame(f, offset);
  const reach = p.w / 2 + DOOR_SURROUND.width;
  let shift = Number.NEGATIVE_INFINITY;
  for (const a of [-reach, 0, reach]) {
    for (const c of [0.6, p.h * 0.8]) {
      const o = at(a, DOOR_WALL_REACH, c);
      for (const t of triangles) {
        const hit = rayHit(o, n, positions, t);
        if (hit !== undefined && hit <= 2 * DOOR_WALL_REACH) {
          shift = Math.max(shift, DOOR_WALL_REACH - hit);
        }
      }
    }
  }
  return Number.isFinite(shift) ? shift : 0;
}

/** Where along a stretch `wallShiftAlong` reads the wall. */
const ALONG = [0.1, 0.3, 0.5, 0.7, 0.9];
/** A wall read further than this off the footprint line is another one. */
const ALONG_MAX_M = 0.35;

/**
 * `wallShift` for a straight stretch of wall a→b (EPSG, the street to its
 * right) between heights z0 and z1, at each of its two ends: LoD2's wall
 * is often turned a little against the footprint edge, so it stands out
 * of the line at one end and back from it at the other. Rays at five
 * points along it at both heights (each point the outermost hit within
 * `ALONG_MAX_M`), a straight line fitted through them and read at a and
 * b; [0, 0] where no ray meets the wall. The plinth and Gurtgesims are
 * laid on it (`lib/city/plinths.ts`).
 */
export function wallShiftAlong(
  [a, b]: readonly [readonly number[], readonly number[]],
  [z0, z1]: readonly [number, number],
  offset: { cx: number; cy: number },
  positions: ArrayLike<number>,
  triangles: readonly number[]
): [number, number] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-3) {
    return [0, 0];
  }
  const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: V3 = [t[1], -t[0], 0];
  const read: [number, number][] = [];
  for (const f of ALONG) {
    let shift = Number.NEGATIVE_INFINITY;
    for (const z of [z0, z1]) {
      const o: V3 = [
        a[0] - offset.cx + t[0] * len * f + n[0] * DOOR_WALL_REACH,
        a[1] - offset.cy + t[1] * len * f + n[1] * DOOR_WALL_REACH,
        z,
      ];
      for (const tri of triangles) {
        const hit = rayHit(o, n, positions, tri);
        const s = hit === undefined ? Number.NaN : DOOR_WALL_REACH - hit;
        if (Math.abs(s) <= ALONG_MAX_M) {
          shift = Math.max(shift, s);
        }
      }
    }
    if (Number.isFinite(shift)) {
      read.push([f, shift]);
    }
  }
  return lineThrough(read);
}

/** How far apart `wallShiftKnots` reads the wall along a stretch. */
const KNOT_M = 1;
/** …and how far in from the stretch's ends its end knots read it. */
const KNOT_END_M = 0.1;

/** A wall's stand off the footprint line along a stretch: at fractions
 *  `f` (0 at a, 1 at b, rising) the shift `s` (`wallShift`). */
export interface WallKnots {
  f: number[];
  s: number[];
}

/**
 * `wallShiftAlong` read every `KNOT_M` along the stretch rather than
 * fitted by one line: LoD2's walls are not flat over a long stretch (they
 * bend a few centimetres at their faces' seams), and a band laid on one
 * line through them sank into the wall where it bulged. Each knot the
 * outermost hit at either height; a knot no ray meets takes its
 * neighbours' line; none at all, [0, 0].
 */
export function wallShiftKnots(
  [a, b]: readonly [readonly number[], readonly number[]],
  [z0, z1]: readonly [number, number],
  offset: { cx: number; cy: number },
  positions: ArrayLike<number>,
  triangles: readonly number[]
): WallKnots {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-3) {
    return { f: [0, 1], s: [0, 0] };
  }
  const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: V3 = [t[1], -t[0], 0];
  const near = trianglesNear(
    [
      [a[0] - offset.cx, a[1] - offset.cy],
      [b[0] - offset.cx, b[1] - offset.cy],
    ],
    [z0, z1],
    positions,
    triangles
  );
  const count = Math.max(1, Math.round(len / KNOT_M));
  const f = Array.from({ length: count + 1 }, (_, k) => k / count);
  const end = Math.min(KNOT_END_M / len, 0.25);
  const read = f.map((fk) => {
    const at = Math.min(Math.max(fk, end), 1 - end) * len;
    let shift = Number.NEGATIVE_INFINITY;
    for (const z of [z0, z1]) {
      const o: V3 = [
        a[0] - offset.cx + t[0] * at + n[0] * DOOR_WALL_REACH,
        a[1] - offset.cy + t[1] * at + n[1] * DOOR_WALL_REACH,
        z,
      ];
      for (const tri of near) {
        const hit = rayHit(o, n, positions, tri);
        const s = hit === undefined ? Number.NaN : DOOR_WALL_REACH - hit;
        if (Math.abs(s) <= ALONG_MAX_M) {
          shift = Math.max(shift, s);
        }
      }
    }
    return shift;
  });
  return { f, s: fillGaps(f, read) };
}

/** The triangles whose box reaches the box round a stretch (mesh frame)
 *  grown by `DOOR_WALL_REACH`, between two heights: the only ones its rays
 *  can meet. */
function trianglesNear(
  [a, b]: readonly [readonly number[], readonly number[]],
  [z0, z1]: readonly [number, number],
  positions: ArrayLike<number>,
  triangles: readonly number[]
): number[] {
  const r = DOOR_WALL_REACH;
  const [x0, x1] = [Math.min(a[0], b[0]) - r, Math.max(a[0], b[0]) + r];
  const [y0, y1] = [Math.min(a[1], b[1]) - r, Math.max(a[1], b[1]) + r];
  return triangles.filter((t) => {
    const at = (i: number, c: number) => positions[3 * (t + i) + c];
    const out = (c: number, lo: number, hi: number) =>
      Math.max(at(0, c), at(1, c), at(2, c)) < lo ||
      Math.min(at(0, c), at(1, c), at(2, c)) > hi;
    return !(out(0, x0, x1) || out(1, y0, y1) || out(2, z0, z1));
  });
}

/** Knots no ray met, read off the line through their nearest neighbours
 *  that were (held level past the last one); none met: 0. */
function fillGaps(f: readonly number[], read: readonly number[]): number[] {
  const known = read
    .map((s, k) => [k, s] as const)
    .filter(([, s]) => Number.isFinite(s));
  if (known.length === 0) {
    return read.map(() => 0);
  }
  return read.map((s, k) => {
    if (Number.isFinite(s)) {
      return s;
    }
    const before = known.filter(([i]) => i < k).at(-1);
    const after = known.find(([i]) => i > k);
    if (!(before && after)) {
      return (before ?? after ?? [k, 0])[1];
    }
    const w = (f[k] - f[before[0]]) / (f[after[0]] - f[before[0]]);
    return before[1] + (after[1] - before[1]) * w;
  });
}

/** How far inside the wall `eaveAlong` reads the roof. */
const EAVE_IN_M = 0.2;
/** An eave is level within this along its stretch. */
const EAVE_LEVEL_M = 0.3;

/**
 * Where the host's roof meets its wall along a straight stretch a→b (EPSG,
 * the street to its right; the wall `shift` out of the line at a and b,
 * `wallShiftAlong`): at five points along it the roof just inside the wall,
 * its plane carried out to the wall — the eave, where the roof runs level
 * along the stretch (four of the five within `EAVE_LEVEL_M` of the lowest:
 * a dormer or a turret may stand on it). Undefined along a gable, where the
 * roof climbs along the wall, or where no roof is read.
 */
export function eaveAlong(
  [a, b]: readonly [readonly number[], readonly number[]],
  [sa, sb]: readonly [number, number],
  offset: { cx: number; cy: number },
  positions: ArrayLike<number>,
  /** the host's roof triangles: each one's first vertex index */
  roofs: readonly number[]
): number | undefined {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-3) {
    return undefined;
  }
  const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n = [t[1], -t[0]];
  const read: number[] = [];
  for (const f of ALONG) {
    const s = sa + (sb - sa) * f;
    const wall = [
      a[0] - offset.cx + t[0] * len * f + n[0] * s,
      a[1] - offset.cy + t[1] * len * f + n[1] * s,
    ];
    const z = roofAt(
      [wall[0] - n[0] * EAVE_IN_M, wall[1] - n[1] * EAVE_IN_M],
      wall,
      positions,
      roofs
    );
    if (z !== undefined) {
      read.push(z);
    }
  }
  const low = Math.min(...read);
  const level = read.filter((z) => z - low <= EAVE_LEVEL_M);
  return level.length >= 4
    ? level.reduce((sum, z) => sum + z, 0) / level.length
    : undefined;
}

/** The topmost roof face over `p` (mesh frame), its plane read at `at`. */
function roofAt(
  p: readonly number[],
  at: readonly number[],
  positions: ArrayLike<number>,
  roofs: readonly number[]
): number | undefined {
  let best: { z: number; at: number } | undefined;
  for (const t of roofs) {
    const v = (i: number): V3 => [
      positions[3 * (t + i)],
      positions[3 * (t + i) + 1],
      positions[3 * (t + i) + 2],
    ];
    const [p0, p1, p2] = [v(0), v(1), v(2)];
    const face = cross(sub(p1, p0), sub(p2, p0));
    // facing up, not a wall
    if (face[2] <= 0.05 * Math.hypot(...face)) {
      continue;
    }
    const plane = (x: number, y: number) =>
      p0[2] - (face[0] * (x - p0[0]) + face[1] * (y - p0[1])) / face[2];
    const d = (q: V3, r: V3) =>
      (r[0] - q[0]) * (p[1] - q[1]) - (r[1] - q[1]) * (p[0] - q[0]);
    const [d0, d1, d2] = [d(p0, p1), d(p1, p2), d(p2, p0)];
    const inside =
      (d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0);
    const z = plane(p[0], p[1]);
    if (inside && (best === undefined || z > best.z)) {
      best = { z, at: plane(at[0], at[1]) };
    }
  }
  return best?.at;
}

/** The least-squares line through (f, s) read at f = 0 and 1; one point:
 *  level; none: [0, 0]. */
function lineThrough(read: readonly [number, number][]): [number, number] {
  if (read.length === 0) {
    return [0, 0];
  }
  const mf = read.reduce((sum, [f]) => sum + f, 0) / read.length;
  const ms = read.reduce((sum, [, s]) => sum + s, 0) / read.length;
  const sff = read.reduce((sum, [f]) => sum + (f - mf) ** 2, 0);
  const slope =
    sff < 1e-9
      ? 0
      : read.reduce((sum, [f, s]) => sum + (f - mf) * (s - ms), 0) / sff;
  return [ms - slope * mf, ms + slope * (1 - mf)];
}

/** Where a ray from `o` along −n meets the triangle facing it (its first
 *  vertex at `t`), as the distance along the ray; undefined if it misses. */
export function rayHit(
  o: V3,
  n: V3,
  positions: ArrayLike<number>,
  t: number
): number | undefined {
  const v = (i: number): V3 => [
    positions[3 * (t + i)],
    positions[3 * (t + i) + 1],
    positions[3 * (t + i) + 2],
  ];
  const [p0, p1, p2] = [v(0), v(1), v(2)];
  const e1 = sub(p1, p0);
  const e2 = sub(p2, p0);
  const d: V3 = [-n[0], -n[1], -n[2]];
  // a face that turns from the door (its back, a side wall) is no wall
  const face = cross(e1, e2);
  if (dot(face, n) <= 0.7 * Math.hypot(...face)) {
    return undefined;
  }
  const q = cross(d, e2);
  const det = dot(e1, q);
  if (Math.abs(det) < 1e-12) {
    return undefined;
  }
  const s = sub(o, p0);
  const u = dot(s, q) / det;
  const r = cross(s, e1);
  const w = dot(d, r) / det;
  if (u < 0 || w < 0 || u + w > 1) {
    return undefined;
  }
  const dist = dot(e2, r) / det;
  return dist >= 0 ? dist : undefined;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The door's frame in the mesh: along the wall, out of it, up from below
 *  its sill (right-handed). */
function doorFrame(
  f: DoorFeature,
  offset: { cx: number; cy: number },
  shift = 0
): { at: (a: number, b: number, c: number) => V3; n: V3 } {
  const p = f.properties ?? { nx: 0, ny: 1, z: 0 };
  const [ex, ey] = f.geometry.coordinates;
  const t: V3 = [p.ny, -p.nx, 0];
  const n: V3 = [p.nx, p.ny, 0];
  const origin: V3 = [
    ex - offset.cx + n[0] * shift,
    ey - offset.cy + n[1] * shift,
    p.z - DOOR_SINK,
  ];
  return {
    n,
    at: (a, b, c) => [
      origin[0] + t[0] * a + n[0] * b,
      origin[1] + t[1] * a + n[1] * b,
      origin[2] + c,
    ],
  };
}

/**
 * A door's triangles (mesh frame: x = epsgX − cx, y = epsgY − cy, z up),
 * counter-clockwise from outside, laid `shift` metres out of the footprint
 * line onto its wall (`wallShift`). Only the faces one can see: no back
 * (in the wall), no bottom (in the ground), no leaf edges (behind the
 * jambs and the lintel).
 */
export function doorMesh(
  f: DoorFeature,
  offset: { cx: number; cy: number },
  shift = 0
): DoorMesh {
  const out: DoorMesh = { leaf: [], surround: [] };
  const p = f.properties;
  if (!p) {
    return out;
  }
  const { at } = doorFrame(f, offset, shift);
  const half = p.w / 2;
  const top = p.h + DOOR_SINK;
  const { width: s, proud, back } = DOOR_SURROUND;
  const jamb: Face[] = ["+a", "-a", "+b"];
  box(out.surround, at, [-half - s, -half], [-back, proud], [0, top], jamb);
  box(out.surround, at, [half, half + s], [-back, proud], [0, top], jamb);
  box(
    out.surround,
    at,
    [-half - s, half + s],
    [-back, proud],
    [top, top + s],
    ["+a", "-a", "+b", "+c", "-c"]
  );
  box(out.leaf, at, [-half, half], [-back, DOOR_LEAF_PROUD], [0, top], ["+b"]);
  return out;
}

export type Face = "+a" | "-a" | "+b" | "+c" | "-c";

/** The listed faces of a box spanning [a0, a1] along the wall, [b0, b1] out
 *  of it and [c0, c1] up, pushed onto `positions` as triangles. */
export function box(
  positions: number[],
  at: (a: number, b: number, c: number) => V3,
  [a0, a1]: [number, number],
  [b0, b1]: [number, number],
  [c0, c1]: [number, number],
  faces: readonly Face[]
): void {
  const c = (i: number, j: number, k: number) =>
    at(i ? a1 : a0, j ? b1 : b0, k ? c1 : c0);
  // each quad counter-clockwise seen from outside (its normal outward)
  const quads: Record<Face, V3[]> = {
    "+a": [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
    "-a": [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
    "+b": [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
    "+c": [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    "-c": [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
  };
  for (const face of faces) {
    const [q0, q1, q2, q3] = quads[face];
    positions.push(...q0, ...q1, ...q2, ...q0, ...q2, ...q3);
  }
}

/** Where a door meets the ground (ADR 0035): its sill's foot along the
 *  surround's face, EPSG. Where the ground in front is higher than the
 *  lowest sample the sill sinks deeper; where it is lower (a step down
 *  away from the wall) the sill's foot is checked here. */
export function doorJoins(f: DoorFeature): JoinPoint[] {
  const p = f.properties;
  if (!p) {
    return [];
  }
  const [x, y] = f.geometry.coordinates;
  const reach = p.w / 2 + DOOR_SURROUND.width;
  const out = DOOR_SURROUND.proud;
  const base = p.z - DOOR_SINK;
  return joinsAlong(
    "foot",
    {
      x: x - p.ny * reach + p.nx * out,
      y: y + p.nx * reach + p.ny * out,
      z: base,
    },
    {
      x: x + p.ny * reach + p.nx * out,
      y: y - p.nx * reach + p.ny * out,
      z: base,
    }
  );
}
