import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  ShapeUtils,
  Vector2,
} from "three/webgpu";
import type {
  AreaFeature,
  BridgeFeature,
  RailFeature,
} from "@/lib/city/features";
import {
  APPROACH_GRADE,
  approachLanding,
  archFits,
  archSpringing,
  axisFrame,
  BRIDGE_STEP,
  type BridgeRib,
  intradosAt,
  MASONRY_PIER_HALF,
  masonryArches,
  type MasonryPier,
  type MasonrySpan,
  type Parabola,
  PIER_SPACING,
  pierStations,
  placeRibs,
  ribPeaks,
  ribProfile,
  ribRuns,
} from "@/lib/city/bridge";
import {
  type DeckPoly,
  deckPoly,
  decksAt,
  deckRing,
  longAxis,
  pointInRing,
  type Ring2,
  ringToWorld,
} from "@/lib/city/decks";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { SINK } from "@/lib/city/ground-join";
import {
  type Level,
  LEVEL_GRADE,
  LEVEL_STEP,
  type LevelLine,
  type LevelRun,
  lineLevels,
  modeRuns,
  runLevelAt,
} from "@/lib/city/levels";
import { DECK_REACH_M, RIDES } from "@/lib/city/line-levels";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import { sceneMaterial } from "./three-utils";

/**
 * Railway + bridge layer. The railway corridor and bridges used to exist only as
 * a flat land-cover colour painted on the DGM (a brown smear; bridges sank into
 * the Elbe). This builds stylized geometry from the baked GeoJSONs
 * (pipeline/bake/rail.py), redesigned after the first pass z-fought into ragged
 * edges and stacked into "2-story" bridges:
 *
 *  - Ballast yards: ONE merged surface from the DISSOLVED Basis-DLM ver03_f area
 *    polygons (no per-line overlap → no z-fight). The recoloured class-5 splat
 *    sits underneath, so any sub-pixel gap reads as ballast, not a seam.
 *  - Rails: Basis-DLM ver03_l centrelines (heavy rail), built per fine terrain
 *    tile on the cross-tile heightAt (every loaded terrain) and split at NoData
 *    gaps, so tracks follow the ground across tile seams.
 *  - Bridges: ONE clean slab volume per Basis-DLM ver06_f deck polygon (top +
 *    continuous fascia), flush parapet walls (no floating cap), piers dropped even
 *    over the river. Rails ride the deck directly (no ballast stacked on top).
 *  - Platforms: OSM railway=platform polygons (ODbL).
 *
 * All geometry is hand-wound to match its supplied normal (see pushTri), so every
 * material is FrontSide. Authored in Y-up world coords → added to `scene`.
 * The materials are plain lit node materials, one per colour/finish for the
 * whole scene (`sceneMaterial`): they carry no per-tile data, and the
 * scene's fog node reaches them like every other material.
 * Non-fatal: missing/empty inputs yield an empty group.
 */

/** Outer rings of a Polygon or MultiPolygon geometry (holes are ignored). */
function outerRings(
  geometry: AreaFeature["geometry"] | null | undefined
): [number, number][][] {
  if (geometry?.type === "Polygon") {
    const outer = geometry.coordinates[0];
    return outer ? [outer] : [];
  }
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates
      .map((poly) => poly[0])
      .filter((ring): ring is [number, number][] => ring !== undefined);
  }
  return [];
}

export interface RailContext extends GroundContext {
  /**
   * Whether this tile draws a bridge whose deck centre is at (x, y) (EPSG).
   * A deck across a seam is in both tiles' files — the same, from the
   * bake's mosaic — and every copy lifts the tile's own rails, but only its
   * owner draws it. Absent: every bridge is drawn.
   */
  owns?: (x: number, y: number) => boolean;
}

/** The whole block's baked features, every tile's lists merged. */
export interface RailFeatures {
  /** dissolved ballast areas (Basis-DLM ver03_f) */
  ballast: AreaFeature[];
  /** bridge decks (Basis-DLM ver06_f) */
  bridges: BridgeFeature[];
  /** OSM platforms (ODbL) */
  platforms: AreaFeature[];
  /** railway-track centrelines (Basis-DLM ver03_l) */
  rails: RailFeature[];
}

const SAMPLE_M = LEVEL_STEP.rail; // densify polylines to this spacing (m)
const BALLAST_RAISE = 0.18; // ballast crown above ground (m)
const BALLAST_DROP = 0.45; // ballast shoulder depth at the edge (m)
const RAIL_RAISE = BALLAST_RAISE + 0.16; // rail head above ground on terrain (m)
const RAIL_DECK_RAISE = 0.08; // rail head above a bridge deck (no ballast) (m)
const RAIL_WEB = 0.11; // rail vertical web depth so it reads obliquely (m)
const GAUGE = 1.435; // standard-gauge rail spacing (m)
const TRACK_PITCH = 4.0; // spacing between parallel track centres (m)
const RAIL_HALF = 0.075; // half-width of a drawn rail (m)
const DECK_DEPTH = 1.1; // bridge-deck slab thickness (m)
const PARAPET_H = 0.85; // bridge parapet wall height (m)
const PIER_MIN_GAP = 2.5; // only pier where the deck clears the ground by this (m)
const PIER_HALF = 0.65; // pier column half-width (m)
const PLATFORM_H = 0.55; // station platform height above ground (m)
// The steel is abstracted like the buildings are: a truss is an open frame
// (its measured top as one calm chord, a few posts, no diagonals), an arch
// one band with a few hangers, a cable-stayed pylon a handful of stays.
const FIN_HALF = 0.3; // half-thickness of a truss frame's chord (m)
const CHORD_DEPTH = 1.6; // depth of a truss frame's top chord (m)
const FRAME_POST_EVERY = 5; // a truss frame's post every this many 2 m stations (10 m)
const PORTAL_HALF = 0.45; // half-section of the portal between two pylons (m)
const ARCH_HALF = 0.6; // half-section of a steel arch band (m)
const HANGER_HALF = 0.18; // half-section of a hanger above the deck (m)
const POST_HALF = 0.3; // half-section of a spandrel post under the deck (m)
const STAY_HALF = 0.09; // half-section of a stay cable (m)
const PYLON_HALF = 0.55; // half-section of a cable-stayed pylon (m)
const PYLON_PIER_HALF = 1.3; // half-width of the river pier under a pylon (m)
const HANGER_EVERY = 8; // a hanger or post every this many 2 m stations (16 m)
const STAY_EVERY = 6; // a stay every this many 2 m stations (12 m)
const END_EDGE_COS = 0.5; // a ring edge this far off the axis is an abutment end

export const COLORS = {
  ballast: 0x9a_8f_85, // warm grey-brown crushed stone
  rail: 0x4a_4a_50, // dark weathered steel
  // the decks in the ground's own palette (lib/city/landcover.ts), the
  // structure in the buildings' cool clay: a bridge is part of the city
  deckStone: 0xd9_d5_cc, // cool clay (building-tint's `cool` family)
  deckRoad: 0xc8_c8_ce, // the road class
  deckPath: 0xe0_cd_a8, // the path class
  deckRail: 0xb2_a9_a0, // the railway class
  platform: 0xcf_c9_bd, // pale platform concrete
  steel: 0xd9_dd_e0, // painted steel: the palest slate of the clay family
};

/** Accumulates a non-indexed triangle soup (positions + per-vertex normals). */
export interface Mesh3 {
  nrm: number[];
  pos: number[];
}

export function mesh3(): Mesh3 {
  return { pos: [], nrm: [] };
}

/**
 * Pushes a triangle, AUTO-WINDING it so its front face matches `n`. This is the
 * single guarantee that lets every material be FrontSide: regardless of the
 * input vertex order, the emitted winding agrees with the supplied normal, so no
 * face can vanish under back-face culling.
 */
function pushTri(
  acc: Mesh3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  nx: number,
  ny: number,
  nz: number
): void {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const gx = uy * vz - uz * vy;
  const gy = uz * vx - ux * vz;
  const gz = ux * vy - uy * vx;
  if (gx * nx + gy * ny + gz * nz >= 0) {
    acc.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  } else {
    acc.pos.push(ax, ay, az, cx, cy, cz, bx, by, bz);
  }
  acc.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

export type P3 = [number, number, number];

/**
 * Two triangles p0 p1 p2, p0 p2 p3 facing `n`. Indexed, not spread: WebKit
 * runs a spread in a call through the iterator protocol, and a tile's tram
 * tracks are ~10⁵ quads — on an iPhone the spreads alone held a frame for
 * a quarter of a second.
 */
export function quad(acc: Mesh3, p0: P3, p1: P3, p2: P3, p3: P3, n: P3): void {
  quadXYZ(
    acc,
    p0[0],
    p0[1],
    p0[2],
    p1[0],
    p1[1],
    p1[2],
    p2[0],
    p2[1],
    p2[2],
    p3[0],
    p3[1],
    p3[2],
    n[0],
    n[1],
    n[2]
  );
}

/** `quad` on plain numbers: nothing allocated per quad. */
function quadXYZ(
  acc: Mesh3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
  nx: number,
  ny: number,
  nz: number
): void {
  pushTri(acc, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz);
  pushTri(acc, ax, ay, az, cx, cy, cz, dx, dy, dz, nx, ny, nz);
}

function finishGeo(acc: Mesh3): BufferGeometry | null {
  if (acc.pos.length === 0) {
    return null;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(acc.nrm, 3));
  g.computeBoundingSphere();
  return g;
}

interface MatOpts {
  offsetUnits?: number;
  roughness?: number;
}

/**
 * The scene-wide lit material of one colour and finish (the key holds every
 * setting, so two layers asking for the same look share one build). The
 * polygon offset pulls a surface lying on the ground (ballast, rails, a
 * track bed) in front of the terrain it covers.
 */
function material(color: number, opts: MatOpts = {}): MeshStandardNodeMaterial {
  const roughness = opts.roughness ?? 0.95;
  const offsetUnits = opts.offsetUnits ?? 0;
  const key = `rail:${color.toString(16)}:${roughness}:${offsetUnits}`;
  return sceneMaterial(key, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(color),
      roughness,
    });
    if (offsetUnits) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = offsetUnits;
    }
    return m;
  });
}

