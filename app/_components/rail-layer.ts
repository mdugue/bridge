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
import { epsgToWorld } from "@/lib/city/ground-clamp";
import { fetchFeatures } from "./fetch-optional";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";
import { disposeObject3D } from "./three-utils";

/**
 * Railway + bridge layer. The railway corridor and bridges used to exist only as
 * a flat land-cover colour painted on the DGM (a brown smear; bridges sank into
 * the Elbe). This builds stylized geometry from the baked GeoJSONs
 * (scripts/extract-rail.sh), redesigned after the first pass z-fought into ragged
 * edges and stacked into "2-story" bridges:
 *
 *  - Ballast yards: ONE merged surface from the DISSOLVED Basis-DLM ver03_f area
 *    polygons (no per-line overlap → no z-fight). The recoloured class-5 splat
 *    sits underneath, so any sub-pixel gap reads as ballast, not a seam.
 *  - Rails: Basis-DLM ver03_l centrelines (heavy rail), built ONCE for the whole
 *    tile block on the cross-tile heightAt and split at NoData gaps, so tracks run
 *    continuously across tile seams instead of fragmenting.
 *  - Bridges: ONE clean slab volume per Basis-DLM ver06_f deck polygon (top +
 *    continuous fascia), flush parapet walls (no floating cap), piers dropped even
 *    over the river. Rails ride the deck directly (no ballast stacked on top).
 *  - Platforms: OSM railway=platform polygons (ODbL).
 *
 * All geometry is hand-wound to match its supplied normal (see pushTri), so every
 * material is FrontSide. Authored in Y-up world coords → added to `scene`.
 * Non-fatal: missing/empty inputs yield an empty group.
 */

// `properties` may be `null` in valid GeoJSON — every read goes through `?.`.
interface RailFeature {
  geometry: { coordinates: [number, number][]; type: "LineString" };
  properties: { electrified?: number; tracks?: number } | null;
}

interface BridgeFeature {
  geometry: { coordinates: [number, number][][]; type: "Polygon" };
  properties: {
    deck?: number[];
    kind?: "other" | "path" | "rail" | "road";
    name?: string | null;
    /** OSM bridge:structure (e.g. "arch", "beam", "beam;arch") for arch synthesis */
    structure?: string | null;
  } | null;
}

/** exported for tests */
export interface AreaFeature {
  geometry: {
    coordinates:
      | [number, number][]
      | [number, number][][]
      | [number, number][][][];
    type: "LineString" | "MultiPolygon" | "Polygon";
  } | null;
  properties: Record<string, unknown> | null;
}

/** Outer rings of a Polygon or MultiPolygon geometry (holes are ignored). */
function outerRings(
  geometry: AreaFeature["geometry"] | null | undefined
): [number, number][][] {
  if (geometry?.type === "Polygon") {
    const outer = (geometry.coordinates as [number, number][][])[0];
    return outer ? [outer] : [];
  }
  if (geometry?.type === "MultiPolygon") {
    return (geometry.coordinates as [number, number][][][])
      .map((poly) => poly[0])
      .filter((ring): ring is [number, number][] => ring !== undefined);
  }
  return [];
}

export interface RailContext {
  /** baked bridge-deck GeoJSONs (one per tile) */
  bridgeUrls: string[];
  heightAt: (x: number, y: number) => number | null;
  heightFog?: HeightFogUniforms;
  offset: { cx: number; cy: number };
  /** baked OSM platform GeoJSONs (ODbL) */
  platformUrls: string[];
  /** baked dissolved ballast-area GeoJSONs */
  railareaUrls: string[];
  /** baked railway-track centreline GeoJSONs */
  railUrls: string[];
  signal?: AbortSignal;
}

