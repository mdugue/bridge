/**
 * What the inquiry probe tests a ray against when the scene cannot answer
 * the ray itself (ADR 0037, plan 049 phase 4): trees, monuments and
 * fountains are drawn as instanced sets or merged meshes that three's
 * Raycaster cannot pick one by one, so each askable thing gets simple
 * solids built from its data — a vertical cylinder (a trunk, a crown, a
 * statue) or a vertical prism over a ring (a fountain basin). World frame
 * (Y up), metres. No THREE, no DOM.
 */

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

/** A vertical cylinder from y0 to y1, closed at both ends. */
export interface Cylinder {
  r: number;
  x: number;
  y0: number;
  y1: number;
  z: number;
}

/** A vertical prism over a ring in the x–z plane, from y0 to y1. */
export interface Prism {
  ring: readonly (readonly [number, number])[];
  y0: number;
  y1: number;
}

export type AskSolid = { cylinder: Cylinder } | { prism: Prism };

/** One askable thing: its solids and what it is. */
export interface AskItem<T> {
  solids: readonly AskSolid[];
  target: T;
}

const EPS = 1e-12;

/** Distance along the ray (unit `d`) to the cylinder, or null; 0 inside. */
export function rayCylinder(o: Xyz, d: Xyz, c: Cylinder): number | null {
  const ox = o.x - c.x;
  const oz = o.z - c.z;
  if (ox * ox + oz * oz <= c.r * c.r && o.y >= c.y0 && o.y <= c.y1) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  const a = d.x * d.x + d.z * d.z;
  if (a > EPS) {
    const b = ox * d.x + oz * d.z;
    const disc = b * b - a * (ox * ox + oz * oz - c.r * c.r);
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = o.y + t * d.y;
      if (t >= 0 && y >= c.y0 && y <= c.y1) {
        best = t;
      }
    }
  }
  if (Math.abs(d.y) > EPS) {
    for (const y of [c.y0, c.y1]) {
      const t = (y - o.y) / d.y;
      const x = o.x + t * d.x - c.x;
      const z = o.z + t * d.z - c.z;
      if (t >= 0 && t < best && x * x + z * z <= c.r * c.r) {
        best = t;
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** Whether (x, z) lies inside the ring (even–odd). */
export function insideRingXz(
  ring: readonly (readonly [number, number])[],
  x: number,
  z: number
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance along the ray (unit `d`) to the prism, or null; 0 inside. */
export function rayPrism(o: Xyz, d: Xyz, p: Prism): number | null {
  if (o.y >= p.y0 && o.y <= p.y1 && insideRingXz(p.ring, o.x, o.z)) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  // the walls: the ray against each edge in plan, then the height
  for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) {
    const [ax, az] = p.ring[j];
    const ex = p.ring[i][0] - ax;
    const ez = p.ring[i][1] - az;
    const denom = d.x * ez - d.z * ex;
    if (Math.abs(denom) < EPS) {
      continue;
    }
    const wx = ax - o.x;
    const wz = az - o.z;
    const t = (wx * ez - wz * ex) / denom;
    const u = (wx * d.z - wz * d.x) / denom;
    const y = o.y + t * d.y;
    if (t >= 0 && t < best && u >= 0 && u <= 1 && y >= p.y0 && y <= p.y1) {
      best = t;
    }
  }
  // the top and the bottom
  if (Math.abs(d.y) > EPS) {
    for (const y of [p.y0, p.y1]) {
      const t = (y - o.y) / d.y;
      if (
        t >= 0 &&
        t < best &&
        insideRingXz(p.ring, o.x + t * d.x, o.z + t * d.z)
      ) {
        best = t;
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** Distance along the ray to the nearest of a thing's solids, or null. */
export function raySolids(
  o: Xyz,
  d: Xyz,
  solids: readonly AskSolid[]
): number | null {
  let best: number | null = null;
  for (const s of solids) {
    const t =
      "cylinder" in s ? rayCylinder(o, d, s.cylinder) : rayPrism(o, d, s.prism);
    if (t !== null && (best === null || t < best)) {
      best = t;
    }
  }
  return best;
}

/** The nearest item the ray meets within `far`, and how far along. */
export function nearestItem<T>(
  o: Xyz,
  d: Xyz,
  items: Iterable<AskItem<T>>,
  far: number
): { distance: number; target: T } | null {
  let best: { distance: number; target: T } | null = null;
  for (const item of items) {
    const t = raySolids(o, d, item.solids);
    if (t !== null && t <= far && (best === null || t < best.distance)) {
      best = { distance: t, target: item.target };
    }
  }
  return best;
}
