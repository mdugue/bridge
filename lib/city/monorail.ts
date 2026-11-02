/**
 * A monorail's beam and the supports it stands on — Dresden's
 * Schwebebahn, whose cars hang under it. DOM-free, THREE-free, pure.
 *
 * The bake writes the beam as a line with its underside's height per
 * vertex (`bz`, pipeline/bake/rail_osm.py `monorails`): the upper hull of
 * the ground plus a car's clearance, so the beam runs straight across a
 * hollow and bends only over a crest, as a beam on supports does. This
 * module lays out what the rail layer draws of it (rail-layer.ts): the
 * beam along that line, and a support every SUPPORT_EVERY_M — a portal
 * whose legs stand either side of the hanging cars' way, or a column
 * under a beam the cars ride on top of —, each foot on the lowest ground
 * under its corners and SINK.box into it, reporting where it meets the
 * ground (`monorailJoins`, ADR 0030).
 */
import type { RailFeature } from "./features";
import {
  type HeightAt,
  type JoinPoint,
  lowestGround,
  SINK,
} from "./ground-join";
import type { Point2 } from "./polyline";

export type MonorailKind = "hanging" | "top";

/** A beam's section and its supports' spacing. */
export interface MonorailShape {
  /** the beam's half-width (m) */
  half: number;
  /** the beam's depth (m) */
  depth: number;
  /** a portal's legs stand this far either side of the axis (m); 0: one
   *  column under the axis */
  legs: number;
}

/** A support every this many metres along the beam. */
export const SUPPORT_EVERY_M = 8;
/** No support whose leg would be shorter than this (m): the beam rests on
 *  what stands under it there. The bake keeps the beam a car's clearance
 *  over the DGM, so only a ground other than the bake's comes this close. */
export const SUPPORT_MIN_M = 2;
/** A portal leg's and a column's half-section (m). */
export const LEG_HALF_M = 0.22;
export const COLUMN_HALF_M = 0.4;
/** A hanging car's half-width with the gap to a leg (m). */
const CAR_HALF_M = 1.5;
/** The beam carries its tracks this far apart (m). */
const TRACK_PITCH_M = 2.6;

/** The beam of a monorail of `tracks` tracks: one girder over them all,
 *  a portal round the cars hanging under it, a column under a beam ridden
 *  on top. */
export function monorailShape(
  kind: MonorailKind,
  tracks: number
): MonorailShape {
  const n = Math.min(Math.max(tracks, 1), 2);
  if (kind === "top") {
    return { half: 0.45 * n, depth: 1.1, legs: 0 };
  }
  const half = 0.5 + ((n - 1) * TRACK_PITCH_M) / 2;
  return { half, depth: 1.4, legs: half + CAR_HALF_M };
}

/** A support: where it stands (EPSG), the beam's underside over it (m),
 *  and the beam's heading there (unit, EPSG). */
export interface MonorailSupport {
  at: Point2;
  dir: Point2;
  under: number;
}

/**
 * The supports along a beam (`coords` with the underside `bz` per vertex):
 * one every `every` metres, the first half a spacing in, at the beam's
 * height there — a feature clipped at a tile's edge starts its own count,
 * so the spacing across a seam is off by at most one spacing.
 */
export function monorailSupports(
  coords: readonly Point2[],
  bz: readonly number[],
  every = SUPPORT_EVERY_M
): MonorailSupport[] {
  const out: MonorailSupport[] = [];
  if (coords.length < 2 || bz.length !== coords.length) {
    return out;
  }
  let next = every / 2;
  let start = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) {
      continue;
    }
    const dir: Point2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    while (next <= start + len) {
      const t = (next - start) / len;
      out.push({
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        dir,
        under: bz[i - 1] + (bz[i] - bz[i - 1]) * t,
      });
      next += every;
    }
    start += len;
  }
  return out;
}

/** A support's foot: where it stands (EPSG), its half-section (m) and how
 *  low it reaches (m, absolute). */
export interface MonorailFoot {
  at: Point2;
  half: number;
  base: number;
}

/** The four corners of a foot of half-section `half` at `at` (EPSG): a
 *  square on the grid's axes, as the rail layer draws it (`addColumn`). */
export function footCorners(at: Point2, half: number): Point2[] {
  const [x, y] = at;
  return [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
  ];
}

/**
 * Where a support stands: one column under the axis, or a portal's two
 * legs either side of it (`shape.legs` off the axis, square to the
 * heading), each foot SINK.box under the lowest ground at its corners.
 * None where the ground under a foot is unknown or comes within
 * SUPPORT_MIN_M of the beam's underside.
 */
export function supportFeet(
  s: MonorailSupport,
  shape: MonorailShape,
  heightAt: HeightAt
): MonorailFoot[] | null {
  const half = shape.legs === 0 ? COLUMN_HALF_M : LEG_HALF_M;
  const sides = shape.legs === 0 ? [0] : [1, -1];
  const feet: MonorailFoot[] = [];
  for (const side of sides) {
    const at: Point2 = [
      s.at[0] - s.dir[1] * shape.legs * side,
      s.at[1] + s.dir[0] * shape.legs * side,
    ];
    const low = lowestGround(heightAt, footCorners(at, half));
    if (low === null || s.under - low < SUPPORT_MIN_M) {
      return null;
    }
    feet.push({ at, half, base: low - SINK.box });
  }
  return feet;
}

/** Where a monorail's supports meet the ground (ADR 0030): every foot's
 *  corners at its base, EPSG. Empty for a feature that is no monorail. */
export function monorailJoins(f: RailFeature, heightAt: HeightAt): JoinPoint[] {
  const p = f.properties;
  if (f.geometry?.type !== "LineString" || !p?.mono || !p.bz) {
    return [];
  }
  const shape = monorailShape(p.mono, p.tracks ?? 1);
  return monorailSupports(f.geometry.coordinates, p.bz).flatMap((s) =>
    (supportFeet(s, shape, heightAt) ?? []).flatMap((foot) =>
      footCorners(foot.at, foot.half).map(([x, y]): JoinPoint => ({
        kind: "foot",
        x,
        y,
        z: foot.base,
      }))
    )
  );
}
