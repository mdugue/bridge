/**
 * The LoD2 roofs that miss the measured surface, rebuilt from DOM1 as
 * stepped flat blocks (pipeline/bake/roofs.py), put in place of their
 * objects' LoD2 triangles in the city mesh (scripts/bake-city-mesh.ts).
 *
 * Every part of an object is a prism from the object's own LoD2 base (the
 * lowest vertex of its LoD2 shell: where its walls stood on the ground
 * before) up to the part's measured roof `z`, walls and a flat roof, as
 * flat non-indexed triangles wound counter-clockwise seen from outside (the
 * clay material draws front faces). No floor: it lies under the ground,
 * and a ray from the sun through a part leaves by the walls facing away,
 * the back faces the shadow pass draws, wherever it reaches anything that
 * can be seen (a floor would add a sixth of the site's triangles). Two
 * parts side by side each stand their own wall on the shared edge; the
 * lower one's is inside the higher, the higher one's shows above the lower
 * roof — the step. Ground beside the building higher than the base: the
 * walls run into it, as the LoD2 walls did; lower: the base is the LoD2's,
 * which already reached the lowest ground under the footprint (ADR 0035).
 */
import { ShapeUtils, Vector2 } from "three";
import type { MeasuredRoofFeature } from "../lib/city/features";
import type { Point2 } from "../lib/city/polyline";

/** One object's triangles in the recentered data frame (Z-up). */
export interface PrismMesh {
  /** 1 on roof vertices, 0 elsewhere */
  isRoof: number[];
  /** x, y, z per vertex */
  positions: number[];
}

/** The measured parts by LoD2 object id. */
export function measuredRoofsById(
  features: readonly MeasuredRoofFeature[]
): Map<string, MeasuredRoofFeature[]> {
  const out = new Map<string, MeasuredRoofFeature[]>();
  for (const f of features) {
    const id = f.properties?.id;
    if (id === undefined || f.geometry.type !== "Polygon") {
      continue;
    }
    const parts = out.get(id);
    if (parts) {
      parts.push(f);
    } else {
      out.set(id, [f]);
    }
  }
  return out;
}

/** Twice the signed area of a ring (positive = counter-clockwise). */
function signedArea(ring: readonly Point2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

/** A GeoJSON ring without its closing point, wound as asked. */
function openRing(ring: readonly Point2[], ccw: boolean): Point2[] {
  const first = ring[0];
  const last = ring.at(-1);
  const open =
    first && last && first[0] === last[0] && first[1] === last[1]
      ? ring.slice(0, -1)
      : ring.slice();
  return signedArea(open) > 0 === ccw ? open : open.reverse();
}

/**
 * The prisms of one object's parts, `offset` subtracted from x and y (the
 * tileset's recenter offset). A part whose roof is not above `base` is
 * left out.
 */
export function measuredRoofMesh(
  parts: readonly MeasuredRoofFeature[],
  base: number,
  offset: { cx: number; cy: number }
): PrismMesh {
  const out: PrismMesh = { isRoof: [], positions: [] };
  const push = (roof: number, x: number, y: number, z: number) => {
    out.positions.push(x - offset.cx, y - offset.cy, z);
    out.isRoof.push(roof);
  };
  for (const f of parts) {
    const top = f.properties?.z;
    const [outer, ...inner] = f.geometry.coordinates;
    if (top === undefined || top <= base || outer === undefined) {
      continue;
    }
    // Outside on the right of every edge: the outer ring counter-clockwise,
    // the holes clockwise (seen from above).
    const contour = openRing(outer, true);
    const holes = inner.map((h) => openRing(h, false));
    if (contour.length < 3) {
      continue;
    }
    for (const ring of [contour, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % ring.length];
        push(0, ax, ay, base);
        push(0, bx, by, base);
        push(0, bx, by, top);
        push(0, ax, ay, base);
        push(0, bx, by, top);
        push(0, ax, ay, top);
      }
    }
    const all = [contour, ...holes].flat();
    const tris = ShapeUtils.triangulateShape(
      contour.map(([x, y]) => new Vector2(x, y)),
      holes.map((h) => h.map(([x, y]) => new Vector2(x, y)))
    );
    for (const [a, b, c] of tris) {
      // counter-clockwise from above
      const [p, q, r] = [all[a], all[b], all[c]];
      const ccw =
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) > 0;
      const [u, v] = ccw ? [q, r] : [r, q];
      push(1, p[0], p[1], top);
      push(1, u[0], u[1], top);
      push(1, v[0], v[1], top);
    }
  }
  return out;
}
