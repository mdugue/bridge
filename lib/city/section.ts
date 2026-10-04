/**
 * Modell's cuts (plan 055 phases 3–4, ADR 0044), the pure half: the ground
 * strip a Schnitt draws along its cut line (the Geländeschnitt) and a
 * cut-out's plinth draws along its edges, and the cut-out itself — a
 * rectangle on the ground, turned with the view, and the planes that keep
 * only what stands inside it. World frame (Y-up) as lib/city/pose.ts. No
 * THREE, no DOM; the meshes are app/_components/model-cuts.ts.
 */
import { groundAxes, type ModelView, modelFootprint } from "./model-view";

/** A point on the ground plane (world x, z). */
export interface GroundPoint {
  x: number;
  z: number;
}

/** A strip's triangles: positions (x, y, z per vertex) and an index. */
export interface StripMesh {
  positions: Float32Array;
  index: Uint32Array;
}

/** The most samples one strip takes. */
const MAX_SAMPLES = 1200;

/**
 * A vertical strip from the ground down to `base`, from `from` to `to`,
 * sampled every `step` m. Where the ground is unknown (`heightAt` gives
 * null — no terrain loaded there) the strip breaks: it never invents a
 * height.
 */
export function groundStrip(
  from: GroundPoint,
  to: GroundPoint,
  step: number,
  heightAt: (x: number, z: number) => number | null,
  base: number
): StripMesh {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.min(
    Math.max(Math.ceil(length / Math.max(step, 0.01)), 1),
    MAX_SAMPLES
  );
  const positions: number[] = [];
  const index: number[] = [];
  let previous = -1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const h = heightAt(x, z);
    if (h === null) {
      previous = -1;
      continue;
    }
    const v = positions.length / 3;
    positions.push(x, h, z, x, Math.min(base, h - 0.5), z);
    if (previous >= 0) {
      // (top, bottom) of the last sample and of this one
      index.push(previous, previous + 1, v, v, previous + 1, v + 1);
    }
    previous = v;
  }
  return {
    positions: new Float32Array(positions),
    index: new Uint32Array(index),
  };
}

/** Joins strips into one mesh. */
export function joinStrips(strips: readonly StripMesh[]): StripMesh {
  let vertices = 0;
  let indices = 0;
  for (const s of strips) {
    vertices += s.positions.length;
    indices += s.index.length;
  }
  const positions = new Float32Array(vertices);
  const index = new Uint32Array(indices);
  let pv = 0;
  let pi = 0;
  for (const s of strips) {
    positions.set(s.positions, pv);
    const offset = pv / 3;
    for (let i = 0; i < s.index.length; i++) {
      index[pi + i] = s.index[i] + offset;
    }
    pv += s.positions.length;
    pi += s.index.length;
  }
  return { positions, index };
}

/**
 * The Schnitt's ground line: across the picture along the cut (through
 * the pivot, just behind the near plane so it is not clipped with it),
 * from a margin beyond each edge.
 */
export function sectionLine(
  view: ModelView,
  halfWidth: number,
  behind = 0.05
): { from: GroundPoint; to: GroundPoint } {
  const { right, ahead } = groundAxes(view);
  const w = halfWidth * 1.1;
  const cx = view.pivot.x + ahead.x * behind;
  const cz = view.pivot.z + ahead.z * behind;
  return {
    from: { x: cx - right.x * w, z: cz - right.z * w },
    to: { x: cx + right.x * w, z: cz + right.z * w },
  };
}

// --- the cut-out -----------------------------------------------------------

/** A rectangle on the ground, turned with the view it was set from. */
export interface CutOut {
  centre: GroundPoint;
  /** compass heading of its "ahead" axis (deg) */
  turnDeg: number;
  /** half its size along the view's right and ahead axes (m) */
  halfRight: number;
  halfAhead: number;
}

/** The cut-out fills this share of the largest square the picture holds. */
export const CUT_SHARE = 0.8;

/** Is `p` inside the convex polygon `poly` (either winding)? */
function insideConvex(poly: readonly GroundPoint[], p: GroundPoint): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) {
      continue;
    }
    const s = Math.sign(cross);
    if (sign !== 0 && s !== sign) {
      return false;
    }
    sign = s;
  }
  return true;
}

/**
 * The cut-out "what is on screen", as a planner's model base: a square
 * aligned with north, centred on the pivot, `CUT_SHARE` of the largest one
 * the picture's ground holds — a square in the Lageplan, a rhombus in the
 * Isometrie.
 */
export function cutOutFromView(
  view: ModelView,
  viewport: { width: number; height: number }
): CutOut {
  const footprint = modelFootprint(view, viewport).map((p) => ({
    x: p.x,
    z: p.z,
  }));
  const c = { x: view.pivot.x, z: view.pivot.z };
  const fits = (r: number) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].every(([sx, sz]) =>
      insideConvex(footprint, { x: c.x + sx * r, z: c.z + sz * r })
    );
  let lo = 0;
  let hi = Math.max(
    ...footprint.map((p) => Math.hypot(p.x - c.x, p.z - c.z)),
    1
  );
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // a footprint that collapsed (a ray past the horizon) holds no square:
  // the picture's half-width on the ground instead
  const fallback = (view.metresPerPixel * viewport.width) / 4;
  const half = lo > 1 ? lo * CUT_SHARE : fallback;
  return { centre: c, turnDeg: 0, halfRight: half, halfAhead: half };
}

/** The cut-out's axes on the ground (unit, world x/z). */
function cutAxes(cut: CutOut): { right: GroundPoint; ahead: GroundPoint } {
  const h = (cut.turnDeg * Math.PI) / 180;
  // as model-view.ts's: north = −z, east = +x
  return {
    right: { x: Math.cos(h), z: Math.sin(h) },
    ahead: { x: Math.sin(h), z: -Math.cos(h) },
  };
}

/** Its four corners, counter-clockwise seen from above. */
export function cutOutCorners(cut: CutOut): GroundPoint[] {
  const { right, ahead } = cutAxes(cut);
  const at = (sr: number, sa: number): GroundPoint => ({
    x:
      cut.centre.x +
      right.x * cut.halfRight * sr +
      ahead.x * cut.halfAhead * sa,
    z:
      cut.centre.z +
      right.z * cut.halfRight * sr +
      ahead.z * cut.halfAhead * sa,
  });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/**
 * The four vertical planes that keep the inside (three's convention: a
 * point is kept where normal · p + constant ≥ 0).
 */
export function cutOutPlanes(
  cut: CutOut
): { normal: { x: number; y: number; z: number }; constant: number }[] {
  const { right, ahead } = cutAxes(cut);
  const plane = (n: GroundPoint, half: number) => ({
    normal: { x: n.x, y: 0, z: n.z },
    constant: half - (n.x * cut.centre.x + n.z * cut.centre.z),
  });
  const neg = (p: GroundPoint): GroundPoint => ({ x: -p.x, z: -p.z });
  return [
    plane(right, cut.halfRight),
    plane(neg(right), cut.halfRight),
    plane(ahead, cut.halfAhead),
    plane(neg(ahead), cut.halfAhead),
  ];
}

/** Is a ground point inside the cut-out? */
export function insideCutOut(cut: CutOut, p: GroundPoint): boolean {
  return cutOutPlanes(cut).every(
    (pl) => pl.normal.x * p.x + pl.normal.z * p.z + pl.constant >= -1e-6
  );
}
