/**
 * Retaining / city walls from OSM (`pipeline/bake/walls.py`) as vertical
 * ribbons. DOM-free, THREE-free, pure — the terrain bake
 * (scripts/bake-tiles.ts `wallMesh`) writes them into the fine terrain glTF,
 * and `wall-layer.ts` only gives them their material.
 *
 * Monumental walls like the Brühlsche Terrasse are no vertical face in any
 * elevation product — the laser ground steps within ~0.75 m, the native DGM1
 * within ~1.7 m, and a 1024² resample smears that into a ~3 m bank — and a
 * wall is not a CityJSON building, so it "goes missing". OSM has it as tagged
 * lines with heights; this stands a ribbon on each, its base on the ground
 * read through `heightAt` — at build time over every tile's fine level, so a
 * wall near a seam reads its neighbour's ground — and its top on the high
 * shelf. On a grid that ground was conflated to step at the OSM line; on the
 * fine level's TIN nothing was burned in, so an earth-retaining wall snaps to
 * the step the terrain measures instead (`snapToStep`, lib/city/wall-snap.ts).
 * Each wall is toned by its material (`WALL_TONES`, the mesh's vertex
 * colours).
 */
import { epsgToWorld, type RecenterOffset } from "./ground-clamp";
import { type Point2, subdividePolyline } from "./polyline";
import {
  EDGE_TOLERANCE_M,
  farthestNear,
  type JoinPoint,
  joinsAlong,
  lowestGround,
  reachLevel,
  SINK,
} from "./ground-join";
import { type StepSnap, smoothSnaps, snapToStep } from "./wall-snap";

export interface WallRibbon {
  /** EPSG coordinates (NOT recentered) */
  coords: Point2[];
  /** tagged, measured or fallback height (m; pipeline/bake/walls.py) */
  h: number;
  /** the OSM kind (retaining_wall, city_wall, embankment, wall, …) */
  kind?: string;
  /** what it is made of (its tone, `WALL_TONES`); none: a cliff, an
   *  embankment */
  mat?: Masonry;
}

/** What a wall or a flight of steps is made of, as the bakes name it
 *  (pipeline/bake/walls.py `MATERIALS`, stairs.py `STAIR_MATERIALS`): an
 *  OSM tag, else the site's majority of its tagged ones. */
export const MASONRY = ["concrete", "brick", "stone", "metal", "wood"] as const;
export type Masonry = (typeof MASONRY)[number];

/** The bake's material name as a `Masonry`, or undefined for anything else
 *  (an old file, a typo). */
export function masonryOf(value: unknown): Masonry | undefined {
  return MASONRY.find((m) => m === value);
}

/**
 * A wall's tone (sRGB) by its material (PR #173, B6): every wall was one
 * warm sandstone, right for Dresden's terraces and Meißen's syenite rubble,
 * wrong for Hamburg's concrete flood walls and Leipzig's and München's
 * brick. Muted like the clay: concrete a pale grey a shade under the
 * built-up ground, brick the clay's dusty brick register (lib/city/
 * building-tint.ts), metal (sheet piling, steel noise barriers) a dark
 * grey, wood a weathered timber. A wall without a material (a cliff, an
 * embankment) keeps the sandstone.
 */
export const WALL_TONES: Readonly<Record<Masonry, number>> = {
  stone: 0xc9_bd_a4,
  concrete: 0xc6_c4_bd,
  brick: 0xb8_92_7e,
  metal: 0x8e_90_92,
  wood: 0xa8_90_74,
};

/** sRGB hex → linear RGB, as the mesh's COLOR_0 carries it. */
export function linearTone(hex: number): [number, number, number] {
  const lin = (c: number) =>
    c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return [16, 8, 0].map((shift) => lin(((hex >> shift) & 0xff) / 255)) as [
    number,
    number,
    number,
  ];
}

