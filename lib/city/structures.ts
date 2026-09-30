/**
 * The structures the surface model shows beyond LoD2 (pipeline/bake/
 * structures.py) as closed meshes for the city mesh: a column (chimney,
 * tower, mast, …) as a lathed ring profile of its kind, a missing building
 * as its outline extruded to the measured height with a flat roof, a
 * landmark's roof relief as the same extrusion per slab. Flat
 * non-indexed triangles wound counter-clockwise seen from outside, like the
 * scan's sheds (small-buildings.ts); the bake appends them to a tile's
 * buildings (scripts/bake-city-mesh.ts), so they wear the clay, cast
 * shadows, collide and can be picked like any building. No THREE, no DOM:
 * the roof's triangulation is passed in.
 */
import type { StructureFeature, StructureKind } from "./features";
import type { Point2 } from "./polyline";
import type { StructureMesh } from "./small-buildings";

/** Metres a structure reaches below its lowest ground (no gap on a slope). */
export const STRUCTURE_SINK = 0.3;

/** Sides of a column's ring: round enough at street level, cheap from far. */
export const COLUMN_SIDES = 16;

/** A column's silhouette, foot to top: rings at a fraction `at` of its
 *  height, with a radius from the foot's `r` and the top's `rt`. */
type Ring = { at: number; radius: (r: number, rt: number) => number };

const foot = (r: number) => r;
const head = (_: number, rt: number) => rt;
const times =
  (k: number, of: "r" | "rt") =>
  (r: number, rt: number): number =>
    k * (of === "r" ? r : rt);

const PROFILES: Record<
  Exclude<StructureKind, "building" | "relief">,
  Ring[]
> = {
  // a tapering shaft under a slightly wider head band
  chimney: [
    { at: 0, radius: foot },
    { at: 0.95, radius: head },
    { at: 0.95, radius: times(1.1, "rt") },
    { at: 1, radius: times(1.1, "rt") },
  ],
  tower: [
    { at: 0, radius: foot },
    { at: 1, radius: head },
  ],
  mast: [
    { at: 0, radius: foot },
    { at: 1, radius: head },
  ],
  // a shaft with a wider cabin two thirds up, then a thin antenna
  communications_tower: [
    { at: 0, radius: foot },
    { at: 0.62, radius: head },
    { at: 0.62, radius: times(1.8, "r") },
    { at: 0.7, radius: times(1.8, "r") },
    { at: 0.7, radius: times(0.35, "r") },
    { at: 1, radius: times(0.15, "r") },
  ],
  // a slim shaft under a wide tank
  water_tower: [
    { at: 0, radius: times(0.4, "r") },
    { at: 0.68, radius: times(0.4, "r") },
    { at: 0.72, radius: foot },
    { at: 0.97, radius: foot },
    { at: 1, radius: times(0.85, "r") },
  ],
  // a tapering tower under a lantern
  lighthouse: [
    { at: 0, radius: foot },
    { at: 0.86, radius: head },
    { at: 0.86, radius: times(0.95, "rt") },
    { at: 1, radius: times(0.8, "rt") },
  ],
};

function push(out: StructureMesh, roof: number, ...vs: number[][]): void {
  for (const v of vs) {
    out.positions.push(v[0], v[1], v[2]);
    out.isRoof.push(roof);
  }
}

/** A column lathed from its kind's profile around its axis point. */
export function columnMesh(
  f: StructureFeature,
  offset: { cx: number; cy: number },
  sides: number = COLUMN_SIDES
): StructureMesh {
  const out: StructureMesh = { isRoof: [], positions: [] };
  const p = f.properties;
  if (
    !p ||
    p.kind === "building" ||
    p.kind === "relief" ||
    f.geometry.type !== "Point"
  ) {
    return out;
  }
  const [x, y] = f.geometry.coordinates;
  const cx = x - offset.cx;
  const cy = y - offset.cy;
  const r = p.r ?? 1;
  const rt = p.rt ?? r;
  const rings = PROFILES[p.kind].map((ring, i) => ({
    radius: ring.radius(r, rt),
    z: i === 0 ? p.z - STRUCTURE_SINK : p.z + ring.at * p.h,
  }));
  const around = (radius: number, z: number, k: number) => {
    const a = (2 * Math.PI * k) / sides;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a), z];
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const lo = rings[i];
    const hi = rings[i + 1];
    // a horizontal step faces up (a ledge, roof) when it narrows
    const roof = lo.z === hi.z && hi.radius < lo.radius ? 1 : 0;
    for (let k = 0; k < sides; k++) {
      const a0 = around(lo.radius, lo.z, k);
      const a1 = around(lo.radius, lo.z, k + 1);
      const b0 = around(hi.radius, hi.z, k);
      const b1 = around(hi.radius, hi.z, k + 1);
      push(out, roof, a0, a1, b1);
      push(out, roof, a0, b1, b0);
    }
  }
  const top = rings[rings.length - 1];
  const bottom = rings[0];
  for (let k = 0; k < sides; k++) {
    push(
      out,
      1,
      [cx, cy, top.z],
      around(top.radius, top.z, k),
      around(top.radius, top.z, k + 1)
    );
    push(
      out,
      0,
      [cx, cy, bottom.z],
      around(bottom.radius, bottom.z, k + 1),
      around(bottom.radius, bottom.z, k)
    );
  }
  return out;
}

