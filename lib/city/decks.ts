/**
 * The bridge decks as a lift table: which deck tops lie under a point
 * (`decksAt`), from the baked decks (pipeline/bake/rail.py, ADR 0013/0033).
 * DOM-free, THREE-free, pure — shared by the rail and tram layers (which add
 * the approach ramps, app/_components/rail-layer.ts `buildDeckTable`) and
 * the build step's line levels (scripts/line-levels.ts).
 *
 * Coordinates are the Y-up world frame's (x, z) (lib/city/ground-clamp.ts).
 */
import type { BridgeFeature } from "./features";
import { epsgToWorld } from "./ground-clamp";

export interface Ring2 {
  cx: number;
  cz: number;
  pts: { x: number; z: number }[];
}

/** EPSG ring → world (x,z) ring (open: closing duplicate dropped) + centroid. */
export function ringToWorld(
  coords: [number, number][],
  offset: { cx: number; cy: number }
): Ring2 {
  const open =
    coords.length > 1 &&
    coords[0][0] === coords.at(-1)?.[0] &&
    coords[0][1] === coords.at(-1)?.[1]
      ? coords.slice(0, -1)
      : coords;
  const pts = open.map(([ex, ey]) => {
    const w = epsgToWorld(ex, ey, offset);
    return { x: w.x, z: w.z };
  });
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  const n = Math.max(pts.length, 1);
  return { pts, cx: cx / n, cz: cz / n };
}

/**
 * A bridge deck for lifting what rides on it: the heavy rails onto rail
 * decks, the trams (tram-layer.ts) onto any deck their OSM way says is a
 * bridge. `profile` is the deck height along the deck's long axis (the bake
 * ramps it between the abutments, rail.py `deck_profile`), so a point is
 * lifted onto the deck's height there, not onto its mean.
 */
export interface DeckPoly {
  /** long-axis origin and direction (unnormalised) */
  a: { x: number; z: number };
  ax: number;
  az: number;
  kind: string;
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
  /** (t along the long axis, deck top) per ring vertex, sorted by t */
  profile: { t: number; y: number }[];
  /** an approach ramp from a deck end down to the ground, not a deck */
  ramp?: boolean;
  ring: { x: number; z: number }[];
}

export function pointInRing(
  ring: { x: number; z: number }[],
  x: number,
  z: number
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** The deck top along its long axis at axis position t (0..1), linear
 *  between the ring vertices' own heights. */
function profileAt(profile: { t: number; y: number }[], t: number): number {
  const first = profile[0];
  const last = profile.at(-1) ?? first;
  if (t <= first.t) {
    return first.y;
  }
  if (t >= last.t) {
    return last.y;
  }
  for (let i = 1; i < profile.length; i++) {
    const b = profile[i];
    if (t <= b.t) {
      const a = profile[i - 1];
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      return a.y + (b.y - a.y) * f;
    }
  }
  return last.y;
}

/**
 * The deck tops under a point — every deck of `kinds` (all when absent)
 * whose outline holds it or passes within `margin`, of the decks, the
 * ramps or both — for the line levels (lib/city/levels.ts) to choose from.
 */
export function decksAt(
  decks: DeckPoly[],
  x: number,
  z: number,
  kinds?: readonly string[],
  which: "all" | "decks" | "ramps" = "all",
  margin = 0
): number[] {
  const out: number[] = [];
  for (const d of decks) {
    if (
      x < d.minX - margin ||
      x > d.maxX + margin ||
      z < d.minZ - margin ||
      z > d.maxZ + margin
    ) {
      continue;
    }
    if (kinds && !kinds.includes(d.kind)) {
      continue;
    }
    if (which !== "all" && (d.ramp === true) !== (which === "ramps")) {
      continue;
    }
    if (
      pointInRing(d.ring, x, z) ||
      (margin > 0 && ringDistance(d.ring, x, z) <= margin)
    ) {
      const l2 = d.ax * d.ax + d.az * d.az;
      const t = l2 > 0 ? ((x - d.a.x) * d.ax + (z - d.a.z) * d.az) / l2 : 0;
      out.push(profileAt(d.profile, t));
    }
  }
  return out;
}

/** The distance from (x, z) to a ring's nearest edge. */
function ringDistance(
  ring: readonly { x: number; z: number }[],
  x: number,
  z: number
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    const t =
      l2 > 0
        ? Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / l2))
        : 0;
    best = Math.min(best, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return best;
}

/**
 * The deck Y to lift a point onto, or null off every deck: the first of
 * `decksAt`. `kinds` limits the decks considered.
 */
export function deckLift(
  decks: DeckPoly[],
  x: number,
  z: number,
  kinds?: readonly string[],
  which: "all" | "decks" | "ramps" = "all"
): number | null {
  return decksAt(decks, x, z, kinds, which)[0] ?? null;
}

/** One deck's lift entry from its world ring and per-vertex deck tops. */
export function deckPoly(
  pts: { x: number; z: number }[],
  topY: number[],
  kind: string
): DeckPoly {
  const { a, b } = longAxis(pts);
  const ax = b.x - a.x;
  const az = b.z - a.z;
  const l2 = ax * ax + az * az;
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const profile = pts.map((p, i) => {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
    const t = l2 > 0 ? ((p.x - a.x) * ax + (p.z - a.z) * az) / l2 : 0;
    return { t, y: topY[i] };
  });
  profile.sort((p, q) => p.t - q.t);
  return { a, ax, az, kind, minX, minZ, maxX, maxZ, profile, ring: pts };
}

/** The two farthest-apart ring vertices (the deck's abutment ends) + their span. */
export function longAxis(pts: { x: number; z: number }[]): {
  a: { x: number; z: number };
  b: { x: number; z: number };
  span: number;
} {
  let ai = 0;
  let bi = 1;
  let bd = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].z - pts[j].z) ** 2;
      if (d > bd) {
        bd = d;
        ai = i;
        bi = j;
      }
    }
  }
  return {
    a: pts[ai],
    b: pts[bi],
    span: Math.hypot(pts[bi].x - pts[ai].x, pts[bi].z - pts[ai].z),
  };
}

/** A bridge feature's deck: its world ring and per-vertex tops, or null
 *  when it has none (no polygon, or fewer tops than vertices). */
export function deckRing(
  f: BridgeFeature,
  offset: { cx: number; cy: number }
): { ring: Ring2; topY: number[] } | null {
  if (f.geometry?.type !== "Polygon" || !f.geometry.coordinates[0]) {
    return null;
  }
  const ring = ringToWorld(f.geometry.coordinates[0], offset);
  const deck = f.properties?.deck ?? [];
  if (ring.pts.length < 3 || deck.length < ring.pts.length) {
    return null;
  }
  return { ring, topY: deck.slice(0, ring.pts.length) };
}

/** The lift entries of the baked decks themselves (no approach ramps). */
export function bridgeDecks(
  features: readonly BridgeFeature[],
  offset: { cx: number; cy: number }
): DeckPoly[] {
  return features.flatMap((f) => {
    const d = deckRing(f, offset);
    return d
      ? [deckPoly(d.ring.pts, d.topY, f.properties?.kind ?? "other")]
      : [];
  });
}