/** Linear RGB per vertex for a wall mesh's `tones` (its COLOR_0). */
export function wallColors(
  tones: readonly number[]
): Float32Array<ArrayBuffer> {
  const linear = MASONRY.map((m) => linearTone(WALL_TONES[m]));
  const out = new Float32Array(tones.length * 3);
  for (const [i, t] of tones.entries()) {
    out.set(linear[t] ?? linear[MASONRY.indexOf("stone")], i * 3);
  }
  return out;
}

export interface WallOptions {
  /**
   * TIN ground (the fine level): nothing was burned to the OSM line, so an
   * earth-retaining wall snaps to the step the terrain measures instead
   * (lib/city/wall-snap.ts) — face at the ramp's foot, a coping cap back to
   * its crest. Walls with no measurable step keep the OSM-line placement.
   */
  snapToStep?: boolean;
}

/** OSM kinds that hold back earth (the ones the conflation also reshapes). */
const RETAINING_KINDS = new Set(["retaining_wall", "city_wall", "embankment"]);

/** How far in front of the measured ramp foot the snapped face stands (m):
 *  the ramp's foot wanders between the 1 m grid points the TIN kept, and a
 *  straight face between two columns must stay in front of all of it. */
const FACE_MARGIN_M = 0.5;

const SAMPLE_M = 2.5; // densify polylines to this spacing (m)
const PERP_M = 9; // perpendicular probe distance to find the low/high side (m)
// The terrain is CONFLATED to step at the wall line (terrain-conflate.ts), so
// the wall no longer has to escape a smooth ramp — it just nudges a touch onto
// the low side to skin the step's face instead of z-fighting it.
const OFFSET_M = 1.5; // stand the wall this far onto the low side (m)
// Kerb-height walls (under 0.3 m: the kerb's business) are skipped; a low
// garden wall the surface model measured (walls.py, 0.3–0.8 m) stands. A
// column shorter than MIN_H top to foot (its 0.4 m foot under the ground,
// SINK.wall) is a kerb-height wall where its step left it.
const KERB_WALL_M = 0.3;
const MIN_H = 0.7;
const MAX_H = 14; // clamp tall tags (m)

/**
 * Kinds that stand on the ground, not only in front of a step, and how thick
 * they are (m; OSM rarely tags it — a garden or park wall is a brick or two
 * thick, a city wall a metre). Their tagged height is measured from their
 * foot, so they rise that far above the low side whatever the step: on
 * level ground the high-shelf rule buried them, top at the ground (in
 * Dresden 32 km of walls, four in five of which DOM1 shows standing a metre
 * and more). An earth-retaining wall still ends at its high shelf.
 */
const FREESTANDING_M: Readonly<Record<string, number>> = {
  wall: 0.4,
  city_wall: 1,
};

/** How far above its measured step (m, the median over the wall) a wall
 *  of a freestanding kind that also holds earth (a city wall) must rise by
 *  its tag to stand free rather than end at its shelf. */
const STANDS_ABOVE_M = 0.5;

/** Whether the wall's tagged height `h` takes it STANDS_ABOVE_M over the
 *  high shelves of the steps it was snapped to (no step: it stands). */
function standsAboveStep(
  steps: readonly (StepSnap | null)[],
  h: number
): boolean {
  const over = steps
    .filter((s): s is StepSnap => s !== null)
    .map((s) => s.lo + h - s.hi)
    .sort((a, b) => a - b);
  return (
    over.length === 0 || over[Math.floor(over.length / 2)] > STANDS_ABOVE_M
  );
}

/** The step across the line (m) from which a freestanding wall stands the
 *  full OFFSET_M onto its low side, like a retaining one; on level ground it
 *  stands on its OSM line, and between the two in proportion. */
const STEP_FULL_M = 1;

/** A densified wall vertex with its world XZ and the base/top elevations;
 *  a snapped column also carries where its coping cap ends (`bx`, `bz`). */
interface WallCol {
  /** the EPSG point the cap's back edge ends at (a snapped column) */
  back?: Point2;
  /** where the ground behind the cap lies below it: the foot of the back
   *  face the cap drops to there */
  backFoot?: number;
  base: number;
  /** the EPSG point the face stands at */
  face: Point2;
  bx?: number;
  bz?: number;
  /** a snapped column's run (`stepRuns`): the ribbon breaks between two */
  run?: number;
  top: number;
  wx: number;
  wz: number;
}