/**
 * Triangulates a footprint into a top face at per-vertex `topY` plus a continuous
 * outward-facing fascia dropping `depth` — one solid slab volume, not stacked
 * planes. Used for ballast areas, bridge decks, and platforms. `underside`
 * closes the slab from below too (a bridge deck, seen from under it).
 */
export function addFootprint(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  depth: number,
  underside = false
): void {
  const { pts } = ring;
  if (pts.length < 3) {
    return;
  }
  const contour = pts.map((p) => new Vector2(p.x, p.z));
  const tris = ShapeUtils.triangulateShape(contour, []);
  for (const [a, b, c] of tris) {
    pushTri(
      acc,
      pts[a].x,
      topY[a],
      pts[a].z,
      pts[b].x,
      topY[b],
      pts[b].z,
      pts[c].x,
      topY[c],
      pts[c].z,
      0,
      1,
      0
    );
    if (underside) {
      pushTri(
        acc,
        pts[a].x,
        topY[a] - depth,
        pts[a].z,
        pts[b].x,
        topY[b] - depth,
        pts[b].z,
        pts[c].x,
        topY[c] - depth,
        pts[c].z,
        0,
        -1,
        0
      );
    }
  }
  const winding = ringWinding(pts);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const [nx, nz] = outward(pts, i, winding);
    quad(
      acc,
      [pts[i].x, topY[i], pts[i].z],
      [pts[j].x, topY[j], pts[j].z],
      [pts[j].x, topY[j] - depth, pts[j].z],
      [pts[i].x, topY[i] - depth, pts[i].z],
      [nx, 0, nz]
    );
  }
}

/** +1 when the ring runs counter-clockwise in (x, z), else −1. */
function ringWinding(pts: readonly { x: number; z: number }[]): 1 | -1 {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area >= 0 ? 1 : -1;
}

/**
 * The outward normal (x, z; the edge's length) of ring edge i, from the
 * ring's winding. (A test against the ring's centroid, used before, points
 * the inner edge of a curved deck inwards: its centroid lies off the deck,
 * and those faces were culled from outside.)
 */
function outward(
  pts: readonly { x: number; z: number }[],
  i: number,
  winding: 1 | -1
): [number, number] {
  const j = (i + 1) % pts.length;
  return [(pts[j].z - pts[i].z) * winding, -(pts[j].x - pts[i].x) * winding];
}

/** A flush parapet: a vertical wall rising `height` from the deck edge (outward
 *  + inward faces + a thin top), starting exactly at the deck top so it reads as
 *  a wall on the deck, never a floating second deck. */
function addParapetWalls(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  ringS?: number[]
): void {
  const { pts } = ring;
  const across = endEdges(ring, ringS);
  const winding = ringWinding(pts);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    // No wall across the roadway at the abutments: an edge running across
    // the axis is where the deck meets the road, not its side.
    if (across[i]) {
      continue;
    }
    const [ox, oz] = outward(pts, i, winding);
    const len = Math.hypot(ox, oz) || 1;
    const nx = ox / len;
    const nz = oz / len;
    const yi = topY[i];
    const yj = topY[j];
    // outer face (flush with the deck edge)
    quad(
      acc,
      [pts[i].x, yi, pts[i].z],
      [pts[j].x, yj, pts[j].z],
      [pts[j].x, yj + PARAPET_H, pts[j].z],
      [pts[i].x, yi + PARAPET_H, pts[i].z],
      [nx, 0, nz]
    );
    // thin top cap of the wall
    quad(
      acc,
      [pts[i].x, yi + PARAPET_H, pts[i].z],
      [pts[j].x, yj + PARAPET_H, pts[j].z],
      [pts[j].x - nx * 0.18, yj + PARAPET_H, pts[j].z - nz * 0.18],
      [pts[i].x - nx * 0.18, yi + PARAPET_H, pts[i].z - nz * 0.18],
      [0, 1, 0]
    );
  }
}

/**
 * Which ring edges (edge i runs from vertex i to i + 1) cross the axis
 * rather than run along it: the abutment ends. With the vertices' stations
 * an edge that advances along the axis by less than END_EDGE_COS of its
 * length is an end (this holds on a curved deck); without them, the edge's
 * direction against the ring's long axis decides.
 */
function endEdges(ring: Ring2, ringS?: number[]): boolean[] {
  const { pts } = ring;
  const { a, b, span } = longAxis(pts);
  const ux = (b.x - a.x) / (span || 1);
  const uz = (b.z - a.z) / (span || 1);
  return pts.map((p, i) => {
    const j = (i + 1) % pts.length;
    const len = Math.hypot(pts[j].x - p.x, pts[j].z - p.z) || 1;
    const along =
      ringS && ringS.length === pts.length
        ? Math.abs(ringS[j] - ringS[i])
        : Math.abs((pts[j].x - p.x) * ux + (pts[j].z - p.z) * uz);
    return along < END_EDGE_COS * len;
  });
}

/** Axis-aligned box column (4 sides + top) for a bridge pier. */
function addColumn(
  acc: Mesh3,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  h: number
): void {
  const c: [number, number][] = [
    [cx - h, cz - h],
    [cx + h, cz - h],
    [cx + h, cz + h],
    [cx - h, cz + h],
  ];
  for (let s = 0; s < 4; s++) {
    const a = c[s];
    const b = c[(s + 1) % 4];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    if (nx * (a[0] - cx) + nz * (a[1] - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    quad(
      acc,
      [a[0], y1, a[1]],
      [b[0], y1, b[1]],
      [b[0], y0, b[1]],
      [a[0], y0, a[1]],
      [nx, 0, nz]
    );
  }
  quad(
    acc,
    [c[0][0], y1, c[0][1]],
    [c[1][0], y1, c[1][1]],
    [c[2][0], y1, c[2][1]],
    [c[3][0], y1, c[3][1]],
    [0, 1, 0]
  );
}

export interface Pt {
  x: number;
  y: number;
  z: number;
}

/** A bridge's ring, per-vertex deck tops and properties from its baked
 *  feature, or null when it is no deck. */
function deckOf(
  f: BridgeFeature,
  offset: { cx: number; cy: number }
): {
  ring: Ring2;
  topY: number[];
  props: ReturnType<typeof bridgeProps>;
} | null {
  const d = deckRing(f, offset);
  return d ? { ...d, props: bridgeProps(f) } : null;
}

/**
 * The lift table of every bridge deck (all kinds) and, given the ground,
 * of the approaches from their ends down to it (`approaches`), from the
 * same baked features the decks are built from. Shared with the tram layer.
 */
export function buildDeckTable(
  features: BridgeFeature[],
  ctx: Pick<GroundContext, "offset"> & Partial<GroundContext>
): DeckPoly[] {
  const decks: DeckPoly[] = [];
  const parsed = features.flatMap((f) => {
    const d = deckOf(f, ctx.offset);
    return d ? [{ f, ...d }] : [];
  });
  for (const { ring, topY, props } of parsed) {
    decks.push(deckPoly(ring.pts, topY, props.kind));
  }
  const heightAt = ctx.heightAt;
  if (!heightAt) {
    return decks;
  }
  const ground = { offset: ctx.offset, heightAt };
  const ramps: DeckPoly[] = [];
  for (const { f, ring, topY, props } of parsed) {
    const ringS = bridgeRingStations(f);
    for (const a of approaches(ring, topY, props.kind, ringS, ground, decks)) {
      ramps.push(approachPoly(a, props.kind));
    }
  }
  return [...decks, ...ramps];
}

// --- the approaches: from a deck end down to the ground ------------------------

/** Columns along a deck end are at most this far apart (m). */
const APPROACH_COLUMN_M = 2;
/** An end needs an approach where it stands this far above the ground (m)
 *  at the column that needs it most. */
const APPROACH_MIN_M = 0.5;
/** An approach is probed this far past the end for a deck continuing it (m). */
const APPROACH_NEXT_DECK_M = 1;

/** One column of an approach: the deck end's point and top, and where the
 *  ramp from it lands. */
interface ApproachColumn {
  land: { x: number; y: number; z: number };
  x: number;
  y: number;
  z: number;
}

/** An approach from one deck end: its columns across the end, in ring
 *  order, and the unit direction it runs away from the deck. */
export interface Approach {
  columns: ApproachColumn[];
  dir: { x: number; z: number };
  /** its fall (rise over run) */
  grade: number;
}

/** The ring's stations along the bake's axis (the end-edge test's), or
 *  undefined for an older file without an axis. */
function bridgeRingStations(f: BridgeFeature): number[] | undefined {
  const raw = f.properties?.axis;
  const axis = raw ? axisFrame(raw) : null;
  const coords = f.geometry?.coordinates[0];
  if (!(axis && coords)) {
    return undefined;
  }
  const closed =
    coords.length > 1 &&
    coords[0][0] === coords.at(-1)?.[0] &&
    coords[0][1] === coords.at(-1)?.[1];
  return (closed ? coords.slice(0, -1) : coords).map(
    ([x, y]) => axis.project(x, y).s
  );
}

/** Runs of consecutive end edges (cyclic), each as its ring vertex indices
 *  in order. */
function endRuns(across: boolean[]): number[][] {
  const n = across.length;
  const start = across.findIndex((a, i) => !a && across[(i + 1) % n]);
  if (start < 0) {
    return [];
  }
  const runs: number[][] = [];
  let run: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (across[i]) {
      if (run.length === 0) {
        run.push(i);
      }
      run.push((i + 1) % n);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
}

/** Whether (x, z) lies on a deck other than the one whose ring is `own`. */
function onOtherDeck(
  decks: DeckPoly[],
  own: { x: number; z: number }[],
  x: number,
  z: number
): boolean {
  return decks.some(
    (d) =>
      !d.ramp &&
      !(
        d.ring.length === own.length &&
        d.ring[0].x === own[0].x &&
        d.ring[0].z === own[0].z
      ) &&
      x >= d.minX &&
      x <= d.maxX &&
      z >= d.minZ &&
      z <= d.maxZ &&
      pointInRing(d.ring, x, z)
  );
}

/** The columns across one end: every run vertex, and points between them
 *  no more than APPROACH_COLUMN_M apart, each with its top. */
function endColumns(
  pts: { x: number; z: number }[],
  topY: number[],
  run: number[]
): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k < run.length - 1; k++) {
    const a = run[k];
    const b = run[k + 1];
    const len = Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z);
    const m = Math.max(1, Math.ceil(len / APPROACH_COLUMN_M));
    for (let j = 0; j < m; j++) {
      const t = j / m;
      out.push({
        x: pts[a].x + (pts[b].x - pts[a].x) * t,
        y: topY[a] + (topY[b] - topY[a]) * t,
        z: pts[a].z + (pts[b].z - pts[a].z) * t,
      });
    }
  }
  const last = run.at(-1) ?? run[0];
  out.push({ x: pts[last].x, y: topY[last], z: pts[last].z });
  return out;
}

