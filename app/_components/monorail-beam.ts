/**
 * A monorail's beam on its supports (lib/city/monorail.ts), drawn into the
 * rail layer's steel (rail-layer.ts): the girder a closed box along the
 * baked line (`bz`, its underside per vertex), and every few metres a
 * portal round the hanging cars' way or a column under a beam ridden on
 * top, each foot on the lowest ground under it and SINK.box into it
 * (`supportFeet`, ADR 0030). No car: they move, and nothing that moves
 * reaches the shadow map (ADR 0009).
 */
import type { RailFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import {
  type MonorailShape,
  type MonorailSupport,
  monorailShape,
  monorailSupports,
  supportFeet,
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
  addEnds(acc, top, shape.half, shape.depth);
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

/** The girder's two end faces, so its box is closed where it ends (at a
 *  tile's seam the two ends meet face to face inside the girder). */
function addEnds(acc: Mesh3, top: Pt[], half: number, depth: number) {
  const tan = tangentsXZ(top);
  const last = top.length - 1;
  for (const [i, out] of [
    [0, -1],
    [last, 1],
  ]) {
    const p = top[i];
    const t = tan[i];
    // the side offset, as `addRibbon` takes it, and the face's outward way
    const sx = -t.y * half;
    const sz = t.x * half;
    const nx = t.x * out;
    const nz = t.y * out;
    const lo = p.y - depth;
    // counter-clockwise seen from outside: + side first at the start, the
    // − side first at the end
    const s = out < 0 ? 1 : -1;
    quadXYZ(
      acc,
      p.x + sx * s,
      p.y,
      p.z + sz * s,
      p.x - sx * s,
      p.y,
      p.z - sz * s,
      p.x - sx * s,
      lo,
      p.z - sz * s,
      p.x + sx * s,
      lo,
      p.z + sz * s,
      nx,
      0,
      nz
    );
  }
}

/** One support: a column under the axis, or a portal — two legs either
 *  side and a crossbeam over the girder; none where `supportFeet` finds no
 *  ground for it. */
function addSupport(
  acc: Mesh3,
  s: MonorailSupport,
  shape: MonorailShape,
  ctx: GroundContext
): void {
  const feet = supportFeet(s, shape, ctx.heightAt);
  if (!feet) {
    return;
  }
  if (shape.legs === 0) {
    const [foot] = feet;
    const w = epsgToWorld(foot.at[0], foot.at[1], ctx.offset);
    addColumn(acc, w.x, w.z, foot.base, s.under, foot.half);
    return;
  }
  const cap = s.under + shape.depth + CAP_HALF;
  const ends = feet.map((foot) => {
    const w = epsgToWorld(foot.at[0], foot.at[1], ctx.offset);
    addColumn(acc, w.x, w.z, foot.base, cap + CAP_HALF, foot.half);
    return w;
  });
  const [l, r] = ends;
  addStrut(acc, [l.x, cap, l.z], [r.x, cap, r.z], CAP_HALF);
}
