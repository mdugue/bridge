/**
 * The beds the lines are laid on, shaped into the ground — the terrain
 * bake's half of a line's profile (lib/city/line-profile.ts). DOM-free,
 * THREE-free, pure.
 *
 * A track on the ground lies on its profile; the measured ground under it
 * does not (the DGM rounds a platform's edge, a kerb or an abutment into a
 * ramp, and a TIN of 0.15 m error lies above a straight track between its
 * samples). So the ground is made to fit the line, as the line's builders
 * did: under the bed (the ballast's width, a tram's track) it is the
 * *Planum*, laid `drop` under the profile; beside it, the ground the bed
 * leaves above or below is graded at the slope an earthwork stands at
 * (`BED_SLOPE`, 1 : 1.5 — the embankment's and the cutting's), for at most
 * `BED_SIDE_M`; further out it stays as measured (a wall, a quay). Where
 * two beds meet, the nearest wins under a bed and every bed's slope bounds
 * the ground beside them. The ground under a deck is only ever lowered,
 * never filled: a bridge's road passes under it (a Land's DGM that keeps
 * its bridges, Hamburg's, holds the deck there — the bed cuts it away).
 *
 * The terrain bake (scripts/bake-tiles.ts `shapeDgm`) burns them into the
 * DGM and refines the TIN closer under them (`BED_TIN_ERROR`); the rail
 * layer lays its ballast on the same beds (`BedIndex`), so the ballast,
 * the sleepers and the rails stand on one surface the ground lies under.
 */
import type { RailFeature, TramBed } from "./features";
import type { Point2 } from "./polyline";

/** One bed: a line's samples on the ground (EPSG), its profile there. */
export interface Bed {
  coords: Point2[];
  /** the profile at each point (m): the bed's surface */
  z: number[];
  /** half the bed's width (m) */
  half: number;
  /** how far under the profile the ground is laid (m) */
  drop: number;
  /** the line rides a deck or spans a gap here: the ground under it is
   *  only lowered to the bed (where a DGM keeps a bridge, it held the
   *  deck over the rails), never raised to it */
  lowerOnly?: boolean;
  /** the line runs in a cut here: the ground is lowered only where it
   *  lies at most this far (m) over the profile — a trench; deeper the
   *  cut runs under a lid (a tunnel, a station's cover) and the ground
   *  stays. Implies `lowerOnly`. */
  shallow?: number;
}

/** A cut this far under the ground (m) is buried: the line runs under a
 *  lid (lib/city/levels.ts `coverCuts`), the rail layer does not draw it
 *  and its bed opens no trench (`Bed.shallow`). */
export const BURIED_M = 0.5;

/** How wide a bed is and how far under the profile its ground lies. */
export type BedShape = Pick<Bed, "half" | "drop">;

/** Half a one-track ballast bed (m): pipeline/bake/rail_osm.py BED_ONE. */
export const RAIL_BED_HALF_M = 2.25;
/** Spacing between parallel track centres (m): rail_osm.py BED_MORE. */
export const TRACK_PITCH_M = 4;
/** A ballast bed's ground under its profile (m): the ballast mesh, the
 *  sleepers and the rails stand on the profile, the ground well under
 *  them whatever the TIN's error. */
const BALLAST_DROP_M = 0.1;
/** A track set in the paving: its rails and a margin either side (m)… */
const PAVED_HALF_M = 1.2;
/** …and the road under its profile (m): the groove its rail heads stand
 *  2 cm out of, deeper than the TIN's error under a bed, too shallow to
 *  see. */
const PAVED_DROP_M = 0.03;

/** The bed a railway line lies on: its ballast (`tracks` wide), or the
 *  paving it is set in. */
export function railBed(f: RailFeature): BedShape {
  const p = f.properties ?? {};
  if (p.paved === 1) {
    return { half: PAVED_HALF_M, drop: PAVED_DROP_M };
  }
  const tracks = Math.min(Math.max(p.tracks ?? 1, 1), 3);
  return {
    half: RAIL_BED_HALF_M + ((tracks - 1) * TRACK_PITCH_M) / 2,
    drop: BALLAST_DROP_M,
  };
}