/**
 * The approaches of one deck: from every abutment end that stands above
 * the ground, a ramp at the kind's grade down to where it meets it
 * (lib/city/bridge.ts `approachLanding`), column by column across the end.
 * None where the deck continues onto another deck, where most of the end
 * finds no ground in reach, or where it meets the ground already.
 */
export function approaches(
  ring: Ring2,
  topY: number[],
  kind: string,
  ringS: number[] | undefined,
  ctx: GroundContext,
  decks: DeckPoly[]
): Approach[] {
  const { pts } = ring;
  const grade = APPROACH_GRADE[kind] ?? APPROACH_GRADE.other;
  const winding = ringWinding(pts);
  const out: Approach[] = [];
  for (const run of endRuns(endEdges(ring, ringS))) {
    let dx = 0;
    let dz = 0;
    for (let k = 0; k < run.length - 1; k++) {
      const [ox, oz] = outward(pts, run[k], winding);
      dx += ox;
      dz += oz;
    }
    const dl = Math.hypot(dx, dz);
    if (dl === 0) {
      continue;
    }
    const dir = { x: dx / dl, z: dz / dl };
    const cols = endColumns(pts, topY, run);
    const mid = cols[Math.floor(cols.length / 2)];
    const probe = APPROACH_NEXT_DECK_M;
    if (onOtherDeck(decks, pts, mid.x + dir.x * probe, mid.z + dir.z * probe)) {
      continue;
    }
    const approach = approachFrom(cols, dir, grade, ctx);
    if (approach) {
      out.push(approach);
    }
  }
  return out;
}

/** The approach from one end's columns, or null when it needs none. */
function approachFrom(
  cols: { x: number; y: number; z: number }[],
  dir: { x: number; z: number },
  grade: number,
  ctx: GroundContext
): Approach | null {
  const ground = (x: number, z: number) => {
    const e = worldToEpsg({ x, z }, ctx.offset);
    return ctx.heightAt(e.x, e.y);
  };
  const lands = cols.map((c) =>
    approachLanding((d) => ground(c.x + dir.x * d, c.z + dir.z * d), c.y, grade)
  );
  const found = lands.filter((d): d is number => d !== null);
  if (found.length * 2 < cols.length) {
    return null;
  }
  const gaps = cols.map((c) => c.y - (ground(c.x, c.z) ?? c.y));
  if (Math.max(...gaps) < APPROACH_MIN_M || Math.max(...found) === 0) {
    return null;
  }
  const sorted = [...found].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  return {
    dir,
    grade,
    columns: cols.map((c, i) => {
      const d = lands[i] ?? typical;
      return {
        ...c,
        land: { x: c.x + dir.x * d, y: c.y - grade * d, z: c.z + dir.z * d },
      };
    }),
  };
}

/** An approach as a lift entry: its outline, its fall along `dir` from
 *  the middle of the deck end. */
function approachPoly(a: Approach, kind: string): DeckPoly {
  const cols = a.columns;
  const ring = [
    ...cols.map((c) => ({ x: c.x, z: c.z })),
    ...[...cols].reverse().map((c) => ({ x: c.land.x, z: c.land.z })),
  ];
  const n = cols.length;
  const mid = {
    x: cols.reduce((sum, c) => sum + c.x, 0) / n,
    z: cols.reduce((sum, c) => sum + c.z, 0) / n,
  };
  const top = cols.reduce((sum, c) => sum + c.y, 0) / n;
  const reach = Math.max(
    ...cols.map((c) => (c.land.x - c.x) * a.dir.x + (c.land.z - c.z) * a.dir.z),
    1e-3
  );
  const xs = ring.map((p) => p.x);
  const zs = ring.map((p) => p.z);
  return {
    a: mid,
    ax: a.dir.x * reach,
    az: a.dir.z * reach,
    kind,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    profile: [
      { t: 0, y: top },
      { t: 1, y: top - a.grade * reach },
    ],
    ramp: true,
    ring,
  };
}

/** Draws an approach: its top in the deck's colour (`top`), its two sides
 *  and its underside as the deck's fascia (`stone`), `depth` deep. */
function addApproach(
  top: Mesh3,
  stone: Mesh3,
  a: Approach,
  depth: number
): void {
  const cols = a.columns;
  for (let i = 0; i < cols.length - 1; i++) {
    const p = cols[i];
    const q = cols[i + 1];
    const p0: P3 = [p.x, p.y, p.z];
    const q0: P3 = [q.x, q.y, q.z];
    const q1: P3 = [q.land.x, q.land.y, q.land.z];
    const p1: P3 = [p.land.x, p.land.y, p.land.z];
    quad(top, p0, q0, q1, p1, surfaceNormal(p0, q0, p1, true));
    const under = (v: P3): P3 => [v[0], v[1] - depth, v[2]];
    quad(stone, under(p0), under(q0), under(q1), under(p1), [0, -1, 0]);
  }
  // the two sides, from the ramp's top down its depth
  for (const [c, sign] of [
    [cols[0], -1],
    [cols.at(-1) ?? cols[0], 1],
  ] as const) {
    const n = sideNormal(cols, a.dir, sign);
    quad(
      stone,
      [c.x, c.y, c.z],
      [c.land.x, c.land.y, c.land.z],
      [c.land.x, c.land.y - depth, c.land.z],
      [c.x, c.y - depth, c.z],
      n
    );
  }
}

/** The unit normal of the plane through a, b, c, turned up when `up`. */
function surfaceNormal(a: P3, b: P3, c: P3, up: boolean): P3 {
  const n = cross(
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  );
  const u = unit(n);
  return up && u[1] < 0 ? [-u[0], -u[1], -u[2]] : u;
}

/** The outward normal of an approach's first (sign −1) or last (+1) side:
 *  across `dir`, pointing away from the other columns. */
function sideNormal(
  cols: ApproachColumn[],
  dir: { x: number; z: number },
  sign: -1 | 1
): P3 {
  const first = cols[0];
  const last = cols.at(-1) ?? first;
  const ax = last.x - first.x;
  const az = last.z - first.z;
  // across dir, oriented from the first column toward the last
  let nx = -dir.z;
  let nz = dir.x;
  if (nx * ax + nz * az < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx * sign, 0, nz * sign];
}

/** Per-vertex top elevations for a ring, clamped to terrain (+raise), with a
 *  median fallback so a vertex off the loaded block doesn't collapse the slab. */
function clampRing(
  ring: Ring2,
  raise: number,
  ctx: RailContext
): number[] | null {
  const ys: (number | null)[] = ring.pts.map((p) => {
    const e = worldToEpsg(p, ctx.offset);
    const g = ctx.heightAt(e.x, e.y);
    return g === null ? null : g + raise;
  });
  const valid = ys.filter((y): y is number => y !== null).sort((a, b) => a - b);
  if (valid.length === 0) {
    return null;
  }
  const median = valid[Math.floor(valid.length / 2)];
  return ys.map((y) => y ?? median);
}

function worldToEpsg(
  p: { x: number; z: number },
  offset: { cx: number; cy: number }
) {
  return { x: p.x + offset.cx, y: offset.cy - p.z };
}

function tangentsXZ(pts: Pt[]): Vector2[] {
  const t: Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const v = new Vector2(b.x - a.x, b.z - a.z);
    if (v.lengthSq() === 0) {
      v.set(1, 0);
    }
    t.push(v.normalize());
  }
  return t;
}

/** A single rail: a thin top ribbon + two vertical webs along a run of points. */
export function addRail(acc: Mesh3, pts: Pt[], lateral: number): void {
  addRibbon(acc, pts, lateral, RAIL_HALF, RAIL_WEB);
}

