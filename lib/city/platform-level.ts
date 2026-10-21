/**
 * How high a station platform stands (app/_components/rail-layer.ts draws
 * it): on the level of the track beside it — the ground, a rail deck, a
 * viaduct's span (lib/city/levels.ts) — its edge the platform's height
 * over that track's rail head (pipeline/bake/rail.py `h`: OSM's `height`,
 * else by the trains it serves: 0.76 m a main line's, 0.96 m an S-Bahn's,
 * ~1 m a U-Bahn's, 0.25 m a tram stop's). Drawn 0.55 m over the DGM, the
 * platforms stood too low where the DGM holds part of them already
 * (Meißen's by 0.73 m) and on the street under a viaduct (Hamburg's U3).
 * Never below the ground the DGM shows inside its outline. DOM-free,
 * THREE-free, pure.
 */

type XZ = { x: number; z: number };

/** One sample of a drawn track: where it is (world x, z), the level it
 *  runs on (y, under the rail head) and whether that is a deck or a span
 *  (a platform beside it stands on the structure, not the ground). */
export interface TrackSample {
  raised: boolean;
  x: number;
  y: number;
  z: number;
}

/** A platform's edge is beside a track this close (m): a platform's edge
 *  1.7 m from the track's centre, a wide island's far side 10 m. */
export const PLATFORM_REACH_M = 12;
/** The platform's height above the rail top where the bake gave none (m). */
export const PLATFORM_DEFAULT_H = 0.76;
/** A tram stop's rail top over the street (m), when no rail track is near:
 *  the tram layer's grooved rail (lib/city/tram.ts `RAIL_TOP_M.street`). */
export const TRAM_RAIL_TOP_M = 0.02;
/** The fascia reaches this far under the lowest ground or structure (m). */
const PLATFORM_SINK_M = 0.1;
/** The spatial index's cell (m). */
const CELL_M = 8;

/** The drawn tracks' samples by grid cell. */
export class TrackIndex {
  private cells = new Map<string, TrackSample[]>();
  constructor(samples: Iterable<TrackSample>) {
    for (const s of samples) {
      const k = this.key(s.x, s.z);
      const cell = this.cells.get(k);
      if (cell) {
        cell.push(s);
      } else {
        this.cells.set(k, [s]);
      }
    }
  }
  private key(x: number, z: number): string {
    return `${Math.floor(x / CELL_M)}:${Math.floor(z / CELL_M)}`;
  }
  /** The sample nearest (x, z) within `reach` (≤ 2 cells), or null. */
  nearest(x: number, z: number, reach = PLATFORM_REACH_M): TrackSample | null {
    const r = Math.ceil(reach / CELL_M);
    const cx = Math.floor(x / CELL_M);
    const cz = Math.floor(z / CELL_M);
    let best: TrackSample | null = null;
    let bd = reach * reach;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (const s of this.cells.get(`${cx + dx}:${cz + dz}`) ?? []) {
          const d = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (d <= bd) {
            bd = d;
            best = s;
          }
        }
      }
    }
    return best;
  }
}

/** What a platform is stood on. */
export interface PlatformInput {
  /** the ground at each outline vertex (null where unknown) */
  ground: readonly (number | null)[];
  /** height above the rail top (m) and the trains it serves */
  h?: number;
  /** the ground the DGM shows inside the outline (a few samples) */
  inside: readonly number[];
  kind?: string;
  ring: readonly XZ[];
}

/** The median of some numbers (null for none). */
function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * A platform's top at each outline vertex and the depth of its fascia:
 * each vertex over the level of the track nearest it (`index`) by the
 * rail head (`railHead`) and the platform's height, a vertex no track is
 * near over the median of those that have one; with no track near at
 * all (a tram stop, a platform past the tile's tracks) over the lowest
 * ground along the outline — the street or track bed at its edge — by a
 * tram's rail top or `railHead`. Never below the median ground inside the
 * outline. The fascia reaches PLATFORM_SINK_M under the lowest ground at
 * the outline (on a deck or a span: under the structure's level). Null
 * without any ground.
 */
export function platformTops(
  p: PlatformInput,
  index: TrackIndex,
  railHead: number
): { depth: number; top: number[] } | null {
  const h = p.h ?? PLATFORM_DEFAULT_H;
  const near = p.ring.map((v) => index.nearest(v.x, v.z));
  const found = near.filter((s): s is TrackSample => s !== null);
  const grounds = p.ground.filter((g): g is number => g !== null);
  const floor = median(p.inside) ?? median(grounds);
  if (floor === null) {
    return null;
  }
  const raised = found.length > 0 && found.every((s) => s.raised);
  let top: number[];
  let base: number;
  if (found.length > 0) {
    const mid = median(found.map((s) => s.y)) ?? floor;
    top = near.map((s) => (s ? s.y : mid) + railHead + h);
    base = raised
      ? Math.min(...found.map((s) => s.y))
      : Math.min(...grounds, ...found.map((s) => s.y));
  } else {
    const low = grounds.length > 0 ? Math.min(...grounds) : floor;
    const rail = p.kind === "tram" ? TRAM_RAIL_TOP_M : railHead;
    top = p.ring.map(() => low + rail + h);
    base = low;
  }
  // never under the ground inside its outline (unless it is on a deck,
  // whose ground is the street below)
  if (!raised) {
    top = top.map((y) => Math.max(y, floor));
  }
  return { depth: Math.max(...top) - base + PLATFORM_SINK_M, top };
}