export interface RailControl {
  dispose: () => void;
  group: Group;
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

const COLORS = {
  ballast: 0x9a_8f_85, // warm grey-brown crushed stone
  rail: 0x4a_4a_50, // dark weathered steel
  deckStone: 0xc6_c0_b4, // pale warm concrete/stone
  deckRoad: 0x6f_70_77, // asphalt
  deckPath: 0xc2_ad_8a, // pale sand
  platform: 0xcf_c9_bd, // pale platform concrete
};

/** Accumulates a non-indexed triangle soup (positions + per-vertex normals). */
interface Mesh3 {
  nrm: number[];
  pos: number[];
}

function mesh3(): Mesh3 {
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

type P3 = [number, number, number];

function quad(acc: Mesh3, p0: P3, p1: P3, p2: P3, p3: P3, n: P3): void {
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

interface Ring2 {
  cx: number;
  cz: number;
  pts: { x: number; z: number }[];
}

/** EPSG ring → world (x,z) ring (open: closing duplicate dropped) + centroid. */
function ringToWorld(
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
function addFootprint(
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

interface Pt {
  x: number;
  y: number;
  z: number;
}

/** Walks a polyline emitting [ex,ey] points every `spacing` m (EPSG coords). */
function densify(
  coords: [number, number][],
  spacing: number
): [number, number][] {
  const out: [number, number][] = [];
  let carry = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      continue;
    }
    for (let d = carry; d < len; d += spacing) {
      const t = d / len;
      out.push([x0 + dx * t, y0 + dy * t]);
    }
    carry = carry + Math.ceil((len - carry) / spacing) * spacing - len;
  }
  const last = coords.at(-1);
  if (last) {
    out.push(last);
  }
  return out;
}

/** A rail-bridge deck for lifting rails onto it (ride the deck, no ballast). */
interface DeckPoly {
  deckZ: number;
  maxX: number;
  maxZ: number;
  minX: number;
  minZ: number;
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

/** Returns the deck Y to lift a rail point onto, or null if not on a rail deck. */
function deckLift(decks: DeckPoly[], x: number, z: number): number | null {
  for (const d of decks) {
    if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) {
      continue;
    }
    if (pointInRing(d.ring, x, z)) {
      return d.deckZ;
    }
  }
  return null;
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
function addRail(acc: Mesh3, pts: Pt[], lateral: number): void {
  if (pts.length < 2) {
    return;
  }
  const tan = tangentsXZ(pts);
  const left = pts.map((p, i) => {
    const nx = -tan[i].y;
    const nz = tan[i].x;
    return {
      x: p.x + nx * (lateral + RAIL_HALF),
      y: p.y,
      z: p.z + nz * (lateral + RAIL_HALF),
    };
  });
  const right = pts.map((p, i) => {
    const nx = -tan[i].y;
    const nz = tan[i].x;
    return {
      x: p.x + nx * (lateral - RAIL_HALF),
      y: p.y,
      z: p.z + nz * (lateral - RAIL_HALF),
    };
  });
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
    // web on each side (outward normal via the tangent perpendicular)
    const nx = -tan[i].y;
    const nz = tan[i].x;
    quad(
      acc,
      [left[i].x, left[i].y, left[i].z],
      [left[i + 1].x, left[i + 1].y, left[i + 1].z],
      [left[i + 1].x, left[i + 1].y - RAIL_WEB, left[i + 1].z],
      [left[i].x, left[i].y - RAIL_WEB, left[i].z],
      [nx, 0, nz]
    );
    quad(
      acc,
      [right[i].x, right[i].y, right[i].z],
      [right[i + 1].x, right[i + 1].y, right[i + 1].z],
      [right[i + 1].x, right[i + 1].y - RAIL_WEB, right[i + 1].z],
      [right[i].x, right[i].y - RAIL_WEB, right[i].z],
      [-nx, 0, -nz]
    );
  }
}

function meshFrom(
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

/** Builds the bridge decks and the rail-deck lift table. */
function buildBridges(
  features: BridgeFeature[],
  ctx: RailContext
): { decks: DeckPoly[]; meshes: Mesh[] } {
  const tops: Record<string, Mesh3> = {
    rail: mesh3(),
    road: mesh3(),
    path: mesh3(),
    other: mesh3(),
  };
  const stone = mesh3(); // fascia + parapets + piers
  const decks: DeckPoly[] = [];

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
    if (kind === "rail") {
      let minX = Number.POSITIVE_INFINITY;
      let minZ = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      let sum = 0;
      for (let i = 0; i < ring.pts.length; i++) {
        minX = Math.min(minX, ring.pts[i].x);
        minZ = Math.min(minZ, ring.pts[i].z);
        maxX = Math.max(maxX, ring.pts[i].x);
        maxZ = Math.max(maxZ, ring.pts[i].z);
        sum += topY[i];
      }
      decks.push({
        ring: ring.pts,
        deckZ: sum / ring.pts.length,
        minX,
        minZ,
        maxX,
        maxZ,
      });
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
    const m = meshFrom(tops[kind], topColor[kind], ctx.heightFog, {
      cast: true,
    });
    if (m) {
      meshes.push(m);
    }
  }
  const stoneMesh = meshFrom(stone, COLORS.deckStone, ctx.heightFog, {
    cast: true,
  });
  if (stoneMesh) {
    meshes.push(stoneMesh);
  }
  return { meshes, decks };
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
  ctx: RailContext
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
  ctx: RailContext
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
    const dense = densify(f.geometry.coordinates, SAMPLE_M);
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
      const lift = deckLift(decks, w.x, w.z);
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
      for (const [ex, ey] of densify(
        g.coordinates as [number, number][],
        SAMPLE_M
      )) {
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
 * Loads the baked rail/bridge/ballast/platform GeoJSONs for the WHOLE tile block
 * (one call, cross-tile heightAt) and builds the stylized geometry on the Y-up
 * scene. Bridges build first so the rails can ride their decks. Non-fatal.
 */
export async function loadRail(ctx: RailContext): Promise<RailControl> {
  const group = new Group();
  group.name = "rail";

  const fetchAll = <T>(urls: string[]) =>
    Promise.all(urls.map((u) => fetchFeatures<T>(u, ctx.signal))).then(
      (lists) => lists.flat()
    );

  const [railFeatures, bridgeFeatures, railareaFeatures, platformFeatures] =
    await Promise.all([
      fetchAll<RailFeature>(ctx.railUrls),
      fetchAll<BridgeFeature>(ctx.bridgeUrls),
      fetchAll<AreaFeature>(ctx.railareaUrls),
      fetchAll<AreaFeature>(ctx.platformUrls),
    ]);

  const { meshes: bridgeMeshes, decks } = buildBridges(bridgeFeatures, ctx);
  group.add(...bridgeMeshes);
  const ballast = buildBallast(railareaFeatures, ctx);
  if (ballast) {
    group.add(ballast);
  }
  const rails = buildRails(railFeatures, ctx, decks);
  if (rails) {
    group.add(rails);
  }
  const platforms = buildPlatforms(platformFeatures, ctx);
  if (platforms) {
    group.add(platforms);
  }

  return {
    group,
    dispose: () => {
      disposeObject3D(group);
    },
  };
}