/**
 * A ribbon of half-width `half` offset `lateral` from a run of points: a
 * top face and a vertical web of depth `web` down each side (a rail, a
 * groove, a track bed; no webs at 0). Shared with the tram layer.
 */
export function addRibbon(
  acc: Mesh3,
  pts: Pt[],
  lateral: number,
  half: number,
  web: number
): void {
  if (pts.length < 2) {
    return;
  }
  const tan = tangentsXZ(pts);
  const side = (sign: number) =>
    pts.map((p, i) => {
      const nx = -tan[i].y;
      const nz = tan[i].x;
      return {
        x: p.x + nx * (lateral + sign * half),
        y: p.y,
        z: p.z + nz * (lateral + sign * half),
      };
    });
  const left = side(1);
  const right = side(-1);
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = left[i];
    const l1 = left[i + 1];
    const r0 = right[i];
    const r1 = right[i + 1];
    // top
    quadXYZ(
      acc,
      l0.x,
      l0.y,
      l0.z,
      r0.x,
      r0.y,
      r0.z,
      r1.x,
      r1.y,
      r1.z,
      l1.x,
      l1.y,
      l1.z,
      0,
      1,
      0
    );
    if (web <= 0) {
      continue;
    }
    // web on each side (outward normal via the tangent perpendicular)
    const nx = -tan[i].y;
    const nz = tan[i].x;
    quadXYZ(
      acc,
      l0.x,
      l0.y,
      l0.z,
      l1.x,
      l1.y,
      l1.z,
      l1.x,
      l1.y - web,
      l1.z,
      l0.x,
      l0.y - web,
      l0.z,
      nx,
      0,
      nz
    );
    quadXYZ(
      acc,
      r0.x,
      r0.y,
      r0.z,
      r1.x,
      r1.y,
      r1.z,
      r1.x,
      r1.y - web,
      r1.z,
      r0.x,
      r0.y - web,
      r0.z,
      -nx,
      0,
      -nz
    );
  }
}

export function meshFrom(
  acc: Mesh3,
  color: number,
  opts: { cast: boolean; offsetUnits?: number; roughness?: number }
): Mesh | null {
  const geo = finishGeo(acc);
  if (!geo) {
    return null;
  }
  const m = new Mesh(
    geo,
    material(color, {
      offsetUnits: opts.offsetUnits,
      roughness: opts.roughness,
    })
  );
  m.castShadow = opts.cast;
  m.receiveShadow = true;
  return m;
}

type BridgeProps = NonNullable<BridgeFeature["properties"]>;

/** A bridge feature's properties with defaults (`properties` may be null). */
function bridgeProps(f: BridgeFeature): {
  deck: number[];
  depth: number;
  kind: NonNullable<BridgeProps["kind"]>;
  structure: string;
} {
  return {
    deck: f.properties?.deck ?? [],
    depth: f.properties?.depth ?? DECK_DEPTH,
    kind: f.properties?.kind ?? "other",
    structure: f.properties?.structure ?? "",
  };
}

/** Whether this tile draws the deck (its centre is the tile's, or no
 *  owner test was given). */
function drawsDeck(coords: [number, number][], ctx: RailContext): boolean {
  if (!ctx.owns) {
    return true;
  }
  let x = 0;
  let y = 0;
  for (const [ex, ey] of coords) {
    x += ex;
    y += ey;
  }
  return ctx.owns(x / coords.length, y / coords.length);
}

/** Whether the bridge's ribs are drawn as frames on its deck edges (a
 *  truss, suspension or cantilever bridge; `addSuperstructure`). */
function drawsFrames(p: BridgeProps): boolean {
  const structure = p.structure ?? "";
  return (
    (p.ribs?.length ?? 0) > 0 &&
    !structure.includes("arch") &&
    !structure.includes("cable-stayed")
  );
}

/** The meshes a bridge is drawn into. */
interface BridgeMeshes {
  /** every deck's lift entry: an approach never runs onto another deck */
  decks: DeckPoly[];
  /** fascia, parapets, piers, masonry arches */
  stone: Mesh3;
  /** measured superstructure: chords, arches, pylons, posts */
  steel: Mesh3;
  tops: Record<string, Mesh3>;
}

/** Draws one bridge: deck, parapets, whatever carries it and stands on it. */
function drawBridge(
  f: BridgeFeature,
  ring: Ring2,
  topY: number[],
  out: BridgeMeshes,
  ctx: RailContext
): void {
  const { kind, structure, depth } = bridgeProps(f);
  const top = out.tops[kind] ?? out.tops.other;
  addFootprint(top, ring, topY, depth, true);
  const frame = bridgeFrame(f, ctx);
  for (const a of approaches(ring, topY, kind, frame?.ringS, ctx, out.decks)) {
    addApproach(top, out.stone, a, DECK_DEPTH);
  }
  // where a frame stands on the deck's edge it is the railing: a parapet
  // beside it read as a second strip along the roadway
  if (!drawsFrames(f.properties ?? {})) {
    addParapetWalls(out.stone, ring, topY, frame?.ringS);
  }
  if (!frame) {
    // an older file: no axis, no measurements
    addPiers(out.stone, ring, topY, ctx, depth);
    return;
  }
  const carried = addSuperstructure(out, frame, f.properties ?? {}, depth);
  if (carried.pylons) {
    return;
  }
  if (
    carried.arches.length === 0 &&
    structure.includes("arch") &&
    addMasonry(out.stone, frame, { ring, topY, depth })
  ) {
    return;
  }
  const p = f.properties ?? {};
  const piers = pierStations(frame.length, {
    fairway: p.fairway,
    span: p.span,
  }).filter((s) => carried.arches.every(([from, to]) => s < from || s > to));
  for (const s of piers) {
    addPierAt(out.stone, frame, s, 0, depth, PIER_HALF);
  }
}

/** Builds the bridges this tile draws (deck, parapets, what carries them
 *  and what stands on them). The rails' deck table is buildDeckTable's. */
function buildBridges(
  features: BridgeFeature[],
  ctx: RailContext,
  decks: DeckPoly[]
): Mesh[] {
  const out: BridgeMeshes = {
    decks,
    tops: { rail: mesh3(), road: mesh3(), path: mesh3(), other: mesh3() },
    stone: mesh3(),
    steel: mesh3(),
  };

  for (const f of features) {
    if (f.geometry?.type !== "Polygon" || !f.geometry.coordinates[0]) {
      continue;
    }
    const coords = f.geometry.coordinates[0];
    const ring = ringToWorld(coords, ctx.offset);
    const { deck } = bridgeProps(f);
    if (ring.pts.length < 3 || deck.length < ring.pts.length) {
      continue;
    }
    const topY = ring.pts.map((_, i) => deck[i]);
    if (drawsDeck(coords, ctx)) {
      drawBridge(f, ring, topY, out, ctx);
    }
  }

  const meshes: Mesh[] = [];
  const topColor: Record<string, number> = {
    rail: COLORS.deckRail,
    road: COLORS.deckRoad,
    path: COLORS.deckPath,
    other: COLORS.deckStone,
  };
  for (const kind of Object.keys(out.tops)) {
    const m = meshFrom(out.tops[kind], topColor[kind], {
      cast: true,
    });
    if (m) {
      meshes.push(m);
    }
  }
  const stoneMesh = meshFrom(out.stone, COLORS.deckStone, {
    cast: true,
  });
  if (stoneMesh) {
    meshes.push(stoneMesh);
  }
  const steelMesh = meshFrom(out.steel, COLORS.steel, {
    cast: true,
  });
  if (steelMesh) {
    meshes.push(steelMesh);
  }
  return meshes;
}

// --- the measured bridge (ADR 0033) -------------------------------------------------

/** A bridge's axis frame: stations along it, lateral offsets across it. */
interface BridgeFrame {
  /** world point at station `s` (m from the first abutment), `offset` to the left */
  at(s: number, offset: number): { x: number; z: number };
  /** the terrain there (the DGM's water surface over the river) */
  groundAt(s: number, offset: number): number | null;
  length: number;
  /** deck height per BRIDGE_STEP */
  line: number[];
  /** the deck height at station `s` */
  deckAt(s: number): number;
  /** the deck ring's extreme offsets from the axis (left > 0 > right) */
  edges: { left: number; right: number };
  /** each ring vertex's station (the open ring, as `ringToWorld`) */
  ringS: number[];
  /** the deck's edges at station `s`: its outline's offsets there (a
   *  curved deck around a straight axis is narrower locally than `edges`) */
  edgesAt(s: number): { left: number; right: number };
}

function bridgeFrame(f: BridgeFeature, ctx: RailContext): BridgeFrame | null {
  const line = f.properties?.line;
  const axis = f.properties?.axis ? axisFrame(f.properties.axis) : null;
  if (!(axis && line && line.length >= 2) || axis.length < 1) {
    return null;
  }
  const coords = f.geometry?.coordinates[0] ?? [];
  const closed =
    coords.length > 1 &&
    coords[0][0] === coords.at(-1)?.[0] &&
    coords[0][1] === coords.at(-1)?.[1];
  const onAxis = (closed ? coords.slice(0, -1) : coords).map(([x, y]) =>
    axis.project(x, y)
  );
  const offsets = onAxis.map((p) => p.offset);
  const sMin = Math.min(...onAxis.map((p) => p.s));
  const sMax = Math.max(...onAxis.map((p) => p.s));
  return {
    length: axis.length,
    line,
    edges: {
      left: Math.max(0, ...offsets),
      right: Math.min(0, ...offsets),
    },
    ringS: onAxis.map((p) => p.s),
    edgesAt: (s) => {
      // the axis may run a little past the outline: clamp into its stations
      const at = Math.min(Math.max(s, sMin + 0.01), sMax - 0.01);
      return ringEdgesAt(onAxis, at) ?? { left: 0, right: 0 };
    },
    at: (s, offset) => {
      const [x, y] = axis.at(s, offset);
      const w = epsgToWorld(x, y, ctx.offset);
      return { x: w.x, z: w.z };
    },
    groundAt: (s, offset) => {
      const [x, y] = axis.at(s, offset);
      return ctx.heightAt(x, y);
    },
    deckAt: (s) => {
      const t = Math.min(Math.max(s / BRIDGE_STEP, 0), line.length - 1);
      const i = Math.min(Math.floor(t), line.length - 2);
      return line[i] + (line[i + 1] - line[i]) * (t - i);
    },
  };
}

