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
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { subdividePolyline } from "@/lib/city/polyline";
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
const PIER_SPACING = 26; // distance between bridge piers (m)
const PIER_MIN_GAP = 2.5; // only pier where the deck clears the ground by this (m)
const PIER_HALF = 0.65; // pier column half-width (m)
const PLATFORM_H = 0.55; // station platform height above ground (m)
const ARCH_SPAN_M = 26; // target span between arch piers (m)
const ARCH_MIN_RISE = 2.5; // min deck clearance to bother arching (else box piers)

/** The heavy rails ride only rail decks (a road bridge over a railway is
 *  not what the train runs on). */
const RAIL_DECKS = ["rail"] as const;

export const COLORS = {
  ballast: 0x9a_8f_85, // warm grey-brown crushed stone
  rail: 0x4a_4a_50, // dark weathered steel
  deckStone: 0xc6_c0_b4, // pale warm concrete/stone
  deckRoad: 0x6f_70_77, // asphalt
  deckPath: 0xc2_ad_8a, // pale sand
  platform: 0xcf_c9_bd, // pale platform concrete
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
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    let nx = pts[j].z - pts[i].z;
    let nz = -(pts[j].x - pts[i].x);
    const mx = (pts[i].x + pts[j].x) / 2 - ring.cx;
    const mz = (pts[i].z + pts[j].z) / 2 - ring.cz;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
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

/** A flush parapet: a vertical wall rising `height` from the deck edge (outward
 *  + inward faces + a thin top), starting exactly at the deck top so it reads as
 *  a wall on the deck, never a floating second deck. */
function addParapetWalls(acc: Mesh3, ring: Ring2, topY: number[]): void {
  const { pts } = ring;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    let nx = pts[j].z - pts[i].z;
    let nz = -(pts[j].x - pts[i].x);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    const mx = (pts[i].x + pts[j].x) / 2 - ring.cx;
    const mz = (pts[i].z + pts[j].z) / 2 - ring.cz;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
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
  ctx: GroundContext
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

/** A bridge feature's properties with defaults (`properties` may be null). */
function bridgeProps(f: BridgeFeature): {
  deck: number[];
  kind: NonNullable<NonNullable<BridgeFeature["properties"]>["kind"]>;
  structure: string;
} {
  return {
    deck: f.properties?.deck ?? [],
    kind: f.properties?.kind ?? "other",
    structure: f.properties?.structure ?? "",
  };
}

/** Builds the bridge decks (slab, parapets, piers or arches). */
function buildBridges(features: BridgeFeature[], ctx: GroundContext): Mesh[] {
  const tops: Record<string, Mesh3> = {
    rail: mesh3(),
    road: mesh3(),
    path: mesh3(),
    other: mesh3(),
  };
  const stone = mesh3(); // fascia + parapets + piers

  for (const f of features) {
    if (f.geometry?.type !== "Polygon" || !f.geometry.coordinates[0]) {
      continue;
    }
    const ring = ringToWorld(f.geometry.coordinates[0], ctx.offset);
    const { deck, kind, structure } = bridgeProps(f);
    if (ring.pts.length < 3 || deck.length < ring.pts.length) {
      continue;
    }
    const topY = ring.pts.map((_, i) => deck[i]);
    addFootprint(tops[kind] ?? tops.other, ring, topY, DECK_DEPTH);
    addParapetWalls(stone, ring, topY);
    // Arch bridges (OSM bridge:structure ~ "arch") get spandrel arches spanning
    // between piers; everything else gets plain box piers.
    if (structure.includes("arch") && addArches(stone, ring, topY, ctx)) {
      // arches placed their own piers
    } else {
      addPiers(stone, ring, topY, ctx);
    }
  }

  const meshes: Mesh[] = [];
  const topColor: Record<string, number> = {
    rail: COLORS.ballast,
    road: COLORS.deckRoad,
    path: COLORS.deckPath,
    other: COLORS.deckStone,
  };
  for (const kind of Object.keys(tops)) {
    const m = meshFrom(tops[kind], topColor[kind], {
      cast: true,
    });
    if (m) {
      meshes.push(m);
    }
  }
  const stoneMesh = meshFrom(stone, COLORS.deckStone, {
    cast: true,
  });
  if (stoneMesh) {
    meshes.push(stoneMesh);
  }
  return meshes;
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
  ctx: GroundContext
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
  const ga = groundEnd(a) ?? Math.min(...topY) - DECK_DEPTH - 4;
  const gb = groundEnd(b) ?? Math.min(...topY) - DECK_DEPTH - 4;
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.floor(span / PIER_SPACING);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const px = a.x + (b.x - a.x) * t;
    const pz = a.z + (b.z - a.z) * t;
    const deckUnder = topY[ai] + (topY[bi] - topY[ai]) * t - DECK_DEPTH;
    const e = worldToEpsg({ x: px, z: pz }, ctx.offset);
    const ground = ctx.heightAt(e.x, e.y) ?? ga + (gb - ga) * t;
    if (deckUnder - ground < PIER_MIN_GAP) {
      continue;
    }
    addColumn(acc, px, pz, ground, deckUnder, PIER_HALF);
  }
}

/**
 * Spandrel-arch treatment for arch bridges (OSM `bridge:structure ~ "arch"`):
 * along the deck's long axis, a vertical side wall on each edge whose BOTTOM
 * follows a row of segmental arch intrados (high at each crown, springing low at
 * the piers), carried on slim river piers. Reads as a masonry arch viaduct from
 * the side. Returns false (→ caller falls back to box piers) when the deck
 * doesn't clear the ground enough to be worth arching (a low/flat bridge).
 */
function addArches(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  ctx: GroundContext
): boolean {
  const { a, b, span } = longAxis(ring.pts);
  if (span < 16) {
    return false;
  }
  const axx = (b.x - a.x) / span;
  const axz = (b.z - a.z) / span;
  const pxu = -axz; // perpendicular unit
  const pzu = axx;
  let half = 0;
  for (const p of ring.pts) {
    half = Math.max(half, Math.abs((p.x - a.x) * pxu + (p.z - a.z) * pzu));
  }
  half = Math.max(half, 1.5);
  const groundAt = (x: number, z: number) => {
    const e = worldToEpsg({ x, z }, ctx.offset);
    return ctx.heightAt(e.x, e.y);
  };
  const deckUnder = Math.min(...topY) - DECK_DEPTH;
  const ga = groundAt(a.x, a.z) ?? deckUnder - 6;
  const gb = groundAt(b.x, b.z) ?? deckUnder - 6;
  const springY = Math.min(ga, gb) + 0.8;
  if (deckUnder - springY < ARCH_MIN_RISE) {
    return false;
  }
  const n = Math.min(Math.max(Math.round(span / ARCH_SPAN_M), 1), 8);
  const segLen = span / n;
  const rise = Math.min(segLen / 2, deckUnder - springY - 0.3);
  const edge = (t: number, side: number) => ({
    x: a.x + (b.x - a.x) * t + pxu * side * half,
    z: a.z + (b.z - a.z) * t + pzu * side * half,
  });
  const intrados = (frac: number) => {
    const dx = (frac - 0.5) * segLen;
    return springY + Math.sqrt(Math.max(0, rise * rise - dx * dx));
  };
  const M = 10;
  for (let k = 0; k < n; k++) {
    for (const side of [1, -1]) {
      for (let m = 0; m < M; m++) {
        const f0 = m / M;
        const f1 = (m + 1) / M;
        const A = edge((k + f0) / n, side);
        const B = edge((k + f1) / n, side);
        quad(
          acc,
          [A.x, deckUnder, A.z],
          [B.x, deckUnder, B.z],
          [B.x, intrados(f1), B.z],
          [A.x, intrados(f0), A.z],
          [pxu * side, 0, pzu * side]
        );
      }
    }
    // River pier under each springing point (skip the bank abutments at k=0).
    if (k > 0) {
      const t = k / n;
      const g =
        groundAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) ??
        ga + (gb - ga) * t;
      for (const side of [1, -1]) {
        const e = edge(t, side);
        addColumn(acc, e.x, e.z, g, springY + 0.3, PIER_HALF);
      }
    }
  }
  return true;
}

/**
 * One merged ballast surface from the dissolved railway-area polygons
 * (Polygon or MultiPolygon — a yard dissolved into several parts). Exported
 * for tests.
 */
export function buildBallast(
  features: AreaFeature[],
  ctx: GroundContext
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
  return meshFrom(acc, COLORS.ballast, {
    cast: false,
    offsetUnits: -2,
    roughness: 1,
  });
}

/** Steel rails: one pair per track, draped on terrain / lifted onto rail decks. */
function buildRails(
  features: RailFeature[],
  ctx: GroundContext,
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
  return meshFrom(acc, COLORS.rail, {
    cast: false,
    offsetUnits: -1,
    roughness: 0.5,
  });
}

/** Station platforms: flat slabs raised above ground (polygons + line ribbons). */
function buildPlatforms(
  features: AreaFeature[],
  ctx: GroundContext
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
export function buildRail(features: RailFeatures, ctx: GroundContext): Group {
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