type HeightAt = (x: number, y: number) => number | null;

/** Base/top elevation for one wall vertex: top = the high side (for a
 *  freestanding kind at least its tagged height above the low side), base
 *  dropped to the low side or the tagged height, whichever is lower
 *  (clamped). A freestanding wall has a body: a cap back over its thickness,
 *  toward the high side, where `grounded` drops its back face. */
function columnAt(
  e: Point2,
  p: Point2,
  h: number,
  heightAt: HeightAt,
  offset: RecenterOffset,
  kind: string | undefined
): WallCol | null {
  const [ex, ey] = e;
  const [px, py] = p;
  const g = heightAt(ex, ey);
  if (g === null) {
    return null; // off the site / NoData — break the ribbon here
  }
  const gP = heightAt(ex + px * PERP_M, ey + py * PERP_M) ?? g;
  const gN = heightAt(ex - px * PERP_M, ey - py * PERP_M) ?? g;
  const high = Math.max(g, gP, gN); // the high shelf (a real conflated step)
  const lowShelf = Math.min(gP, gN); // the low shelf on the far/river side
  const thick = kind === undefined ? undefined : FREESTANDING_M[kind];
  const top = thick === undefined ? high : Math.max(high, lowShelf + h);
  // Stand the wall just onto the low side so its face skins the terrain
  // step; a freestanding one on level ground straddles its line.
  const s = gP <= gN ? 1 : -1;
  const at =
    thick === undefined
      ? OFFSET_M
      : thick / 2 +
        (OFFSET_M - thick / 2) * Math.min(1, (high - lowShelf) / STEP_FULL_M);
  const faceE: Point2 = [ex + s * px * at, ey + s * py * at];
  // base = the low shelf, dropped further to span the OSM height when the
  // step is shallower than the tag; clamped to MAX_H + a small dip below
  // ground.
  const base = Math.max(top - MAX_H, Math.min(lowShelf, top - h)) - SINK.wall;
  const w = epsgToWorld(faceE[0], faceE[1], offset);
  if (thick === undefined) {
    return { face: faceE, wx: w.x, wz: w.z, base, top };
  }
  const back: Point2 = [faceE[0] - s * px * thick, faceE[1] - s * py * thick];
  const b = epsgToWorld(back[0], back[1], offset);
  return { face: faceE, back, wx: w.x, wz: w.z, bx: b.x, bz: b.z, base, top };
}

/** How far behind the face the coping cap may reach to find the high
 *  shelf (m), how close to the shelf the ground must come there (m), and
 *  how far past that point the cap runs on (m). */
const CAP_REACH_M = 5;
const CAP_TOLERANCE_M = 0.08;
const CAP_OVERLAP_M = 0.3;
const CAP_SCAN_M = 0.25;

/**
 * Where this column's cap ends (offset along +perp): where the ground
 * behind the face first comes within CAP_TOLERANCE_M of the cap's level,
 * plus CAP_OVERLAP_M. The smoothed crest is a median along the wall, but
 * the measured ramp is wider at one vertex than at the next: a cap ending
 * at the median left the DGM's steep ramp showing behind it wherever the
 * ramp ran on, as a row of dark, jagged facets along the wall's top. Past
 * CAP_REACH_M (a flight of steps down, a slope, not a ramp) it stays at the
 * smoothed crest.
 */
function capEnd(
  heightAt: HeightAt,
  e: Point2,
  p: Point2,
  step: StepSnap,
  faceAt: number
): number {
  const [ex, ey] = e;
  const [px, py] = p;
  const at = (d: number) => faceAt + step.up * d;
  const d = reachLevel(
    (dd) => heightAt(ex + px * at(dd), ey + py * at(dd)),
    () => step.hi,
    { reach: CAP_REACH_M, step: CAP_SCAN_M, tolerance: CAP_TOLERANCE_M }
  );
  return d === null ? step.crest : at(d + CAP_OVERLAP_M);
}