/** The outline's extreme offsets where it crosses station `s` (linear
 *  along each ring edge); null when it does not reach `s`. */
function ringEdgesAt(
  ring: readonly { offset: number; s: number }[],
  s: number
): { left: number; right: number } | null {
  let left = Number.NEGATIVE_INFINITY;
  let right = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if ((a.s - s) * (b.s - s) <= 0 && a.s !== b.s) {
      const off = a.offset + ((b.offset - a.offset) * (s - a.s)) / (b.s - a.s);
      left = Math.max(left, off);
      right = Math.min(right, off);
    }
  }
  return Number.isFinite(left) ? { left, right } : null;
}

/**
 * Draws what the bake measured above the deck. On an arch bridge the ribs
 * that follow an arch (`archFits`) become steel arches carried down to
 * their springing; the rest is no arch and is not drawn. On a cable-stayed
 * bridge a peaking rib is a pylon with its fan of stays. Otherwise a rib is
 * drawn as measured — chord, posts, diagonals — with pylons on river piers
 * where it peaks. Returns the arches' station ranges and whether pylons
 * carry the deck (then it needs no other piers).
 */
function addSuperstructure(
  out: BridgeMeshes,
  frame: BridgeFrame,
  p: BridgeProps,
  depth: number
): { arches: [number, number][]; pylons: boolean } {
  const ribs = placeRibs(p.ribs ?? [], frame.edges);
  const structure = p.structure ?? "";
  if (structure.includes("arch")) {
    const arches: [number, number][] = [];
    archFits(ribs, frame.line).forEach((fit, r) => {
      if (fit) {
        const offset = ribs[r].offset;
        const span = archSpringing(fit, frame.length, (s) =>
          frame.groundAt(s, offset)
        );
        addArchRib(out.steel, frame, offset, { fit, ...span }, depth);
        arches.push([span.from, span.to]);
      }
    });
    return { arches, pylons: false };
  }
  if (structure.includes("cable-stayed")) {
    return { arches: [], pylons: addStays(out, frame, ribs, depth) };
  }
  for (const rib of ribs) {
    addFrame(out.steel, frame, rib);
  }
  return { arches: [], pylons: addPylons(out, frame, ribs, depth) };
}

/**
 * A cable-stayed bridge: DOM1 sees the pylon and a haze of stays around
 * it, too thin to trace. The pylon stands where the rib peaks (on a river
 * pier), and a few stays fan from its top to the deck, every STAY_EVERY
 * stations of the rib's run, on both sides.
 */
function addStays(
  out: BridgeMeshes,
  frame: BridgeFrame,
  ribs: readonly BridgeRib[],
  depth: number
): boolean {
  let any = false;
  for (const rib of ribs) {
    for (const i of ribPeaks(rib.rise)) {
      any = true;
      const s = i * BRIDGE_STEP;
      const top = point(frame, s, rib.offset, frame.line[i] + rib.rise[i]);
      addStrut(
        out.steel,
        point(frame, s, rib.offset, frame.line[i] - depth),
        top,
        PYLON_HALF
      );
      addPierAt(out.stone, frame, s, rib.offset, depth, PYLON_PIER_HALF);
      const run = ribRuns(rib.rise).find(([a, b]) => a <= i && i <= b);
      for (let k = run?.[0] ?? i; k <= (run?.[1] ?? i); k += STAY_EVERY) {
        if (Math.abs(k - i) >= STAY_EVERY) {
          const at = k * BRIDGE_STEP;
          addStrut(
            out.steel,
            top,
            point(frame, at, rib.offset, frame.line[k]),
            STAY_HALF
          );
        }
      }
    }
  }
  return any;
}

