/**
 * The plinths on the LoD2 walls' street side (pipeline/bake/plinths.py:
 * level pieces of each wall's open stretches, on the DGM1) as geometry the
 * building bake appends to the tile's mesh (scripts/bake-city-mesh.ts): per
 * piece a stone band standing proud of the wall — its front face, a top
 * bevelled down towards the street and its two ends — so the plinth throws
 * a real shadow line and turns its corners, without cutting the LoD2 wall.
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

type V3 = [number, number, number];

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
  f.geometry.coordinates.forEach((line, i) => {
    const top = p.top[i];
    const foot = p.g[i] - PLINTH_SINK;
    if (line.length < 2 || !(top > foot)) {
      return;
    }
    const [a, b] = [line[0], line.at(-1) ?? line[0]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-3) {
      return;
    }
    const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    // the street is to the right of a→b
    const n = [t[1], -t[0]];
    const at = (s: number, o: number, z: number): V3 => [
      a[0] - offset.cx + t[0] * s + n[0] * o,
      a[1] - offset.cy + t[1] * s + n[1] * o,
      z,
    ];
    const { proud, back, bevel } = PLINTH;
    const edge = top - bevel;
    const quad = (q: V3[]) =>
      out.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    // front
    quad([
      at(0, proud, foot),
      at(len, proud, foot),
      at(len, proud, edge),
      at(0, proud, edge),
    ]);
    // top, bevelled down from the wall to the front edge
    quad([
      at(0, proud, edge),
      at(len, proud, edge),
      at(len, -back, top),
      at(0, -back, top),
    ]);
    // the ends
    quad([
      at(len, proud, foot),
      at(len, -back, foot),
      at(len, -back, top),
      at(len, proud, edge),
    ]);
    quad([
      at(0, -back, foot),
      at(0, proud, foot),
      at(0, proud, edge),
      at(0, -back, top),
    ]);
  });
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
