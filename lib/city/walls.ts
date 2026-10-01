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
  /** tagged or default height (m) */
  h: number;
  /** the OSM kind (retaining_wall, city_wall, embankment, wall, …) */
  kind?: string;
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
const MIN_H = 1.2; // skip kerb-height garden walls (m)
const MAX_H = 14; // clamp tall tags (m)

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
  top: number;
  wx: number;
  wz: number;
}

type HeightAt = (x: number, y: number) => number | null;

/** Base/top elevation for one wall vertex: top = the high side, base dropped
 *  to the low side or the tagged height, whichever is lower (clamped). */
function columnAt(
  e: Point2,
  p: Point2,
  h: number,
  heightAt: HeightAt,
  offset: RecenterOffset
): WallCol | null {
  const [ex, ey] = e;
  const [px, py] = p;
  const g = heightAt(ex, ey);
  if (g === null) {
    return null; // off the site / NoData — break the ribbon here
  }
  const gP = heightAt(ex + px * PERP_M, ey + py * PERP_M) ?? g;
  const gN = heightAt(ex - px * PERP_M, ey - py * PERP_M) ?? g;
  const top = Math.max(g, gP, gN); // the high shelf (a real conflated step)
  const lowShelf = Math.min(gP, gN); // the low shelf on the far/river side
  // Stand the wall just onto the low side so its face skins the terrain step.
  const towardP = gP <= gN;
  const sx = ex + (towardP ? px : -px) * OFFSET_M;
  const sy = ey + (towardP ? py : -py) * OFFSET_M;
  // base = the low shelf, dropped further to span the OSM height when the
  // step is shallower than the tag; clamped to MAX_H + a small dip below
  // ground.
  const base = Math.max(top - MAX_H, Math.min(lowShelf, top - h)) - SINK.wall;
  const w = epsgToWorld(sx, sy, offset);
  return { face: [sx, sy], wx: w.x, wz: w.z, base, top };
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

/** The farthest cap end (toward the high side) within CAP_SMOOTH columns
 *  that agree on the side. */
function smoothCapEnds(
  ends: (number | null)[],
  steps: (StepSnap | null)[]
): (number | null)[] {
  return farthestNear(
    ends,
    CAP_SMOOTH,
    (i) => (steps[i]?.up ?? 1) as 1 | -1,
    (i) => steps[i]?.up
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
 *  the face back to the crest, hiding the ramp the face stands in front of. */
function pushCap(pos: number[], nrm: number[], a: WallCol, b: WallCol): void {
  if (a.bx === undefined && b.bx === undefined) {
    return;
  }
  const abx = a.bx ?? a.wx;
  const abz = a.bz ?? a.wz;
  const bbx = b.bx ?? b.wx;
  const bbz = b.bz ?? b.wz;
  pos.push(
    a.wx,
    a.top,
    a.wz,
    b.wx,
    b.top,
    b.wz,
    bbx,
    b.top,
    bbz,
    a.wx,
    a.top,
    a.wz,
    bbx,
    b.top,
    bbz,
    abx,
    a.top,
    abz
  );
  for (let i = 0; i < 6; i++) {
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
  // a.base, b.base, b.top, a.top → two tris (double-sided, winding is free)
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
  const steps = snap
    ? smoothSnaps(
        pts.map((p, i) =>
          snapToStep(heightAt, p[0], p[1], perps[i][0], perps[i][1])
        )
      )
    : [];
  const ends = smoothCapEnds(
    pts.map((p, i) => {
      const step = steps[i];
      return step ? capEnd(heightAt, p, perps[i], step, faceOf(step)) : null;
    }),
    steps
  );
  const cols = pts.map((p, i) => {
    const step = steps[i];
    const end = ends[i];
    // smoothSnaps fills gaps from the neighbours; a vertex off every tile
    // must still break the ribbon (columnAt's rule), not get a filled column.
    return step && end !== null && heightAt(p[0], p[1]) !== null
      ? snappedColumn(p, perps[i], h, step, offset, end)
      : columnAt(p, perps[i], h, heightAt, offset);
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
  for (const wall of walls) {
    if (wall.coords.length < 2) {
      continue;
    }
    const cols = columnsOf(wall, heightAt, offset, opts);

    for (let i = 0; i < cols.length - 1; i++) {
      const c0 = cols[i];
      const c1 = cols[i + 1];
      if (!(c0 && c1)) {
        continue;
      }
      if (c0.top - c0.base < MIN_H && c1.top - c1.base < MIN_H) {
        continue;
      }
      pushQuad(positions, normals, c0, c1);
      pushCap(positions, normals, c0, c1);
      pushBack(positions, normals, c0, c1);
      joins.push(...wallJoins(c0, c1));
    }
  }
  return positions.length > 0 ? { positions, normals, joins } : null;
}
