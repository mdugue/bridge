/**
 * The ground under a study's places (plan 054 phase 2, the sun study's
 * spike): each place's outline cut into triangles no edge of which is
 * longer than MARK_EDGE_M, so the mark can take the ground's height at
 * every vertex and lie on a slope. A point place (a bench) is a small disc.
 * In the viewer, not lib/city: three triangulates.
 */
import { ShapeUtils, Vector2 } from "three";
import type { Ring } from "@/lib/city/sun-study";

/** The longest edge (m) a mark's triangle keeps. */
export const MARK_EDGE_M = 3;
/** A point place's disc (m) and its sides. */
export const MARK_DISC_M = 2.5;
const DISC_SIDES = 12;

/** A place's mark: its outline (or a point) and the share of shade. */
export interface StudyMark {
  rings: readonly Ring[] | null;
  x: number;
  y: number;
  shade: number;
}

type P = readonly [number, number];

function split(a: P, b: P, c: P, out: number[]): void {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const longest = Math.max(ab, bc, ca);
  if (longest <= MARK_EDGE_M) {
    out.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    return;
  }
  // halve the longest edge: the two halves keep the winding
  if (longest === ab) {
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    split(a, m, c, out);
    split(m, b, c, out);
  } else if (longest === bc) {
    const m: P = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    split(a, b, m, out);
    split(a, m, c, out);
  } else {
    const m: P = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
    split(a, b, m, out);
    split(m, b, c, out);
  }
}

function disc(x: number, y: number): Ring {
  return Array.from({ length: DISC_SIDES }, (_, i) => {
    const a = (i / DISC_SIDES) * Math.PI * 2;
    return [
      x + Math.cos(a) * MARK_DISC_M,
      y + Math.sin(a) * MARK_DISC_M,
    ] as const;
  });
}

/** A mark's triangles as (x, y) pairs (site CRS), three per triangle,
 *  counter-clockwise seen from above. */
export function markTriangles(mark: StudyMark): number[] {
  const rings = mark.rings ?? [disc(mark.x, mark.y)];
  const open = rings.map((ring) => {
    const pts = ring.map(([x, y]) => new Vector2(x, y));
    const last = pts.at(-1);
    return last && pts.length > 1 && last.equals(pts[0])
      ? pts.slice(0, -1)
      : pts;
  });
  const [outer, ...holes] = open;
  if (outer.length < 3) {
    return [];
  }
  // ShapeUtils wants the outline clockwise and the holes the other way
  const contour = ShapeUtils.isClockWise(outer) ? outer : [...outer].reverse();
  const inner = holes.map((h) =>
    ShapeUtils.isClockWise(h) ? [...h].reverse() : h
  );
  const all = [...contour, ...inner.flat()];
  const out: number[] = [];
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, inner)) {
    const a: P = [all[i].x, all[i].y];
    const b: P = [all[j].x, all[j].y];
    const c: P = [all[k].x, all[k].y];
    // counter-clockwise from above (so its face looks up)
    const ccw =
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    split(a, ccw ? b : c, ccw ? c : b, out);
  }
  return out;
}
