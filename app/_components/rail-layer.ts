import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
} from "three";
import type {
  AreaFeature,
  BridgeFeature,
  RailFeature,
} from "@/lib/city/features";
import {
  archFits,
  archSpringing,
  axisFrame,
  BRIDGE_STEP,
  type BridgeRib,
  intradosAt,
  type MasonrySpan,
  masonrySpans,
  type Parabola,
  PIER_SPACING,
  pierStations,
  placeRibs,
  ribPeaks,
  ribProfile,
  ribRuns,
} from "@/lib/city/bridge";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { subdividePolyline } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

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
  heightFog?: HeightFogUniforms;
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

const SAMPLE_M = 4; // densify polylines to this spacing (m)
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

/** The heavy rails ride only rail decks (a road bridge over a railway is
 *  not what the train runs on). */
const RAIL_DECKS = ["rail"] as const;

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

export function quad(acc: Mesh3, p0: P3, p1: P3, p2: P3, p3: P3, n: P3): void {
  pushTri(acc, ...p0, ...p1, ...p2, ...n);
  pushTri(acc, ...p0, ...p2, ...p3, ...n);
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

function material(
  color: number,
  heightFog?: HeightFogUniforms,
  opts: MatOpts = {}
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(color),
    roughness: opts.roughness ?? 0.95,
  });
  if (opts.offsetUnits) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = opts.offsetUnits;
  }
  if (heightFog) {
    m.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  return m;
}

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
 * Triangulates a footprint into a top face at per-vertex `topY` plus a continuous
 * outward-facing fascia dropping `depth` — one solid slab volume, not stacked
 * planes. Used for ballast areas, bridge decks, and platforms.
 */
export function addFootprint(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  depth: number
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
  ring: { x: number; z: number }[];
}

function pointInRing(
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
 * The deck Y to lift a point onto, or null off every deck. `kinds` limits
 * the decks considered (the heavy rails ride only rail decks).
 */
export function deckLift(
  decks: DeckPoly[],
  x: number,
  z: number,
  kinds?: readonly string[]
): number | null {
  for (const d of decks) {
    if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) {
      continue;
    }
    if (kinds && !kinds.includes(d.kind)) {
      continue;
    }
    if (pointInRing(d.ring, x, z)) {
      const l2 = d.ax * d.ax + d.az * d.az;
      const t = l2 > 0 ? ((x - d.a.x) * d.ax + (z - d.a.z) * d.az) / l2 : 0;
      return profileAt(d.profile, t);
    }
  }
  return null;
}

/** One deck's lift entry from its world ring and per-vertex deck tops. */
function deckPoly(
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

/**
 * The lift table of every bridge deck (all kinds), from the same baked
 * features the decks are built from. Shared with the tram layer.
 */
export function buildDeckTable(
  features: BridgeFeature[],
  offset: { cx: number; cy: number }
): DeckPoly[] {
  const decks: DeckPoly[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Polygon" || !f.geometry.coordinates[0]) {
      continue;
    }
    const ring = ringToWorld(f.geometry.coordinates[0], offset);
    const { deck, kind } = bridgeProps(f);
    if (ring.pts.length < 3 || deck.length < ring.pts.length) {
      continue;
    }
    decks.push(deckPoly(ring.pts, deck.slice(0, ring.pts.length), kind));
  }
  return decks;
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
    // top
    quad(
      acc,
      [left[i].x, left[i].y, left[i].z],
      [right[i].x, right[i].y, right[i].z],
      [right[i + 1].x, right[i + 1].y, right[i + 1].z],
      [left[i + 1].x, left[i + 1].y, left[i + 1].z],
      [0, 1, 0]
    );
    if (web <= 0) {
      continue;
    }
    // web on each side (outward normal via the tangent perpendicular)
    const nx = -tan[i].y;
    const nz = tan[i].x;
    quad(
      acc,
      [left[i].x, left[i].y, left[i].z],
      [left[i + 1].x, left[i + 1].y, left[i + 1].z],
      [left[i + 1].x, left[i + 1].y - web, left[i + 1].z],
      [left[i].x, left[i].y - web, left[i].z],
      [nx, 0, nz]
    );
    quad(
      acc,
      [right[i].x, right[i].y, right[i].z],
      [right[i + 1].x, right[i + 1].y, right[i + 1].z],
      [right[i + 1].x, right[i + 1].y - web, right[i + 1].z],
      [right[i].x, right[i].y - web, right[i].z],
      [-nx, 0, -nz]
    );
  }
}