/** The bed a tram track lies on: the road, its lawn or its ballast
 *  (app/_components/tram-layer.ts BED_HALF). */
export function tramBed(bed: TramBed): BedShape {
  switch (bed) {
    case "grass":
      return { half: 1.3, drop: BALLAST_DROP_M };
    case "ballast":
      return { half: 1.4, drop: BALLAST_DROP_M };
    case "street":
      return { half: PAVED_HALF_M, drop: PAVED_DROP_M };
  }
}

/** The slope beside a bed (rise over run): 1 : 1.5. */
export const BED_SLOPE = 1 / 1.5;
/** How far beside a bed the ground is graded at most (m). */
export const BED_SIDE_M = 4;
/** The TIN's error under a bed (m), against the fine level's 0.15 m
 *  elsewhere: a street's grooved rail stands 2 cm out of the road. */
export const BED_TIN_ERROR = 0.03;

/** Where a bed applies: what a cell needs to know of the nearest bed. */
interface Hit {
  d: number;
  level: number;
}

/** Two beds under one cell this far apart in level (m) cross at two
 *  storeys: the lower one's is the ground. */
const CROSSING_M = 1;

/** The nearest point of a bed's centreline to (x, y), between its ends
 *  (flat ends: a bed reaches no point beyond them), and the level there. */
function nearestOn(bed: Bed, x: number, y: number): Hit | null {
  let best: Hit | null = null;
  const last = bed.coords.length - 2;
  for (let i = 0; i <= last; i++) {
    const hit = onSegment(bed, i, x, y);
    if (hit && (!best || hit.d < best.d)) {
      best = hit;
    }
  }
  return best;
}

function onSegment(bed: Bed, i: number, x: number, y: number): Hit | null {
  const [ax, ay] = bed.coords[i];
  const [bx, by] = bed.coords[i + 1];
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  const along = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
  const last = bed.coords.length - 2;
  if ((i === 0 && along < 0) || (i === last && along > 1)) {
    return null;
  }
  const t = Math.min(1, Math.max(0, along));
  return {
    d: Math.hypot(ax + ex * t - x, ay + ey * t - y),
    level: bed.z[i] + (bed.z[i + 1] - bed.z[i]) * t - bed.drop,
  };
}

/**
 * The grid (row 0 = north, cell centres) with every bed burned in: under
 * a bed (within `half`) the nearest bed's level; beside one (within
 * `BED_SIDE_M` more) the ground clamped into every bed's slope there — or,
 * where two slopes ask for opposite things, the nearest one's. A cell
 * `under` a deck is only lowered. `mask` (n·n), when given, is set to 1
 * under a bed.
 */
export function burnBeds(input: {
  bounds: readonly [number, number, number, number];
  elevations: Float32Array;
  n: number;
  beds: readonly Bed[];
  under?: (x: number, y: number) => boolean;
  mask?: Uint8Array;
}): Float32Array {
  const { elevations, n, bounds, beds, under, mask } = input;
  const out = Float32Array.from(elevations);
  if (beds.length === 0) {
    return out;
  }
  const asks = new CellAsks(n * n);
  const [minX, minY, maxX, maxY] = bounds;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  for (const bed of beds) {
    const reach = bed.half + BED_SIDE_M;
    for (let i = 0; i + 1 < bed.coords.length; i++) {
      const [c0, c1, r0, r1] = segmentCells(bed, i, reach, input);
      for (let row = r0; row <= r1; row++) {
        const y = maxY - (row + 0.5) * dy;
        for (let col = c0; col <= c1; col++) {
          const hit = onSegment(bed, i, minX + (col + 0.5) * dx, y);
          const idx = row * n + col;
          if (hit && hit.d <= reach && opens(bed, hit, elevations[idx])) {
            asks.add(idx, bed, hit);
          }
        }
      }
    }
  }
  for (const idx of asks.touched) {
    const ground = out[idx];
    if (!Number.isFinite(ground)) {
      continue;
    }
    let level = asks.level(idx, ground);
    if (under && level > ground) {
      // under a deck the ground is only ever lowered: a road under the
      // bridge is never filled
      const row = Math.floor(idx / n);
      const col = idx - row * n;
      if (under(minX + (col + 0.5) * dx, maxY - (row + 0.5) * dy)) {
        continue;
      }
    }
    // a line on a deck or over a gap: the ground under it never above
    // its bed
    level = Math.min(level, asks.lowers[idx]);
    out[idx] = level;
    if (mask && (asks.lays(idx) || level < ground)) {
      mask[idx] = 1;
    }
  }
  return out;
}

