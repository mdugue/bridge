/**
 * The site's walkable ground, one owner for every caller that asks where
 * the ground is — the pose, the double-tap target, the focus, the shadow
 * frustum: the visible terrains' heights (fine level first), the lowest
 * terrain seen so far as the floor off every tile, and rays against both.
 * No THREE, no DOM.
 */
import { type RecenterOffset, worldToEpsg } from "./ground-clamp";
import { groundRayDistance } from "./ground-ray";
import type { Xyz } from "./pose";

/** Anything with a height function: a loaded terrain. */
export interface HeightSource {
  heightAt: (x: number, y: number) => number | null;
}

export interface Ground {
  /** the terrains to read, in order (the first that covers a point wins) */
  setSources: (sources: readonly HeightSource[]) => void;
  /** records a terrain's lowest elevation; true when the floor went down */
  lowerFloor: (minElevation: number) => boolean;
  /** the lowest terrain elevation so far, or null before any */
  floor: () => number | null;
  /** projected (x, y) → elevation, null off every source */
  heightAt: (x: number, y: number) => number | null;
  /** `heightAt` over the sources as they are now, whatever comes later:
   *  one ground for a build that runs in slices (build-steps.ts) */
  pinned: () => (x: number, y: number) => number | null;
  /** a ceiling on the walked ground (projected x, y → elevation, null:
   *  none there): a loaded design's site pressed under its floor, as the
   *  terrain is drawn (design-site.ts) — for the world-side reads; the
   *  projected `heightAt` stays the terrain's own. `null` lifts it. */
  setCap: (cap: ((x: number, y: number) => number | null) | null) => void;
  /** world (x, z) → elevation, null off every source */
  atWorld: (x: number, z: number) => number | null;
  /** world (x, z) → elevation, falling back to the floor (then 0) */
  underWorld: (x: number, z: number) => number;
  /** distance along a world ray to the ground, or null within `far` */
  along: (origin: Xyz, direction: Xyz, far: number) => number | null;
}

export function createGround(offset: RecenterOffset): Ground {
  let sources: readonly HeightSource[] = [];
  let floor = Number.POSITIVE_INFINITY;
  const over =
    (from: () => readonly HeightSource[]) =>
    (x: number, y: number): number | null => {
      for (const s of from()) {
        const h = s.heightAt(x, y);
        if (h !== null) {
          return h;
        }
      }
      return null;
    };
  const heightAt = over(() => sources);
  let cap: ((x: number, y: number) => number | null) | null = null;
  const atWorld = (x: number, z: number): number | null => {
    const e = worldToEpsg(x, z, offset);
    const h = heightAt(e.x, e.y);
    const ceiling = h === null || !cap ? null : cap(e.x, e.y);
    return ceiling === null || h === null ? h : Math.min(h, ceiling);
  };
  return {
    setSources: (next) => {
      sources = next;
    },
    setCap: (next) => {
      cap = next;
    },
    lowerFloor: (minElevation) => {
      if (minElevation < floor) {
        floor = minElevation;
        return true;
      }
      return false;
    },
    floor: () => (Number.isFinite(floor) ? floor : null),
    heightAt,
    pinned: () => {
      const now = sources;
      return over(() => now);
    },
    atWorld,
    underWorld: (x, z) => atWorld(x, z) ?? (Number.isFinite(floor) ? floor : 0),
    along: (origin, direction, far) =>
      groundRayDistance(origin, direction, atWorld, { far }),
  };
}
