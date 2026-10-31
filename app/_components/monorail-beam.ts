/**
 * A monorail's beam on its supports (lib/city/monorail.ts), drawn into the
 * rail layer's steel (rail-layer.ts): the girder a closed box along the
 * baked line (`bz`, its underside per vertex), and every few metres a
 * portal round the hanging cars' way or a column under a beam ridden on
 * top, each foot SINK.wall into the ground (ADR 0030). No car: they move,
 * and nothing that moves reaches the shadow map (ADR 0009).
 */
import type { RailFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { SINK } from "@/lib/city/ground-join";
import {
  type MonorailShape,
  type MonorailSupport,
  monorailShape,
  monorailSupports,
  SUPPORT_MIN_M,
} from "@/lib/city/monorail";
import {
  addColumn,
  addRibbon,
  addStrut,
  type Mesh3,
  type Pt,
  quadXYZ,
  tangentsXZ,
} from "./mesh-kit";

const LEG_HALF = 0.22; // a portal leg's half-section (m)
const COLUMN_HALF = 0.4; // a column's half-section (m)
const CAP_HALF = 0.25; // a portal's crossbeam half-section, on the girder (m)

/** Adds one monorail feature's beam and supports to `acc`; false for a
 *  feature that is none (no `mono`, or its heights do not fit its line). */
export function addMonorail(
  acc: Mesh3,
  f: RailFeature,
  ctx: GroundContext
): boolean {
  const p = f.properties;
  const bz = p?.bz;
  if (f.geometry?.type !== "LineString" || !p?.mono || !bz) {
    return false;
  }
  const coords = f.geometry.coordinates;
  if (bz.length !== coords.length || coords.length < 2) {
    return false;
  }
  const shape = monorailShape(p.mono, p.tracks ?? 1);
  const top: Pt[] = coords.map(([ex, ey], i) => {
    const w = epsgToWorld(ex, ey, ctx.offset);
    return { x: w.x, y: bz[i] + shape.depth, z: w.z };
  });
  addRibbon(acc, top, 0, shape.half, shape.depth);
  addUnderside(acc, top, shape.half, shape.depth);
  for (const s of monorailSupports(coords, bz)) {
    addSupport(acc, s, shape, ctx);
  }
  return true;
}

/** The girder's underside: `addRibbon` draws its top and sides. */
function addUnderside(acc: Mesh3, top: Pt[], half: number, depth: number) {
  const tan = tangentsXZ(top);
  for (let i = 0; i < top.length - 1; i++) {
    const a = top[i];
    const b = top[i + 1];
    // the side offsets at each end, as `addRibbon` takes them
    const ax = -tan[i].y * half;
    const az = tan[i].x * half;
    const bx = -tan[i + 1].y * half;
    const bzz = tan[i + 1].x * half;
    quadXYZ(
      acc,
      a.x + ax,
      a.y - depth,
      a.z + az,
      a.x - ax,
      a.y - depth,
      a.z - az,
      b.x - bx,
      b.y - depth,
      b.z - bzz,
      b.x + bx,
      b.y - depth,
      b.z + bzz,
      0,
      -1,
      0
    );
  }
}

/** One support: a column under the axis, or a portal — two legs either
 *  side and a crossbeam over the girder. None where the beam runs low
 *  over the ground (a station) or a foot's ground is unknown. */
function addSupport(
  acc: Mesh3,
  s: MonorailSupport,
  shape: MonorailShape,
  ctx: GroundContext
): void {
  const top = s.under + shape.depth;
  if (shape.legs === 0) {
    const g = ctx.heightAt(s.at[0], s.at[1]);
    if (g !== null && s.under - g >= SUPPORT_MIN_M) {
      const w = epsgToWorld(s.at[0], s.at[1], ctx.offset);
      addColumn(acc, w.x, w.z, g - SINK.wall, s.under, COLUMN_HALF);
    }
    return;
  }
  // a foot on the map's left of the heading, and one on its right
  const feet: { x: number; z: number; g: number }[] = [];
  for (const side of [1, -1]) {
    const x = s.at[0] - s.dir[1] * shape.legs * side;
    const y = s.at[1] + s.dir[0] * shape.legs * side;
    const g = ctx.heightAt(x, y);
    if (g === null || s.under - g < SUPPORT_MIN_M) {
      return;
    }
    feet.push({ ...epsgToWorld(x, y, ctx.offset), g });
  }
  const cap = top + CAP_HALF;
  for (const { x, z, g } of feet) {
    addColumn(acc, x, z, g - SINK.wall, cap + CAP_HALF, LEG_HALF);
  }
  const [l, r] = feet;
  addStrut(acc, [l.x, cap, l.z], [r.x, cap, r.z], CAP_HALF);
}