/** Where a snapped column's face stands (offset along +perp). */
function faceOf(step: StepSnap): number {
  return step.foot - step.up * FACE_MARGIN_M;
}

/** How many columns either side a cap's end is carried over: one vertex's
 *  wider ramp widens its neighbours' cap too, so the cap's back edge runs
 *  as a steady line rather than a sawtooth. */
const CAP_SMOOTH = 2;

/** Caps whose tops differ by more than this (m) hold different shelves. */
const SAME_LEVEL_M = 1;

/**
 * The runs of a wall's snapped columns that hold one shelf: consecutive
 * columns on the same side whose caps lie within SAME_LEVEL_M of each other
 * (a gap or a jump starts the next run). Where the scan finds one terrace's
 * step along part of a wall and the next terrace's along the rest, the two
 * runs stand apart: a cap's end carried across them ran a lower cap back
 * over the whole terrace between, and the quad joining them stood a
 * diagonal block across it (Meißen's Burgberg).
 */
function stepRuns(steps: readonly (StepSnap | null)[]): number[] {
  const runs: number[] = [];
  steps.forEach((s, i) => {
    const prev = steps[i - 1];
    const same =
      s && prev && s.up === prev.up && Math.abs(s.hi - prev.hi) <= SAME_LEVEL_M;
    runs.push(i === 0 ? 0 : runs[i - 1] + (same ? 0 : 1));
  });
  return runs;
}

/** The farthest cap end (toward the high side) within CAP_SMOOTH columns of
 *  the same run (`stepRuns`). */
function smoothCapEnds(
  ends: (number | null)[],
  steps: (StepSnap | null)[],
  runs: readonly number[]
): (number | null)[] {
  return farthestNear(
    ends,
    CAP_SMOOTH,
    (i) => (steps[i]?.up ?? 1) as 1 | -1,
    (i) => runs[i]
  );
}

/** The column at a (smoothed) measured step: face just in front of the
 *  ramp's foot, cap back to where the ground reaches its level. */
function snappedColumn(
  e: Point2,
  p: Point2,
  h: number,
  step: StepSnap,
  offset: RecenterOffset,
  backAt: number
): WallCol {
  const [ex, ey] = e;
  const [px, py] = p;
  const faceAt = faceOf(step);
  const faceE: Point2 = [ex + px * faceAt, ey + py * faceAt];
  const backE: Point2 = [ex + px * backAt, ey + py * backAt];
  const face = epsgToWorld(faceE[0], faceE[1], offset);
  const back = epsgToWorld(backE[0], backE[1], offset);
  const base =
    Math.max(step.hi - MAX_H, Math.min(step.lo, step.hi - h)) - SINK.wall;
  return {
    face: faceE,
    back: backE,
    wx: face.x,
    wz: face.z,
    bx: back.x,
    bz: back.z,
    base,
    top: step.hi,
  };
}

/** The coping cap between two snapped columns: a flat strip at the top from
 *  the face back to the crest, hiding the ramp the face stands in front of.
 *  Wound to face up whichever side of the line the high shelf is on: the
 *  walls draw both sides, and three shades a triangle seen from its back
 *  with its normal turned over — a cap wound the other way came out black
 *  from above (Meißen's Burgberg, where OSM draws the walls with the high
 *  side to the right: 5.8 % of the tile's wall area). */
function pushCap(pos: number[], nrm: number[], a: WallCol, b: WallCol): void {
  if (a.bx === undefined && b.bx === undefined) {
    return;
  }
  const ab: [number, number] = [a.bx ?? a.wx, a.bz ?? a.wz];
  const bb: [number, number] = [b.bx ?? b.wx, b.bz ?? b.wz];
  const quad: [number, number, number][] = [
    [a.wx, a.top, a.wz],
    [b.wx, b.top, b.wz],
    [bb[0], b.top, bb[1]],
    [ab[0], a.top, ab[1]],
  ];
  // the up component of (b.face − a.face) × (b.back − a.face)
  const up = (b.wz - a.wz) * (bb[0] - a.wx) - (b.wx - a.wx) * (bb[1] - a.wz);
  const order = up >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
  for (const k of order) {
    pos.push(...quad[k]);
    nrm.push(0, 1, 0);
  }
}

