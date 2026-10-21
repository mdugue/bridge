/**
 * The dormers DOM1 shows on the pitched LoD2 roofs (pipeline/bake/
 * dormers.py) as geometry the building bake appends to the tile's mesh
 * (scripts/bake-city-mesh.ts): per dormer a front wall facing down the
 * slope, two cheeks and a roof reaching back until the main roof rises to
 * meet it — flat at the measured top, or for a shed dormer (`tf`, its
 * measured fall) falling from that top line down to its front, at least
 * `MIN_FRONT` over the main roof there. No window in the front (the
 * window-grid veto); the clay's own look. Pure, no THREE.
 */
import type { DormerFeature } from "./features";

/** How far the front and the cheeks reach into the roof under them. */
export const DORMER_SINK = 0.25;
/** How far the dormer's roof overhangs its front and cheeks. */
export const DORMER_EAVE = 0.15;
/** How far the dormer's roof runs on into the main roof behind it. */
const BACK_TUCK = 0.3;
/** How high its front wall stands at least over the main roof there. */
export const MIN_FRONT = 0.6;
/** How much shallower than the main roof a shed dormer's roof stays at
 *  least (degrees): the two must meet behind its front. */
const SHED_SHALLOWER = 1;

export interface DormerMesh {
  /** 1 on the dormer's roof, 0 on its walls, per vertex */
  isRoof: number[];
  positions: number[];
  /** the lowest point of its walls (absolute, m) */
  base: number;
}

type V3 = [number, number, number];

/**
 * A dormer's triangles (mesh frame: x = epsgX − cx, y = epsgY − cy, z up),
 * counter-clockwise from outside. Frame: a across the slope, b down it, c
 * up (absolute). The main roof there is z − tan(slope)·b; the front stands
 * at b = d/2, the roof runs back from it to where the main roof reaches
 * the measured top — level, or a shed dormer's falling `tf` towards the
 * front (the same back line: the bake writes a shed's top where its roof
 * meets the main roof).
 */
export function dormerMesh(
  f: DormerFeature,
  offset: { cx: number; cy: number }
): DormerMesh {
  const out: DormerMesh = { isRoof: [], positions: [], base: 0 };
  const p = f.properties;
  if (!p) {
    return out;
  }
  const slope = Math.max(p.slope, 15);
  const tan = Math.tan((slope * Math.PI) / 180);
  const bf = p.d / 2;
  const zf = p.z - tan * bf;
  const top = Math.max(p.top, zf + MIN_FRONT);
  const bb = (p.z - top) / tan;
  // a shed dormer's roof at its front, and how it falls per metre
  const fall = Math.min(Math.max(p.tf ?? 0, 0), slope - SHED_SHALLOWER);
  const front = Math.max(
    top - Math.tan((fall * Math.PI) / 180) * (bf - bb),
    zf + MIN_FRONT
  );
  const pitch = (top - front) / (bf - bb);
  const half = p.w / 2;
  const low = zf - DORMER_SINK;
  out.base = low;
  const [ex, ey] = f.geometry.coordinates;
  const t: V3 = [p.ay, -p.ax, 0];
  const n: V3 = [p.ax, p.ay, 0];
  const at = (a: number, b: number, c: number): V3 => [
    ex - offset.cx + t[0] * a + n[0] * b,
    ey - offset.cy + t[1] * a + n[1] * b,
    c,
  ];
  const tri = (roof: number, ...v: V3[]) => {
    for (const q of v) {
      out.positions.push(...q);
      out.isRoof.push(roof);
    }
  };
  const quad = (roof: number, q0: V3, q1: V3, q2: V3, q3: V3) =>
    tri(roof, q0, q1, q2, q0, q2, q3);
  // front (+b)
  quad(
    0,
    at(-half, bf, low),
    at(-half, bf, front),
    at(half, bf, front),
    at(half, bf, low)
  );
  // cheeks (+a, −a): from the front's foot up to the roof line behind
  tri(0, at(half, bf, low), at(half, bf, front), at(half, bb, top));
  tri(0, at(-half, bf, low), at(-half, bb, top), at(-half, bf, front));
  // its roof (+c), a little over the front and cheeks, on into the main
  // roof behind
  const e = DORMER_EAVE;
  const back = top + pitch * BACK_TUCK;
  const eave = front - pitch * e;
  quad(
    1,
    at(-half - e, bb - BACK_TUCK, back),
    at(half + e, bb - BACK_TUCK, back),
    at(half + e, bf + e, eave),
    at(-half - e, bf + e, eave)
  );
  return out;
}