/** The grid cells (first and last column and row) a bed's segment `i`
 *  reaches within `reach`. */
function segmentCells(
  bed: Bed,
  i: number,
  reach: number,
  grid: { bounds: readonly [number, number, number, number]; n: number }
): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = grid.bounds;
  const { n } = grid;
  const dx = (maxX - minX) / n;
  const dy = (maxY - minY) / n;
  const [ax, ay] = bed.coords[i];
  const [bx, by] = bed.coords[i + 1];
  return [
    Math.max(0, Math.floor((Math.min(ax, bx) - reach - minX) / dx)),
    Math.min(n - 1, Math.ceil((Math.max(ax, bx) + reach - minX) / dx)),
    Math.max(0, Math.floor((maxY - Math.max(ay, by) - reach) / dy)),
    Math.min(n - 1, Math.ceil((maxY - Math.min(ay, by) + reach) / dy)),
  ];
}

/** Whether a bed reaches a cell whose ground is `ground`: a cut's only
 *  where the ground lies at most `shallow` over its profile. */
function opens(bed: Bed, hit: Hit, ground: number): boolean {
  return (
    bed.shallow === undefined || ground - (hit.level + bed.drop) <= bed.shallow
  );
}

/** What the beds ask of each cell they reach (`burnBeds`). */
class CellAsks {
  readonly touched: number[] = [];
  private readonly seen: Uint8Array;
  // under a bed that lays the ground: the nearest one's distance and level,
  // and the lowest
  private readonly inD: Float32Array;
  private readonly inLevel: Float32Array;
  private readonly inLowest: Float32Array;
  /** under a bed that only lowers it: the lowest */
  readonly lowers: Float32Array;
  // beside: the slopes' lower and upper bounds, and the nearest slope's
  private readonly lo: Float32Array;
  private readonly hi: Float32Array;
  private readonly sideD: Float32Array;
  private readonly sideLevel: Float32Array;
  private readonly sideS: Float32Array;

  constructor(cells: number) {
    const inf = Number.POSITIVE_INFINITY;
    this.seen = new Uint8Array(cells);
    this.inD = new Float32Array(cells).fill(inf);
    this.inLevel = new Float32Array(cells);
    this.inLowest = new Float32Array(cells).fill(inf);
    this.lowers = new Float32Array(cells).fill(inf);
    this.lo = new Float32Array(cells).fill(-inf);
    this.hi = new Float32Array(cells).fill(inf);
    this.sideD = new Float32Array(cells).fill(inf);
    this.sideLevel = new Float32Array(cells);
    this.sideS = new Float32Array(cells);
  }

  /** A bed's ask of cell `idx`, `hit` from its centreline. */
  add(idx: number, bed: Bed, hit: Hit): void {
    if (!this.seen[idx]) {
      this.seen[idx] = 1;
      this.touched.push(idx);
    }
    const lowerOnly = bed.lowerOnly === true || bed.shallow !== undefined;
    if (hit.d <= bed.half) {
      if (lowerOnly) {
        this.lowers[idx] = Math.min(this.lowers[idx], hit.level);
        return;
      }
      this.inLowest[idx] = Math.min(this.inLowest[idx], hit.level);
      if (hit.d < this.inD[idx]) {
        this.inD[idx] = hit.d;
        this.inLevel[idx] = hit.level;
      }
      return;
    }
    const s = (hit.d - bed.half) * BED_SLOPE;
    this.hi[idx] = Math.min(this.hi[idx], hit.level + s);
    if (lowerOnly) {
      return;
    }
    this.lo[idx] = Math.max(this.lo[idx], hit.level - s);
    if (hit.d < this.sideD[idx]) {
      this.sideD[idx] = hit.d;
      this.sideLevel[idx] = hit.level;
      this.sideS[idx] = s;
    }
  }

