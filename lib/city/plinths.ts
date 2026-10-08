/**
 * The plinths on the LoD2 walls' street side (pipeline/bake/plinths.py:
 * level pieces of each wall's open stretches, on the DGM1) as geometry the
 * building bake appends to the tile's mesh (scripts/bake-city-mesh.ts): per
 * piece a stone band standing proud of the wall — its front face, a top
 * bevelled down towards the street and its two ends — so the plinth throws
 * a real shadow line and turns its corners, without cutting the LoD2 wall;
 * and the Gurtgesims over the ground floor along the same stretches, a
 * slim band in the same register (`corniceMesh`).
 * Pure, no THREE.
 */
import type { PlinthFeature } from "./features";
import { type JoinPoint, joinsAlong, SINK } from "./ground-join";

/** How the band stands: how far it stands out of the wall, how far it
 *  reaches back into it (LoD2's walls stand a decimetre or so off the
 *  footprint line) and how far its top falls from the wall to its front
 *  edge (the bevel that catches the light). pipeline/bake/plinths.py runs
 *  a piece on past an outer corner by `proud`, so two bands meet there. */
export const PLINTH = { proud: 0.1, back: 0.15, bevel: 0.06 } as const;
/** The band's foot under the lowest ground read along it. */
export const PLINTH_SINK = SINK.box;

/** The Gurtgesims over the ground floor, modelled to match the plinth: a
 *  slim band `proud` out of the wall, `height` tall, its underside flat (a
 *  crisp shadow under it) and its top weathered back to the wall by
 *  `bevel`; its underside at the first storey line. */
export const CORNICE = {
  proud: 0.08,
  back: 0.15,
  height: 0.12,
  bevel: 0.06,
} as const;

type V3 = [number, number, number];
/** A cross-section in the wall's frame: out of the wall, up. */
type Profile = readonly (readonly [number, number])[];

/**
 * A straight run of `profile` along the wall from a to b (the street to its
 * right), pushed onto `out` as triangles counter-clockwise from outside: a
 * face per profile edge except those in `hidden` (in the wall, in the
 * ground) and the two ends. The profile runs up the front, over the top
 * and down the back, convex.
 */
function extrude(
  out: number[],
  [a, b]: readonly [readonly number[], readonly number[]],
  offset: { cx: number; cy: number },
  profile: Profile,
  hidden: readonly number[]
): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-3) {
    return;
  }
  const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n = [t[1], -t[0]];
  const at = (s: number, [o, z]: readonly [number, number]): V3 => [
    a[0] - offset.cx + t[0] * s + n[0] * o,
    a[1] - offset.cy + t[1] * s + n[1] * o,
    z,
  ];
  const tri = (p: V3, q: V3, r: V3) => out.push(...p, ...q, ...r);
  profile.forEach((p, k) => {
    if (hidden.includes(k)) {
      return;
    }
    const q = profile[(k + 1) % profile.length];
    tri(at(0, p), at(len, p), at(len, q));
    tri(at(0, p), at(len, q), at(0, q));
  });
  for (let k = 1; k + 1 < profile.length; k++) {
    tri(at(0, profile[0]), at(0, profile[k]), at(0, profile[k + 1]));
    tri(at(len, profile[0]), at(len, profile[k + 1]), at(len, profile[k]));
  }
}

/**
 * A plinth's triangles (mesh frame: x = epsgX − cx, y = epsgY − cy, z up),
 * counter-clockwise from outside. Only the faces one can see: the front,
 * the bevelled top and the ends — no back (in the wall), no bottom (in
 * the ground).
 */
export function plinthMesh(
  f: PlinthFeature,
  offset: { cx: number; cy: number }
): number[] {
  const out: number[] = [];
  const p = f.properties;
  if (!p) {
    return out;
  }
  const { proud, back, bevel } = PLINTH;
  f.geometry.coordinates.forEach((line, i) => {
    const top = p.top[i];
    const foot = p.g[i] - PLINTH_SINK;
    if (line.length < 2 || !(top - bevel > foot)) {
      return;
    }
    const profile: Profile = [
      [-back, foot],
      [proud, foot],
      [proud, top - bevel],
      [-back, top],
    ];
    // the bottom (in the ground) and the back (in the wall)
    extrude(out, [line[0], line.at(-1) ?? line[0]], offset, profile, [0, 3]);
  });
  return out;
}

/**
 * The Gurtgesims along the same open stretches as the plinth, at one
 * height `z` (its underside: the first storey line over the host's base),
 * level however the ground falls: the plinth's pieces joined end to end
 * into straight runs first, so a run has two ends, not one per piece.
 */
export function corniceMesh(
  f: PlinthFeature,
  offset: { cx: number; cy: number },
  z: number
): number[] {
  const out: number[] = [];
  const { proud, back, height, bevel } = CORNICE;
  const profile: Profile = [
    [-back, z],
    [proud, z],
    [proud, z + height],
    [-back, z + height + bevel],
  ];
  for (const run of straightRuns(f.geometry.coordinates)) {
    // the back (in the wall)
    extrude(out, run, offset, profile, [3]);
  }
  return out;
}

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
  const p = f.properties;
  if (!p) {
    return [];
  }
  return f.geometry.coordinates.flatMap((line, i) => {
    const [a, b] = [line[0], line.at(-1) ?? line[0]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) {
      return [];
    }
    const nx = (b[1] - a[1]) / len;
    const ny = -(b[0] - a[0]) / len;
    const z = p.g[i] - PLINTH_SINK;
    const end = (q: readonly number[]) => ({
      x: q[0] + nx * PLINTH.proud,
      y: q[1] + ny * PLINTH.proud,
      z,
    });
    return joinsAlong("foot", end(a), end(b));
  });
}