/** Triangulates a polygon in plan: flat x, y pairs of the contour and then
 *  its holes, and where each hole starts (in points) → index triples, flat
 *  (THREE.Earcut.triangulate). The winding of what it returns is not relied
 *  on: each triangle is turned here. */
export type Triangulate = (data: number[], holeIndices: number[]) => number[];

function signedArea(ring: Point2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** A ring without its closing repeat, turned to `ccw`. */
function openRing(ring: Point2[], ccw: boolean): Point2[] {
  const open =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring.slice();
  return signedArea(open) > 0 === ccw ? open : open.reverse();
}

/** A missing building: its outline extruded from below its lowest ground to
 *  the measured height, a flat roof and a floor. */
export function buildingMesh(
  f: StructureFeature,
  offset: { cx: number; cy: number },
  triangulate: Triangulate
): StructureMesh {
  const out: StructureMesh = { isRoof: [], positions: [] };
  const p = f.properties;
  if (!p || f.geometry.type !== "Polygon") {
    return out;
  }
  const [outer, ...inner] = f.geometry.coordinates;
  if (!outer || outer.length < 4) {
    return out;
  }
  const contour = openRing(outer, true);
  const holes = inner
    .map((h) => openRing(h, false))
    .filter((h) => h.length >= 3);
  const base = p.z - STRUCTURE_SINK;
  const top = p.z + p.h;
  const at = ([x, y]: Point2, z: number) => [x - offset.cx, y - offset.cy, z];
  // walls: along a CCW outline (and a CW hole) the outside is on the right
  for (const ring of [contour, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      push(out, 0, at(a, base), at(b, base), at(b, top));
      push(out, 0, at(a, base), at(b, top), at(a, top));
    }
  }
  const all = [...contour, ...holes.flat()];
  const holeIndices: number[] = [];
  let n = contour.length;
  for (const h of holes) {
    holeIndices.push(n);
    n += h.length;
  }
  const tris = triangulate(all.flat(), holeIndices);
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const i = tris[t];
    const ccw = signedArea([all[i], all[tris[t + 1]], all[tris[t + 2]]]) > 0;
    const j = ccw ? tris[t + 1] : tris[t + 2];
    const k = ccw ? tris[t + 2] : tris[t + 1];
    push(out, 1, at(all[i], top), at(all[j], top), at(all[k], top));
    push(out, 0, at(all[i], base), at(all[k], base), at(all[j], base));
  }
  return out;
}

/** The mesh of any kind: an outline (a building, a relief slab) extruded,
 *  a column lathed. */
export function structureShape(
  f: StructureFeature,
  offset: { cx: number; cy: number },
  triangulate: Triangulate
): StructureMesh {
  return f.geometry.type === "Polygon"
    ? buildingMesh(f, offset, triangulate)
    : columnMesh(f, offset);
}

/** The outline a structure covers on the ground (footprints, minimap): the
 *  building's ring, or the column's foot circle as a polygon. */
export function structureFootprint(f: StructureFeature): Point2[] {
  const p = f.properties;
  if (f.geometry.type === "Polygon") {
    return openRing(f.geometry.coordinates[0] ?? [], true);
  }
  const [x, y] = f.geometry.coordinates;
  const r = p?.r ?? 1;
  return Array.from({ length: 8 }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / 8;
    return [x + r * Math.cos(a), y + r * Math.sin(a)];
  });
}
