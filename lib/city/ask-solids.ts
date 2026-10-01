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

/**
 * A deck over a ring whose top follows a measured line (a bridge): within
 * the coarse prism, the ray must come within `below` under and `above`
 * over `topAt` (x, z → world Y) to meet it.
 */
export interface Slab extends Prism {
  above: number;
  below: number;
  topAt: (x: number, z: number) => number;
}

export type AskSolid =
  | { cylinder: Cylinder }
  | { prism: Prism }
  | { slab: Slab };

/** The step a ray marches a slab in (m). */
const SLAB_STEP = 0.25;

/** One askable thing: its solids and what it is. */
export interface AskItem<T> {
  solids: readonly AskSolid[];
  target: T;
}

/** What a ray met: how far along, what, and its solids (for its mark). */
export interface AskHit<T> extends AskItem<T> {
  distance: number;
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

/** Distance along the ray (unit `d`) to the slab's deck, or null: from
 *  where the ray enters the coarse prism, marched until it meets the deck
 *  or leaves the prism's extent. */
export function raySlab(o: Xyz, d: Xyz, s: Slab): number | null {
  const enter = rayPrism(o, d, s);
  if (enter === null) {
    return null;
  }
  let span = 0;
  for (const [x, z] of s.ring) {
    for (const [x2, z2] of s.ring) {
      span = Math.max(span, Math.hypot(x - x2, z - z2));
    }
  }
  const reach = Math.hypot(span, s.y1 - s.y0);
  for (let t = enter; t <= enter + reach; t += SLAB_STEP) {
    const x = o.x + t * d.x;
    const y = o.y + t * d.y;
    const z = o.z + t * d.z;
    if (y < s.y0 - SLAB_STEP || y > s.y1 + SLAB_STEP) {
      // left through the bottom or the top
      if ((d.y < 0 && y < s.y0) || (d.y > 0 && y > s.y1)) {
        return null;
      }
      continue;
    }
    if (!insideRingXz(s.ring, x, z)) {
      continue;
    }
    const top = s.topAt(x, z);
    if (y <= top + s.above && y >= top - s.below) {
      return t;
    }
  }
  return null;
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
      "cylinder" in s
        ? rayCylinder(o, d, s.cylinder)
        : "prism" in s
          ? rayPrism(o, d, s.prism)
          : raySlab(o, d, s.slab);
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
): AskHit<T> | null {
  let best: AskHit<T> | null = null;
  for (const item of items) {
    const t = raySolids(o, d, item.solids);
    if (t !== null && t <= far && (best === null || t < best.distance)) {
      best = { ...item, distance: t };
    }
  }
  return best;
}

/** An axis-aligned box (world). */
export interface Aabb {
  max: Xyz;
  min: Xyz;
}

/**
 * Askable things in one box: the probe opens the box only when the ray
 * passes through it, then asks the set for its nearest hit.
 */
export interface AskSet<T> {
  box: Aabb;
  nearest: (o: Xyz, d: Xyz, far: number) => AskHit<T> | null;
}

/** The box a solid fills. */
function solidBox(s: AskSolid): Aabb {
  if ("cylinder" in s) {
    const c = s.cylinder;
    return {
      min: { x: c.x - c.r, y: c.y0, z: c.z - c.r },
      max: { x: c.x + c.r, y: c.y1, z: c.z + c.r },
    };
  }
  const p = "prism" in s ? s.prism : s.slab;
  const xs = p.ring.map(([x]) => x);
  const zs = p.ring.map(([, z]) => z);
  return {
    min: { x: Math.min(...xs), y: p.y0, z: Math.min(...zs) },
    max: { x: Math.max(...xs), y: p.y1, z: Math.max(...zs) },
  };
}

function grow(a: Aabb, b: Aabb): Aabb {
  return {
    min: {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    max: {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  };
}

/** Items grouped by the `cell` (m) their first solid stands in. */
export function askSets<T>(
  items: readonly AskItem<T>[],
  cell = 64
): AskSet<T>[] {
  const cells = new Map<string, { box: Aabb; items: AskItem<T>[] }>();
  for (const item of items) {
    const box = item.solids.map(solidBox).reduce(grow);
    const key = `${Math.floor(box.min.x / cell)},${Math.floor(box.min.z / cell)}`;
    const group = cells.get(key);
    if (group) {
      group.items.push(item);
      group.box = grow(group.box, box);
    } else {
      cells.set(key, { box, items: [item] });
    }
  }
  return [...cells.values()].map((g) => ({
    box: g.box,
    nearest: (o, d, far) => nearestItem(o, d, g.items, far),
  }));
}

/** The box around cylinders (x, z, y0, y1, r) — a packed set's box. */
export function cylindersBox(
  x: number,
  z: number,
  y0: number,
  y1: number,
  r: number,
  box?: Aabb
): Aabb {
  const own = {
    min: { x: x - r, y: y0, z: z - r },
    max: { x: x + r, y: y1, z: z + r },
  };
  return box ? grow(box, own) : own;
}

/** Where the ray (unit `d`) enters the box, or null if it misses it. */
export function rayAabb(o: Xyz, d: Xyz, b: Aabb): number | null {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(d[axis]) < EPS) {
      if (o[axis] < b.min[axis] || o[axis] > b.max[axis]) {
        return null;
      }
      continue;
    }
    const t0 = (b.min[axis] - o[axis]) / d[axis];
    const t1 = (b.max[axis] - o[axis]) / d[axis];
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
    if (near > far) {
      return null;
    }
  }
  return near;
}

/** The nearest item in the sets the ray meets within `far`. */
export function nearestInSets<T>(
  o: Xyz,
  d: Xyz,
  sets: Iterable<AskSet<T>>,
  far: number
): AskHit<T> | null {
  // the reach shrinks to the nearest hit so far
  const found: { hit: AskHit<T> | null; reach: number } = {
    hit: null,
    reach: far,
  };
  for (const set of sets) {
    const enter = rayAabb(o, d, set.box);
    if (enter !== null && enter <= found.reach) {
      const hit = set.nearest(o, d, found.reach);
      if (hit !== null) {
        found.hit = hit;
        found.reach = hit.distance;
      }
    }
  }
  return found.hit;
}

/** How far (x, z) lies from the ring's edge in plan; 0 inside it. */
export function ringDistanceXz(
  ring: readonly (readonly [number, number])[],
  x: number,
  z: number
): number {
  if (insideRingXz(ring, x, z)) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j];
    const ex = ring[i][0] - ax;
    const ez = ring[i][1] - az;
    const len2 = ex * ex + ez * ez || 1;
    const t = Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / len2, 0), 1);
    best = Math.min(best, Math.hypot(x - (ax + t * ex), z - (az + t * ez)));
  }
  return best;
}