/** A square prism from `a` to `b` (half-section `half`), wound outward. */
function addStrut(acc: Mesh3, a: P3, b: P3, half: number): void {
  const d: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  if (len < 1e-3) {
    return;
  }
  const dn: P3 = [d[0] / len, d[1] / len, d[2] / len];
  const up: P3 = Math.abs(dn[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const side = unit(cross(dn, up));
  const top = unit(cross(side, dn));
  const corner = (p: P3, i: number): P3 => {
    const ss = i === 0 || i === 3 ? half : -half;
    const tt = i < 2 ? half : -half;
    return [
      p[0] + side[0] * ss + top[0] * tt,
      p[1] + side[1] * ss + top[1] * tt,
      p[2] + side[2] * ss + top[2] * tt,
    ];
  };
  const normals: P3[] = [
    top,
    [-side[0], -side[1], -side[2]],
    [-top[0], -top[1], -top[2]],
    side,
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(
      acc,
      corner(a, i),
      corner(a, j),
      corner(b, j),
      corner(b, i),
      normals[i]
    );
  }
  quad(acc, corner(b, 0), corner(b, 1), corner(b, 2), corner(b, 3), dn);
  quad(acc, corner(a, 0), corner(a, 1), corner(a, 2), corner(a, 3), [
    -dn[0],
    -dn[1],
    -dn[2],
  ]);
}

function cross(a: P3, b: P3): P3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function unit(v: P3): P3 {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The world point at a station and offset, at height `y`. */
function point(frame: BridgeFrame, s: number, offset: number, y: number): P3 {
  const w = frame.at(s, offset);
  return [w.x, y, w.z];
}

/**
 * A truss, suspension or cantilever girder as an open frame: its simple
 * form (`ribProfile`: straight chords to the towers, a sag between them)
 * as one chord CHORD_DEPTH deep on the deck edge, a post every
 * FRAME_POST_EVERY stations and a tower where it peaks — no diagonals. The
 * Blaues Wunder's silhouette at the abstraction of the buildings; a solid
 * fin read as a dark tent, the measured rise as waves.
 */
function addFrame(acc: Mesh3, frame: BridgeFrame, rib: BridgeRib): void {
  const rise = ribProfile(rib.rise);
  const top = (i: number) => frame.line[i] + rise[i];
  const low = (i: number) => Math.max(frame.line[i], top(i) - CHORD_DEPTH);
  for (const [i0, i1] of ribRuns(rise)) {
    addBand(acc, frame, rib.offset, { from: i0, to: i1, top, low });
    for (let i = i0 + FRAME_POST_EVERY; i < i1; i += FRAME_POST_EVERY) {
      addFramePost(acc, frame, rib.offset, i, low(i), POST_HALF);
    }
  }
  for (const i of ribPeaks(rib.rise)) {
    addFramePost(acc, frame, rib.offset, i, top(i), FIN_HALF);
  }
}

/** A post on the deck edge from the deck up to `y`. */
function addFramePost(
  acc: Mesh3,
  frame: BridgeFrame,
  offset: number,
  i: number,
  y: number,
  half: number
): void {
  const s = i * BRIDGE_STEP;
  if (y - frame.line[i] > 0.5) {
    addStrut(
      acc,
      point(frame, s, offset, frame.line[i]),
      point(frame, s, offset, y),
      half
    );
  }
}

/**
 * A band 2·FIN_HALF thick along the axis between stations `from` and `to`,
 * from `low(i)` up to `top(i)`: its two sides, top and underside, and its
 * two ends.
 */
function addBand(
  acc: Mesh3,
  frame: BridgeFrame,
  offset: number,
  band: {
    from: number;
    to: number;
    top: (i: number) => number;
    low: (i: number) => number;
  }
): void {
  const { from, to, top, low } = band;
  const at = (i: number, side: number, y: number): P3 =>
    point(frame, i * BRIDGE_STEP, offset + side * FIN_HALF, y);
  const lateral = (i: number): P3 => {
    const p0 = frame.at(i * BRIDGE_STEP, 0);
    const p1 = frame.at(i * BRIDGE_STEP, 1);
    return [p1.x - p0.x, 0, p1.z - p0.z];
  };
  for (let i = from; i < to; i++) {
    const n = lateral(i);
    for (const side of [1, -1]) {
      quad(
        acc,
        at(i, side, low(i)),
        at(i + 1, side, low(i + 1)),
        at(i + 1, side, top(i + 1)),
        at(i, side, top(i)),
        [n[0] * side, 0, n[2] * side]
      );
    }
    for (const [y, sign] of [
      [top, 1],
      [low, -1],
    ] as const) {
      const a0 = at(i, 1, y(i));
      const a1 = at(i + 1, 1, y(i + 1));
      const along: P3 = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
      const up = unit(cross(n, along));
      const flip = up[1] < 0 ? -sign : sign;
      quad(acc, a0, a1, at(i + 1, -1, y(i + 1)), at(i, -1, y(i)), [
        up[0] * flip,
        up[1] * flip,
        up[2] * flip,
      ]);
    }
  }
  for (const [i, dir] of [
    [from, -1],
    [to, 1],
  ] as const) {
    const p0 = frame.at(i * BRIDGE_STEP, 0);
    const p1 = frame.at(i * BRIDGE_STEP + dir, 0);
    quad(
      acc,
      at(i, 1, low(i)),
      at(i, -1, low(i)),
      at(i, -1, top(i)),
      at(i, 1, top(i)),
      [p1.x - p0.x, 0, p1.z - p0.z]
    );
  }
}

/**
 * A steel arch through a measured rib: the fitted parabola from springing
 * to springing, hangers down to the deck where it rises above it, posts up
 * to the deck's underside where it runs below.
 */
function addArchRib(
  acc: Mesh3,
  frame: BridgeFrame,
  offset: number,
  arch: { fit: Parabola; from: number; to: number },
  depth: number
): void {
  const { fit, from, to } = arch;
  const y = (s: number) => fit.a * s * s + fit.b * s + fit.c;
  const n = Math.max(2, Math.ceil((to - from) / BRIDGE_STEP));
  const s = (k: number) => from + ((to - from) * k) / n;
  for (let k = 0; k < n; k++) {
    addStrut(
      acc,
      point(frame, s(k), offset, y(s(k))),
      point(frame, s(k + 1), offset, y(s(k + 1))),
      ARCH_HALF
    );
  }
  for (let k = HANGER_EVERY; k < n; k += HANGER_EVERY) {
    const at = s(k);
    const deck = frame.deckAt(at);
    const archY = y(at);
    if (archY > deck + 0.5) {
      addStrut(
        acc,
        point(frame, at, offset, deck),
        point(frame, at, offset, archY),
        HANGER_HALF
      );
    } else if (archY < deck - depth - 0.5) {
      addStrut(
        acc,
        point(frame, at, offset, archY),
        point(frame, at, offset, deck - depth),
        POST_HALF
      );
    }
  }
}

/**
 * Pylons where a non-arch rib peaks (the Blaues Wunder's towers): the
 * frame draws the tower; beneath each a river pier, between two ribs a
 * portal. Returns whether there were any: then the pylons carry the deck
 * and no other piers are drawn.
 */
function addPylons(
  out: BridgeMeshes,
  frame: BridgeFrame,
  ribs: readonly BridgeRib[],
  depth: number
): boolean {
  const peaks = ribs.map((rib) => ribPeaks(rib.rise));
  if (peaks.every((p) => p.length === 0)) {
    return false;
  }
  ribs.forEach((rib, r) => {
    for (const i of peaks[r]) {
      addPierAt(
        out.stone,
        frame,
        i * BRIDGE_STEP,
        rib.offset,
        depth,
        PYLON_PIER_HALF
      );
    }
  });
  // portals between the first two ribs' matching pylons
  if (ribs.length >= 2) {
    for (const i of peaks[0]) {
      const j = peaks[1].find((k) => Math.abs(k - i) <= 3);
      if (j !== undefined) {
        const y =
          Math.min(
            frame.line[i] + ribs[0].rise[i],
            frame.line[j] + ribs[1].rise[j]
          ) - 1.5;
        addStrut(
          out.steel,
          point(frame, i * BRIDGE_STEP, ribs[0].offset, y),
          point(frame, j * BRIDGE_STEP, ribs[1].offset, y),
          PORTAL_HALF
        );
      }
    }
  }
  return true;
}

/** A pier from the ground up to the deck's underside at a station. */
function addPierAt(
  acc: Mesh3,
  frame: BridgeFrame,
  s: number,
  offset: number,
  depth: number,
  half: number
): void {
  const under = frame.deckAt(s) - depth;
  const ground = frame.groundAt(s, offset);
  if (ground === null || under - ground < PIER_MIN_GAP) {
    return;
  }
  const w = frame.at(s, offset);
  addColumn(acc, w.x, w.z, ground, under, half);
}

/** Drops box piers from the deck underside to terrain along the deck's long axis,
 *  placed even over the river by interpolating ground between the abutments. */
function addPiers(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  ctx: RailContext,
  depth: number
): void {
  // Long axis = farthest-apart ring vertices (the two abutment ends).
  let ai = 0;
  let bi = 1;
  let bd = -1;
  for (let i = 0; i < ring.pts.length; i++) {
    for (let j = i + 1; j < ring.pts.length; j++) {
      const d =
        (ring.pts[i].x - ring.pts[j].x) ** 2 +
        (ring.pts[i].z - ring.pts[j].z) ** 2;
      if (d > bd) {
        bd = d;
        ai = i;
        bi = j;
      }
    }
  }
  const a = ring.pts[ai];
  const b = ring.pts[bi];
  const groundEnd = (p: { x: number; z: number }) => {
    const e = worldToEpsg(p, ctx.offset);
    return ctx.heightAt(e.x, e.y);
  };
  const ga = groundEnd(a) ?? Math.min(...topY) - depth - 4;
  const gb = groundEnd(b) ?? Math.min(...topY) - depth - 4;
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.floor(span / PIER_SPACING);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const px = a.x + (b.x - a.x) * t;
    const pz = a.z + (b.z - a.z) * t;
    const deckUnder = topY[ai] + (topY[bi] - topY[ai]) * t - depth;
    const e = worldToEpsg({ x: px, z: pz }, ctx.offset);
    const ground = ctx.heightAt(e.x, e.y) ?? ga + (gb - ga) * t;
    if (deckUnder - ground < PIER_MIN_GAP) {
      continue;
    }
    addColumn(acc, px, pz, ground, deckUnder, PIER_HALF);
  }
}

/** A spandrel wall or vault is cut into pieces about this long (m). */
const WALL_STEP = 1;

/**
 * A masonry arch bridge (structure `arch` without a measured steel arch):
 * arches between piers of real thickness (`masonryArches`). The deck's own
 * side edges are carried down as spandrel walls — to the arch under them,
 * to the pier top over a pier — each a vault across the deck underneath,
 * so the bridge is closed from below and from the side. The walls hang
 * from the ring's edges — the deck's real outline and slope — so nothing
 * stands off the deck. False when no bay clears its ground (a low bridge
 * keeps its box piers).
 */
function addMasonry(
  acc: Mesh3,
  frame: BridgeFrame,
  deck: { ring: Ring2; topY: number[]; depth: number }
): boolean {
  const { spans, piers } = masonryArches(
    frame.length,
    (s) => frame.groundAt(s, 0),
    (s) => frame.deckAt(s) - deck.depth
  );
  if (spans.length === 0) {
    return false;
  }
  const { ring, topY, depth } = deck;
  const across = endEdges(ring, frame.ringS);
  const under = (s: number) => {
    const span = spans.find((sp) => s >= sp.from && s <= sp.to);
    if (span) {
      return intradosAt(span, s);
    }
    const pier = piers.find((p) => Math.abs(s - p.s) <= MASONRY_PIER_HALF);
    return pier ? pier.top : null;
  };
  for (let i = 0; i < ring.pts.length; i++) {
    if (!across[i]) {
      addSpandrel(acc, ring, i, {
        s0: frame.ringS[i],
        s1: frame.ringS[(i + 1) % ring.pts.length],
        y0: topY[i] - depth,
        y1: topY[(i + 1) % ring.pts.length] - depth,
        under,
      });
    }
  }
  for (const span of spans) {
    addVault(acc, frame, span);
  }
  for (const pier of piers) {
    addMasonryPier(acc, frame, pier);
  }
  return true;
}

/** One ring edge's spandrel wall, from the fascia's foot down to the arch
 *  or pier under it, in WALL_STEP pieces (nothing where neither is), with
 *  an inner face too: seen through an arch the far wall is not hollow. */
function addSpandrel(
  acc: Mesh3,
  ring: Ring2,
  i: number,
  edge: {
    s0: number;
    s1: number;
    y0: number;
    y1: number;
    under: (s: number) => number | null;
  }
): void {
  const { pts } = ring;
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const [nx, nz] = outward(pts, i, ringWinding(pts));
  const n = Math.max(
    1,
    Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / WALL_STEP)
  );
  const at = (k: number) => {
    const t = k / n;
    const s = edge.s0 + (edge.s1 - edge.s0) * t;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      top: edge.y0 + (edge.y1 - edge.y0) * t,
      bottom: edge.under(s),
    };
  };
  for (let k = 0; k < n; k++) {
    const p = at(k);
    const q = at(k + 1);
    if (p.bottom === null || q.bottom === null) {
      continue;
    }
    const face: [P3, P3, P3, P3] = [
      [p.x, p.top, p.z],
      [q.x, q.top, q.z],
      [q.x, Math.min(q.bottom, q.top), q.z],
      [p.x, Math.min(p.bottom, p.top), p.z],
    ];
    quad(acc, ...face, [nx, 0, nz]);
    quad(acc, ...face, [-nx, 0, -nz]);
  }
}

/** The underside of an arch: a barrel across the deck (its width at each
 *  station) following the intrados, facing down. */
function addVault(acc: Mesh3, frame: BridgeFrame, span: MasonrySpan): void {
  const n = Math.max(2, Math.ceil((span.to - span.from) / WALL_STEP));
  const row = (k: number) => {
    const s = span.from + ((span.to - span.from) * k) / n;
    const y = intradosAt(span, s) ?? span.spring;
    const { left, right } = frame.edgesAt(s);
    const l = frame.at(s, left);
    const r = frame.at(s, right);
    return { l: [l.x, y, l.z] as P3, r: [r.x, y, r.z] as P3 };
  };
  let prev = row(0);
  for (let k = 1; k <= n; k++) {
    const next = row(k);
    const across: P3 = [
      prev.l[0] - prev.r[0],
      prev.l[1] - prev.r[1],
      prev.l[2] - prev.r[2],
    ];
    const along: P3 = [
      next.r[0] - prev.r[0],
      next.r[1] - prev.r[1],
      next.r[2] - prev.r[2],
    ];
    const up = unit(cross(across, along));
    const down: P3 = up[1] > 0 ? [-up[0], -up[1], -up[2]] : up;
    // a row of no width (past the outline) has no face, and no normal
    if (Math.hypot(...down) > 0.5) {
      quad(acc, prev.r, prev.l, next.l, next.r, down);
    }
    prev = next;
  }
}