/** A quad's joins between two columns: the face's foot, and the cap's
 *  back edge where both columns carry one. */
function wallJoins(a: WallCol, b: WallCol): JoinPoint[] {
  const out = joinsAlong(
    "foot",
    { x: a.face[0], y: a.face[1], z: a.base },
    { x: b.face[0], y: b.face[1], z: b.base }
  );
  if (a.back && b.back) {
    // a cap meets the ground behind it, or drops a back face to it
    const dropped = a.backFoot !== undefined || b.backFoot !== undefined;
    out.push(
      ...joinsAlong(
        dropped ? "foot" : "edge",
        { x: a.back[0], y: a.back[1], z: a.backFoot ?? a.top },
        { x: b.back[0], y: b.back[1], z: b.backFoot ?? b.top }
      )
    );
  }
  return out;
}

/** The back face a cap drops to the ground behind it, where either column
 *  needs one (`backFoot`). */
function pushBack(pos: number[], nrm: number[], a: WallCol, b: WallCol): void {
  if (
    (a.backFoot === undefined && b.backFoot === undefined) ||
    a.bx === undefined ||
    a.bz === undefined ||
    b.bx === undefined ||
    b.bz === undefined
  ) {
    return;
  }
  pushQuad(
    pos,
    nrm,
    { ...a, wx: a.bx, wz: a.bz, base: a.backFoot ?? a.top },
    { ...b, wx: b.bx, wz: b.bz, base: b.backFoot ?? b.top }
  );
}

/** Pushes the two triangles of a vertical quad between two columns. */
function pushQuad(pos: number[], nrm: number[], a: WallCol, b: WallCol): void {
  let nx = -(b.wz - a.wz);
  let nz = b.wx - a.wx;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl;
  nz /= nl;
  // a.base, b.base, b.top, a.top → two tris, wound to agree with the normal
  // (both sides are drawn, and a side seen from behind is shaded turned over)
  pos.push(
    a.wx,
    a.base,
    a.wz,
    b.wx,
    b.base,
    b.wz,
    b.wx,
    b.top,
    b.wz,
    a.wx,
    a.base,
    a.wz,
    b.wx,
    b.top,
    b.wz,
    a.wx,
    a.top,
    a.wz
  );
  for (let i = 0; i < 6; i++) {
    nrm.push(nx, 0, nz);
  }
}

export interface WallGeometryData {
  /** where the walls meet the ground (ADR 0035): the face's foot, and the
   *  back edge of a snapped wall's cap, which meets the high shelf */
  joins: JoinPoint[];
  /** world-frame (Y-up, recentered) flat normals, xyz per vertex */
  normals: number[];
  /** world-frame (Y-up, recentered) positions, xyz per vertex, triangles */
  positions: number[];
  /** per vertex, its wall's material (an index into `MASONRY`) */
  tones: number[];
}

/**
 * One wall's densified columns (null where the ground is unknown). With
 * `snapToStep`, an earth-retaining wall first snaps every vertex to the
 * measured step and smooths the snaps along the wall (lib/city/wall-snap.ts);
 * vertices that find no agreed step fall back to the OSM-line placement.
 */
