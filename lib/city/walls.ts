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
  base: number;
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
  const base = Math.max(top - MAX_H, Math.min(lowShelf, top - h)) - 0.4;
  const w = epsgToWorld(sx, sy, offset);
  return { wx: w.x, wz: w.z, base, top };
}

/** The column at a (smoothed) measured step: face just in front of the
 *  ramp's foot, cap back to its crest. */
function snappedColumn(
  e: Point2,
  p: Point2,
  h: number,
  step: StepSnap,
  offset: RecenterOffset
): WallCol {
  const [ex, ey] = e;
  const [px, py] = p;
  const faceAt = step.foot - step.up * FACE_MARGIN_M;
  const face = epsgToWorld(ex + px * faceAt, ey + py * faceAt, offset);
  const back = epsgToWorld(ex + px * step.crest, ey + py * step.crest, offset);
  const base = Math.max(step.hi - MAX_H, Math.min(step.lo, step.hi - h)) - 0.4;
  return {
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
  return pts.map((p, i) => {
    const step = steps[i];
    // smoothSnaps fills gaps from the neighbours; a vertex off every tile
    // must still break the ribbon (columnAt's rule), not get a filled column.
    return step && heightAt(p[0], p[1]) !== null
      ? snappedColumn(p, perps[i], h, step, offset)
      : columnAt(p, perps[i], h, heightAt, offset);
  });
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
    }
  }
  return positions.length > 0 ? { positions, normals } : null;
}