/** A pier across the whole deck: a box MASONRY_PIER_HALF either side of
 *  its station, from the ground up to its arches' springing. */
function addMasonryPier(
  acc: Mesh3,
  frame: BridgeFrame,
  pier: MasonryPier
): void {
  const { s, ground, top } = pier;
  const { left, right } = frame.edgesAt(s);
  if (top - ground < 0.3 || left - right < 1) {
    return;
  }
  const corner = (ds: number, off: number) => frame.at(s + ds, off);
  const c = [
    corner(-MASONRY_PIER_HALF, right),
    corner(MASONRY_PIER_HALF, right),
    corner(MASONRY_PIER_HALF, left),
    corner(-MASONRY_PIER_HALF, left),
  ];
  const cx = (c[0].x + c[2].x) / 2;
  const cz = (c[0].z + c[2].z) / 2;
  for (let k = 0; k < 4; k++) {
    const p = c[k];
    const q = c[(k + 1) % 4];
    const mx = (p.x + q.x) / 2 - cx;
    const mz = (p.z + q.z) / 2 - cz;
    quad(
      acc,
      [p.x, top, p.z],
      [q.x, top, q.z],
      [q.x, ground, q.z],
      [p.x, ground, p.z],
      [mx, 0, mz]
    );
  }
}

/** A draped area's triangle is split while the ground under it strays
 *  from its plane by more than DRAPE_TOLERANCE_M (m), down to DRAPE_M:
 *  the ground under a yard is not flat between its outline's corners. The
 *  tolerance is coarse on purpose — the class raster paints the yard on
 *  the ground under it anyway — so a tile's yards stay ~5·10⁴ triangles. */
const DRAPE_M = 6;
const DRAPE_TOLERANCE_M = 1;
/** A triangle longer than this (m) is split whatever its probes say: four
 *  probes can miss a passage under a deck. */
const DRAPE_PROBE_M = 48;

type XZ = { x: number; z: number };

/** A ring's points, its edges split to at most `step` apart. */
function densified(pts: readonly XZ[], step: number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) {
      out.push({
        x: a.x + ((b.x - a.x) * k) / n,
        z: a.z + ((b.z - a.z) * k) / n,
      });
    }
  }
  return out;
}

/**
 * An area draped on the ground (+ `raise`): its outline and holes
 * triangulated, each triangle split in four while the ground under it
 * strays from its plane (`DRAPE_TOLERANCE_M`, down to `DRAPE_M`), each
 * corner on the ground under it — then a fascia `drop` deep along the
 * outline, its top on the ground every DRAPE_M. Triangles whose middle
 * `skip`s (a rail deck: the tracks ride it, no ballast under them) are
 * left out, and so is their fascia. (Draped at the outline's corners
 * alone, a yard across an underpass spanned the passage with sloped
 * sheets from the embankment down to the street — the passage read as
 * closed.)
 */
function addDrapedArea(
  acc: Mesh3,
  rings: Ring2[],
  raise: number,
  drop: number,
  ctx: RailContext,
  skip: (x: number, z: number) => boolean
): void {
  const [outer, ...holes] = rings.map((r) => r.pts);
  if (!outer || outer.length < 3) {
    return;
  }
  const heights = new Map<number, number | null>();
  const yAt = (x: number, z: number): number | null => {
    // a 1/64 m lattice: shared corners and midpoints are sampled once
    const key = Math.round(x * 64) * 2 ** 26 + Math.round(z * 64) + 2 ** 25;
    let y = heights.get(key);
    if (y === undefined) {
      const e = worldToEpsg({ x, z }, ctx.offset);
      const g = ctx.heightAt(e.x, e.y);
      y = g === null ? null : g + raise;
      heights.set(key, y);
    }
    return y;
  };
  const mid = (p: XZ, q: XZ): XZ => ({
    x: (p.x + q.x) / 2,
    z: (p.z + q.z) / 2,
  });
  const flat = (a: XZ, b: XZ, c: XZ): boolean => {
    const ya = yAt(a.x, a.z);
    const yb = yAt(b.x, b.z);
    const yc = yAt(c.x, c.z);
    if (ya === null || yb === null || yc === null) {
      return true;
    }
    // the plane through the corners against the ground at the edge
    // midpoints and the centre
    const probes: [XZ, number][] = [
      [mid(a, b), (ya + yb) / 2],
      [mid(b, c), (yb + yc) / 2],
      [mid(c, a), (yc + ya) / 2],
      [
        { x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 },
        (ya + yb + yc) / 3,
      ],
    ];
    return probes.every(([p, plane]) => {
      const y = yAt(p.x, p.z);
      return y === null || Math.abs(y - plane) <= DRAPE_TOLERANCE_M;
    });
  };
  const emit = (a: XZ, b: XZ, c: XZ) => {
    if (skip((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) {
      return;
    }
    const ya = yAt(a.x, a.z);
    const yb = yAt(b.x, b.z);
    const yc = yAt(c.x, c.z);
    if (ya !== null && yb !== null && yc !== null) {
      pushTri(acc, a.x, ya, a.z, b.x, yb, b.z, c.x, yc, c.z, 0, 1, 0);
    }
  };
  const drape = (a: XZ, b: XZ, c: XZ) => {
    const longest = Math.max(
      Math.hypot(b.x - a.x, b.z - a.z),
      Math.hypot(c.x - b.x, c.z - b.z),
      Math.hypot(a.x - c.x, a.z - c.z)
    );
    if (longest <= DRAPE_M || (longest <= DRAPE_PROBE_M && flat(a, b, c))) {
      emit(a, b, c);
      return;
    }
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    drape(a, ab, ca);
    drape(ab, b, bc);
    drape(ca, bc, c);
    drape(ab, bc, ca);
  };
  const all = [outer, ...holes].flat();
  const tris = ShapeUtils.triangulateShape(
    outer.map((p) => new Vector2(p.x, p.z)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.z)))
  );
  for (const [ia, ib, ic] of tris) {
    drape(all[ia], all[ib], all[ic]);
  }
  // the fascia along the outline and round the holes, facing out of the
  // area, its top on the ground every DRAPE_M
  for (const [k, raw] of [outer, ...holes].entries()) {
    const ring = densified(raw, DRAPE_M);
    const winding = (ringWinding(ring) * (k === 0 ? 1 : -1)) as 1 | -1;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const yp = yAt(p.x, p.z);
      const yq = yAt(q.x, q.z);
      if (
        yp === null ||
        yq === null ||
        skip((p.x + q.x) / 2, (p.z + q.z) / 2)
      ) {
        continue;
      }
      const [nx, nz] = outward(ring, i, winding);
      quad(
        acc,
        [p.x, yp, p.z],
        [q.x, yq, q.z],
        [q.x, yq - drop, q.z],
        [p.x, yp - drop, p.z],
        [nx, 0, nz]
      );
    }
  }
}

/** Every polygon of an area as its rings (outer first, then its holes). */
function polygonsOf(
  geometry: AreaFeature["geometry"] | null | undefined
): [number, number][][][] {
  if (geometry?.type === "Polygon") {
    return geometry.coordinates.length > 0 ? [geometry.coordinates] : [];
  }
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates.filter((poly) => poly.length > 0);
  }
  return [];
}

/**
 * One merged ballast surface from the dissolved railway-area polygons
 * (Polygon or MultiPolygon — a yard dissolved into several parts), draped
 * on the ground (`addDrapedArea`) and left out on the rail decks, where
 * the tracks ride the deck. Exported for tests.
 */
export function buildBallast(
  features: AreaFeature[],
  ctx: RailContext,
  decks: DeckPoly[] = []
): Mesh | null {
  const acc = mesh3();
  const onDeck = (x: number, z: number) =>
    decksAt(decks, x, z, RIDES.rail, "decks").length > 0;
  for (const f of features) {
    for (const rings of polygonsOf(f.geometry)) {
      addDrapedArea(
        acc,
        rings.map((r) => ringToWorld(r, ctx.offset)),
        BALLAST_RAISE,
        BALLAST_DROP,
        ctx,
        onDeck
      );
    }
  }
  return meshFrom(acc, COLORS.ballast, {
    cast: false,
    offsetUnits: -2,
    roughness: 1,
  });
}

/** A line on the ground rides an approach ramp up to its deck while the
 *  ramp stays this close above the ground (m) — not one passing over it,
 *  far above (a track under a deck's end). */
const APPROACH_RIDE_M = 1.5;

/**
 * The level of every sample of a line (lib/city/levels.ts): the build
 * step's runs (`lv`, scripts/line-levels.ts) where the feature has them,
 * else solved over this piece alone. On the ground a sample still rides
 * an approach ramp close above it; on a deck it rides the deck top
 * nearest the run's line. Null where the ground is unknown and no level
 * holds it (the line breaks there).
 */