function columnsOf(
  wall: WallRibbon,
  heightAt: HeightAt,
  offset: RecenterOffset,
  opts: WallOptions
): (WallCol | null)[] {
  const h = Math.max(0.5, wall.h);
  const pts = subdividePolyline(wall.coords, SAMPLE_M);
  const perps = pts.map((_, i): Point2 => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / tl, (b[0] - a[0]) / tl];
  });
  const snap = opts.snapToStep === true && RETAINING_KINDS.has(wall.kind ?? "");
  let steps = snap
    ? smoothSnaps(
        pts.map((p, i) =>
          snapToStep(heightAt, p[0], p[1], perps[i][0], perps[i][1])
        )
      )
    : [];
  // A city wall is either kind, and one rule holds the whole wall: one
  // standing well above the step it measures is freestanding on every
  // column — snapped, its columns on a step ended at the shelf beside
  // ones standing the tag (a sawtooth). One that holds the earth snaps,
  // and where it finds no step still stands its height (never buried).
  if (
    snap &&
    (wall.kind ?? "") in FREESTANDING_M &&
    standsAboveStep(steps, h)
  ) {
    steps = [];
  }
  const runs = stepRuns(steps);
  const ends = smoothCapEnds(
    pts.map((p, i) => {
      const step = steps[i];
      return step ? capEnd(heightAt, p, perps[i], step, faceOf(step)) : null;
    }),
    steps,
    runs
  );
  const cols = pts.map((p, i) => {
    const step = steps[i];
    const end = ends[i];
    // smoothSnaps fills gaps from the neighbours; a vertex off every tile
    // must still break the ribbon (columnAt's rule), not get a filled column.
    return step && end !== null && heightAt(p[0], p[1]) !== null
      ? { ...snappedColumn(p, perps[i], h, step, offset, end), run: runs[i] }
      : columnAt(p, perps[i], h, heightAt, offset, wall.kind);
  });
  return cols.map((c, i) =>
    c ? grounded(c, cols[i - 1], cols[i + 1], heightAt) : c
  );
}

/**
 * A column held to the ground it meets (ADR 0035): its foot reaches the
 * lowest ground along the face to its neighbours — a wall sampled every
 * 2.5 m stood its foot on the shelves either side of a dip, a ditch or the
 * water at a quay; and where the ground behind its cap lies below the cap
 * (a cap that found no shelf within reach: steps down, a slope), the cap
 * drops a back face to that ground instead of ending in the air.
 */
function grounded(
  c: WallCol,
  prev: WallCol | null | undefined,
  next: WallCol | null | undefined,
  heightAt: HeightAt
): WallCol {
  const mid = (n: WallCol | null | undefined): Point2[] =>
    n ? [[(c.face[0] + n.face[0]) / 2, (c.face[1] + n.face[1]) / 2]] : [];
  const low = lowestGround(heightAt, [c.face, ...mid(prev), ...mid(next)]);
  const base = low === null ? c.base : Math.min(c.base, low - SINK.wall);
  if (!c.back) {
    return { ...c, base };
  }
  const behind = heightAt(c.back[0], c.back[1]);
  return behind !== null && behind < c.top - EDGE_TOLERANCE_M
    ? { ...c, base, backFoot: behind - SINK.wall }
    : { ...c, base };
}

/**
 * Every wall as vertical quads between its densified columns, skipping
 * kerb-height stretches and breaking where the ground is unknown. Null when
 * nothing stands.
 */
export function wallGeometry(
  walls: WallRibbon[],
  heightAt: HeightAt,
  offset: RecenterOffset,
  opts: WallOptions = {}
): WallGeometryData | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const joins: JoinPoint[] = [];
  const tones: number[] = [];
  for (const wall of walls) {
    if (wall.coords.length < 2 || wall.h < KERB_WALL_M) {
      continue;
    }
    const cols = columnsOf(wall, heightAt, offset, opts);
    const first = positions.length / 3;

    for (let i = 0; i < cols.length - 1; i++) {
      const c0 = cols[i];
      const c1 = cols[i + 1];
      if (!(c0 && c1) || (c0.run ?? c1.run) !== (c1.run ?? c0.run)) {
        continue; // off the ground, or two runs at different steps
      }
      if (c0.top - c0.base < MIN_H && c1.top - c1.base < MIN_H) {
        continue;
      }
      pushQuad(positions, normals, c0, c1);
      pushCap(positions, normals, c0, c1);
      pushBack(positions, normals, c0, c1);
      joins.push(...wallJoins(c0, c1));
    }
    const tone = MASONRY.indexOf(wall.mat ?? "stone");
    for (let v = first; v < positions.length / 3; v++) {
      tones.push(tone);
    }
  }
  return positions.length > 0 ? { positions, normals, joins, tones } : null;
}
