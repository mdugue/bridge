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
export const DOOR_SURROUND = { width: 0.2, proud: 0.12, back: 0.12 } as const;
/** How far the leaf stands out of the wall: behind the surround's face, so
 *  the doorway reads as a recess. */
export const DOOR_LEAF_PROUD = 0.05;
/** A door stands on one ground sample (the lowest in front of it). */
export const DOOR_SINK = SINK.box;

export interface DoorMesh {
  leaf: number[];
  surround: number[];
}

type V3 = [number, number, number];

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

/** Where a ray from `o` along −n meets the triangle facing it (its first
 *  vertex at `t`), as the distance along the ray; undefined if it misses. */
function rayHit(
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

type Face = "+a" | "-a" | "+b" | "+c" | "-c";

/** The listed faces of a box spanning [a0, a1] along the wall, [b0, b1] out
 *  of it and [c0, c1] up, pushed onto `positions` as triangles. */
function box(
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