export function lineLevelsAt(
  pts: readonly Point2[],
  line: LevelLine,
  runs: readonly LevelRun[] | undefined,
  ctx: GroundContext,
  decks: DeckPoly[],
  prefer?: "deck" | "ground"
): (Level | null)[] {
  const d: number[] = [];
  const ground: (number | null)[] = [];
  const under: number[][] = [];
  const ramps: number[][] = [];
  pts.forEach(([ex, ey], i) => {
    d.push(
      i === 0
        ? 0
        : d[i - 1] + Math.hypot(ex - pts[i - 1][0], ey - pts[i - 1][1])
    );
    ground.push(ctx.heightAt(ex, ey));
    const w = epsgToWorld(ex, ey, ctx.offset);
    under.push(decksAt(decks, w.x, w.z, RIDES[line], "decks", DECK_REACH_M));
    ramps.push(decksAt(decks, w.x, w.z, RIDES[line], "ramps"));
  });
  const solved = runs
    ? pts.map((_, i) => runLevelAt(runs, d, i))
    : lineLevels(
        pts.map((_, i) => ({ d: d[i], ground: ground[i], decks: under[i] })),
        { grade: LEVEL_GRADE[line], prefer }
      ).map((l) => (l?.mode === "ground" ? null : l));
  return solved.map((level, i) => {
    if (level?.mode === "deck") {
      const near = under[i].reduce<number | null>(
        (best, y) =>
          best === null || Math.abs(y - level.y) < Math.abs(best - level.y)
            ? y
            : best,
        null
      );
      return { mode: "deck", y: near ?? level.y };
    }
    if (level) {
      return level;
    }
    const g = ground[i];
    if (g === null) {
      return null;
    }
    const ramp = ramps[i].find((y) => y - g < APPROACH_RIDE_M);
    return ramp === undefined
      ? { mode: "ground", y: g }
      : { mode: "deck", y: Math.max(ramp, g) };
  });
}

/** A span's deck reaches this far past its outermost track (m). */
const SPAN_SHOULDER_M = 0.9;
/** The tallest a span's deck stands above the ground before piers carry
 *  it (m), and their spacing along it. */
const SPAN_PIER_GAP_M = PIER_MIN_GAP;

/**
 * The deck under a span (lib/city/levels.ts "span": a gap in the DGM the
 * line crosses where no baked deck is — a viaduct the outlines miss, a
 * bridge longer than its outline): a slab `half` wide either side of the
 * line, its top `top` metres under the line's level, the fascia and
 * underside in stone, a pier every PIER_SPACING where it clears the
 * ground. Drawn only where the slab is above the ground: a span a hand
 * over its gap needs none.
 */
export function addSpanDeck(
  top: Mesh3,
  stone: Mesh3,
  pts: readonly Pt[],
  half: number,
  ctx: GroundContext
): void {
  if (pts.length < 2) {
    return;
  }
  const tan = tangentsXZ(pts as Pt[]);
  const side = (sign: number) =>
    pts.map((p, i) => ({
      x: p.x - tan[i].y * half * sign,
      z: p.z + tan[i].x * half * sign,
    }));
  const left = side(1);
  const right = side(-1).reverse();
  const ring = { pts: [...left, ...right], cx: 0, cz: 0 };
  const topY = [...pts.map((p) => p.y), ...[...pts].reverse().map((p) => p.y)];
  // the top in the deck's colour, the rest in stone
  addFootprint(top, ring, topY, 0);
  addFootprint(stone, ring, topY, DECK_DEPTH, true);
  let run = 0;
  let next = PIER_SPACING / 2;
  for (let i = 1; i < pts.length; i++) {
    run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (run < next || i === pts.length - 1) {
      continue;
    }
    next += PIER_SPACING;
    const p = pts[i];
    const e = worldToEpsg({ x: p.x, z: p.z }, ctx.offset);
    const g = ctx.heightAt(e.x, e.y);
    const under = p.y - DECK_DEPTH;
    if (g !== null && under - g > SPAN_PIER_GAP_M) {
      addColumn(stone, p.x, p.z, g - SINK.wall, under, PIER_HALF);
    }
  }
}

/** The spans of a line's levels as runs of points, each with its rims
 *  (the samples either side, where the span meets the ground or a deck). */
export function spanRuns<P>(
  levels: readonly (Level | null)[],
  pts: readonly P[]
): P[][] {
  return modeRuns(levels, "span").map(([a, b]) =>
    pts.slice(Math.max(a - 1, 0), Math.min(b + 2, pts.length))
  );
}

/** Steel rails: one pair per track, on the level their line runs on
 *  (`lineLevelsAt`): the ground, a rail deck, a span (with its deck). */
function buildRails(
  features: RailFeature[],
  ctx: RailContext,
  decks: DeckPoly[],
  spans: { stone: Mesh3; top: Mesh3 }
): Mesh | null {
  const acc = mesh3();
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const tracks = Math.min(Math.max(f.properties?.tracks ?? 1, 1), 3);
    const dense = subdividePolyline(f.geometry.coordinates, SAMPLE_M);
    const levels = lineLevelsAt(dense, "rail", f.properties?.lv, ctx, decks);
    const drawn = dense.map(([ex, ey], i): Pt | null => {
      const level = levels[i];
      if (!level) {
        return null;
      }
      const w = epsgToWorld(ex, ey, ctx.offset);
      const raise = level.mode === "deck" ? RAIL_DECK_RAISE : RAIL_RAISE;
      return { x: w.x, y: level.y + raise, z: w.z };
    });
    // Split into runs of points with a level (never bridge a NoData gap).
    let run: Pt[] = [];
    const flush = () => {
      if (run.length >= 2) {
        for (let tk = 0; tk < tracks; tk++) {
          const center = (tk - (tracks - 1) / 2) * TRACK_PITCH;
          addRail(acc, run, center + GAUGE / 2);
          addRail(acc, run, center - GAUGE / 2);
        }
      }
      run = [];
    };
    for (const p of drawn) {
      if (p) {
        run.push(p);
      } else {
        flush();
      }
    }
    flush();
    const half = ((tracks - 1) / 2) * TRACK_PITCH + GAUGE / 2 + SPAN_SHOULDER_M;
    for (const span of spanRuns(levels, drawn)) {
      // a line near a seam is in both tiles' files: the span's owner
      // draws its deck
      const pts = span.filter((p): p is Pt => p !== null);
      const centre = pts[Math.floor(pts.length / 2)];
      const e = centre
        ? worldToEpsg({ x: centre.x, z: centre.z }, ctx.offset)
        : null;
      if (e && (!ctx.owns || ctx.owns(e.x, e.y))) {
        addSpanDeck(
          spans.top,
          spans.stone,
          pts.map((p) => ({ ...p, y: p.y - RAIL_RAISE + BALLAST_RAISE })),
          half,
          ctx
        );
      }
    }
  }
  return meshFrom(acc, COLORS.rail, {
    cast: false,
    offsetUnits: -1,
    roughness: 0.5,
  });
}

/** Station platforms: flat slabs raised above ground (polygons + line ribbons). */
function buildPlatforms(
  features: AreaFeature[],
  ctx: RailContext
): Mesh | null {
  const acc = mesh3();
  for (const f of features) {
    const g = f.geometry;
    if (g?.type === "Polygon" || g?.type === "MultiPolygon") {
      for (const outer of outerRings(g)) {
        const ring = ringToWorld(outer, ctx.offset);
        const topY = clampRing(ring, PLATFORM_H, ctx);
        if (topY) {
          addFootprint(acc, ring, topY, PLATFORM_H);
        }
      }
    } else if (g?.type === "LineString") {
      const run: Pt[] = [];
      for (const [ex, ey] of subdividePolyline(g.coordinates, SAMPLE_M)) {
        const ground = ctx.heightAt(ex, ey);
        if (ground !== null) {
          const w = epsgToWorld(ex, ey, ctx.offset);
          run.push({ x: w.x, y: ground + PLATFORM_H, z: w.z });
        }
      }
      addRail(acc, run, 0); // a thin slab ribbon for line-mapped platforms
    }
  }
  return meshFrom(acc, COLORS.platform, { cast: true });
}

/**
 * Builds the WHOLE tile block's rails, bridges, ballast and platforms (one
 * call, cross-tile heightAt) as stylized geometry on the Y-up scene. Bridges
 * build first so the rails can ride their decks. Empty inputs yield an empty
 * group; the group is freed with the scene (disposeObject3D).
 */
export function buildRail(features: RailFeatures, ctx: RailContext): Group {
  const group = new Group();
  group.name = "rail";

  const decks = buildDeckTable(features.bridges, ctx);
  const bridgeMeshes = buildBridges(features.bridges, ctx, decks);
  // what the inquiry probe raycasts for a bridge (bridge-ask.ts)
  for (const mesh of bridgeMeshes) {
    mesh.userData.bridge = true;
  }
  // add() with no arguments logs a three error, so guard the spread.
  if (bridgeMeshes.length > 0) {
    group.add(...bridgeMeshes);
  }
  const ballast = buildBallast(features.ballast, ctx, decks);
  if (ballast) {
    group.add(ballast);
  }
  const spans = { top: mesh3(), stone: mesh3() };
  const rails = buildRails(features.rails, ctx, decks, spans);
  if (rails) {
    group.add(rails);
  }
  const spanTop = meshFrom(spans.top, COLORS.deckRail, { cast: true });
  const spanStone = meshFrom(spans.stone, COLORS.deckStone, { cast: true });
  for (const m of [spanTop, spanStone]) {
    if (m) {
      group.add(m);
    }
  }
  const platforms = buildPlatforms(features.platforms, ctx);
  if (platforms) {
    group.add(platforms);
  }
  return group;
}