  /** Whether a bed that lays the ground covers cell `idx`. */
  lays(idx: number): boolean {
    return Number.isFinite(this.inD[idx]);
  }

  /** The level the asks give cell `idx`, its ground `ground` (before the
   *  lowering beds' cap). */
  level(idx: number, ground: number): number {
    if (this.lays(idx)) {
      // where two beds cross a storey apart the lower line passes under
      // the upper one's structure: its bed is the ground
      const lowest = this.inLowest[idx];
      return this.inLevel[idx] - lowest > CROSSING_M
        ? lowest
        : this.inLevel[idx];
    }
    if (Number.isFinite(this.lowers[idx])) {
      return ground;
    }
    if (this.lo[idx] <= this.hi[idx]) {
      return Math.min(this.hi[idx], Math.max(this.lo[idx], ground));
    }
    // two slopes that disagree: the nearest bed's
    const l = this.sideLevel[idx];
    const s = this.sideS[idx];
    return Math.min(l + s, Math.max(l - s, ground));
  }
}

/** The beds' grid cell (m) for point queries. */
const CELL_M = 8;

/**
 * The beds for point queries: the level of the bed nearest (x, y) within
 * `reach` of its centreline — the surface the rail layer lays its ballast
 * on (the profile, not the ground the bake laid `drop` under it).
 */
export class BedIndex {
  private cells = new Map<string, { bed: Bed; i: number }[]>();
  constructor(
    private readonly beds: readonly Bed[],
    private readonly reach: number
  ) {
    for (const bed of beds) {
      for (let i = 0; i + 1 < bed.coords.length; i++) {
        const [ax, ay] = bed.coords[i];
        const [bx, by] = bed.coords[i + 1];
        const c0 = Math.floor((Math.min(ax, bx) - reach) / CELL_M);
        const c1 = Math.floor((Math.max(ax, bx) + reach) / CELL_M);
        const r0 = Math.floor((Math.min(ay, by) - reach) / CELL_M);
        const r1 = Math.floor((Math.max(ay, by) + reach) / CELL_M);
        for (let c = c0; c <= c1; c++) {
          for (let r = r0; r <= r1; r++) {
            const k = `${c}:${r}`;
            let list = this.cells.get(k);
            if (!list) {
              list = [];
              this.cells.set(k, list);
            }
            list.push({ bed, i });
          }
        }
      }
    }
  }
  /** The surface of the nearest bed within reach, or null. */
  levelAt(x: number, y: number): number | null {
    let best: Hit | null = null;
    let drop = 0;
    const list = this.cells.get(
      `${Math.floor(x / CELL_M)}:${Math.floor(y / CELL_M)}`
    );
    for (const { bed, i } of list ?? []) {
      const hit = onSegment(bed, i, x, y);
      if (hit && hit.d <= this.reach && (!best || hit.d < best.d)) {
        best = hit;
        drop = bed.drop;
      }
    }
    return best ? best.level + drop : null;
  }
  get size(): number {
    return this.beds.length;
  }
}

/** The nearest bed's level under (x, y) and how far its centreline is, or
 *  null beyond every bed's ends (tests, checks). */
export function bedAt(beds: readonly Bed[], x: number, y: number): Hit | null {
  let best: Hit | null = null;
  for (const bed of beds) {
    const hit = nearestOn(bed, x, y);
    if (hit && (!best || hit.d < best.d)) {
      best = hit;
    }
  }
  return best;
}