export function meshFrom(
  acc: Mesh3,
  color: number,
  heightFog: HeightFogUniforms | undefined,
  opts: { cast: boolean; offsetUnits?: number; roughness?: number }
): Mesh | null {
  const geo = finishGeo(acc);
  if (!geo) {
    return null;
  }
  const m = new Mesh(
    geo,
    material(color, heightFog, {
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

/** The meshes a bridge is drawn into. */
interface BridgeMeshes {
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
  addFootprint(out.tops[kind] ?? out.tops.other, ring, topY, depth);
  const frame = bridgeFrame(f, ctx);
  addParapetWalls(out.stone, ring, topY, frame?.ringS);
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
function buildBridges(features: BridgeFeature[], ctx: RailContext): Mesh[] {
  const out: BridgeMeshes = {
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
    const m = meshFrom(out.tops[kind], topColor[kind], ctx.heightFog, {
      cast: true,
    });
    if (m) {
      meshes.push(m);
    }
  }
  const stoneMesh = meshFrom(out.stone, COLORS.deckStone, ctx.heightFog, {
    cast: true,
  });
  if (stoneMesh) {
    meshes.push(stoneMesh);
  }
  const steelMesh = meshFrom(out.steel, COLORS.steel, ctx.heightFog, {
    cast: true,
  });
  if (steelMesh) {
    meshes.push(steelMesh);
  }
  return meshes;
}

// --- the measured bridge (ADR 0030) -------------------------------------------------

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
  return {
    length: axis.length,
    line,
    edges: {
      left: Math.max(0, ...offsets),
      right: Math.min(0, ...offsets),
    },
    ringS: onAxis.map((p) => p.s),
    edgesAt: (s) => ringEdgesAt(onAxis, s) ?? { left: 0, right: 0 },
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
    addFramePost(acc, frame, rib.offset, i, top(i), PYLON_HALF);
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

/** The two farthest-apart ring vertices (the deck's abutment ends) + their span. */
function longAxis(pts: { x: number; z: number }[]): {
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

/** Half the thickness of a masonry pier along the axis (m). */
const MASONRY_PIER_HALF = 1.2;
/** A spandrel wall is cut into pieces about this long along an edge (m). */
const WALL_STEP = 1;

/**
 * A masonry arch bridge (structure `arch` without a measured steel arch):
 * the deck's own side edges carried down as spandrel walls to the arches'
 * underside (`masonrySpans`), and a pier across the deck at each springing.
 * The walls hang from the ring's edges — the deck's real outline and
 * slope — so nothing stands off the deck. False when no span clears its
 * ground (a low bridge keeps its box piers).
 */
function addMasonry(
  acc: Mesh3,
  frame: BridgeFrame,
  deck: { ring: Ring2; topY: number[]; depth: number }
): boolean {
  const spans = masonrySpans(
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
    return span ? intradosAt(span, s) : null;
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
  for (const s of springings(spans, frame.length)) {
    addMasonryPier(acc, frame, s, spans);
  }
  return true;
}

/** One ring edge's spandrel wall, from the fascia's foot down to the arch
 *  under it, in WALL_STEP pieces (nothing where no arch is). */
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
    quad(
      acc,
      [p.x, p.top, p.z],
      [q.x, q.top, q.z],
      [q.x, Math.min(q.bottom, q.top), q.z],
      [p.x, Math.min(p.bottom, p.top), p.z],
      [nx, 0, nz]
    );
  }
}

/** The stations where an arch springs from a pier: every span end that is
 *  not an abutment. */
function springings(spans: readonly MasonrySpan[], length: number): number[] {
  const out = new Set<number>();
  for (const sp of spans) {
    for (const s of [sp.from, sp.to]) {
      if (s > 1 && s < length - 1) {
        out.add(Math.round(s * 100) / 100);
      }
    }
  }
  return [...out];
}

/** A pier across the whole deck at a springing: a box from the ground up
 *  to the higher springing there. */
function addMasonryPier(
  acc: Mesh3,
  frame: BridgeFrame,
  s: number,
  spans: readonly MasonrySpan[]
): void {
  const ground = frame.groundAt(s, 0);
  const top = Math.max(
    ...spans
      .filter(
        (sp) => Math.abs(sp.from - s) < 0.01 || Math.abs(sp.to - s) < 0.01
      )
      .map((sp) => sp.spring)
  );
  if (ground === null || top - ground < 0.5) {
    return;
  }
  const { left, right } = frame.edgesAt(s);
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
  quad(
    acc,
    [c[0].x, top, c[0].z],
    [c[1].x, top, c[1].z],
    [c[2].x, top, c[2].z],
    [c[3].x, top, c[3].z],
    [0, 1, 0]
  );
}

/**
 * One merged ballast surface from the dissolved railway-area polygons
 * (Polygon or MultiPolygon — a yard dissolved into several parts). Exported
 * for tests.
 */
export function buildBallast(
  features: AreaFeature[],
  ctx: RailContext
): Mesh | null {
  const acc = mesh3();
  for (const f of features) {
    for (const outer of outerRings(f.geometry)) {
      const ring = ringToWorld(outer, ctx.offset);
      const topY = clampRing(ring, BALLAST_RAISE, ctx);
      if (topY) {
        addFootprint(acc, ring, topY, BALLAST_DROP);
      }
    }
  }
  return meshFrom(acc, COLORS.ballast, ctx.heightFog, {
    cast: false,
    offsetUnits: -2,
    roughness: 1,
  });
}

/** Steel rails: one pair per track, draped on terrain / lifted onto rail decks. */
function buildRails(
  features: RailFeature[],
  ctx: RailContext,
  decks: DeckPoly[]
): Mesh | null {
  const acc = mesh3();
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const tracks = Math.min(Math.max(f.properties?.tracks ?? 1, 1), 3);
    const dense = subdividePolyline(f.geometry.coordinates, SAMPLE_M);
    // Split into runs of points with valid ground (never bridge a NoData gap).
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
    for (const [ex, ey] of dense) {
      const ground = ctx.heightAt(ex, ey);
      const w = epsgToWorld(ex, ey, ctx.offset);
      const lift = deckLift(decks, w.x, w.z, RAIL_DECKS);
      if (lift !== null) {
        run.push({ x: w.x, y: lift + RAIL_DECK_RAISE, z: w.z });
      } else if (ground === null) {
        flush();
      } else {
        run.push({ x: w.x, y: ground + RAIL_RAISE, z: w.z });
      }
    }
    flush();
  }
  return meshFrom(acc, COLORS.rail, ctx.heightFog, {
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
  return meshFrom(acc, COLORS.platform, ctx.heightFog, { cast: true });
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

  const bridgeMeshes = buildBridges(features.bridges, ctx);
  const decks = buildDeckTable(features.bridges, ctx.offset);
  // add() with no arguments logs a three error, so guard the spread.
  if (bridgeMeshes.length > 0) {
    group.add(...bridgeMeshes);
  }
  const ballast = buildBallast(features.ballast, ctx);
  if (ballast) {
    group.add(ballast);
  }
  const rails = buildRails(features.rails, ctx, decks);
  if (rails) {
    group.add(rails);
  }
  const platforms = buildPlatforms(features.platforms, ctx);
  if (platforms) {
    group.add(platforms);
  }
  return group;
}
