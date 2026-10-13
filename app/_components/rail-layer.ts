import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  type Material,
  Mesh,
  MeshStandardNodeMaterial,
  ShapeUtils,
  Vector2,
} from "three/webgpu";
import type { BridgeFeature } from "@/lib/city/features";
import {
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
import { type DeckPoly, type Ring2, ringToWorld } from "@/lib/city/decks";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import type { LineNode } from "@/lib/city/line-nodes";
import {
  addColumn,
  addFootprint,
  cross,
  type Mesh3,
  mesh3,
  outward,
  type P3,
  quad,
  ringWinding,
  type Triangulate,
  unit,
} from "@/lib/city/mesh3";
import {
  addApproach,
  approaches,
  bridgeProps,
  buildDeckTable,
  DECK_DEPTH,
  endEdges,
  PIER_HALF,
  PIER_MIN_GAP,
  type RailContext,
} from "@/lib/city/rail-mesh";
import { type DeckKind, deckMaterial, stoneMaterial } from "./bridge-surface";
import type { LineLook } from "./line-looks";
import { sceneMaterial } from "./three-utils";

/**
 * The railway layer's runtime half: the bridges, and the materials of the
 * rails the build bakes. The railway corridor and bridges used to exist
 * only as a flat land-cover colour painted on the DGM (a brown smear;
 * bridges sank into the Elbe); the rails, ballast yards, platforms and
 * span decks are now baked into the fine terrain glTF (lib/city/
 * rail-mesh.ts, scripts/bake-lines.ts, ADR 0029) — this file only gives
 * those nodes their materials (`RAIL_LOOKS`).
 *
 *  - Bridges: ONE clean slab volume per Basis-DLM ver06_f deck polygon
 *    (top + continuous fascia), flush parapet walls (no floating cap),
 *    piers dropped even over the river, the measured steel above the deck
 *    (ADR 0033). Drawn here at runtime from the tile's bridge file: the
 *    inquiry asks a bridge by its meshes (bridge-ask.ts), and the coarse
 *    level draws the same bridges.
 *
 * All geometry is hand-wound to match its supplied normal (lib/city/
 * mesh3.ts `pushTri`), so every material is FrontSide. Authored in Y-up
 * world coords → added to `scene`. The materials are plain lit node
 * materials, one per colour/finish for the whole scene (`sceneMaterial`):
 * they carry no per-tile data, and the scene's fog node reaches them like
 * every other material.
 * Non-fatal: missing/empty inputs yield an empty group.
 */

export type { RailContext } from "@/lib/city/rail-mesh";

type BridgeProps = NonNullable<BridgeFeature["properties"]>;

/** three's triangulation of a polygon (lib/city/mesh3.ts `Triangulate`). */
export const triangulate: Triangulate = (contour, holes) =>
  ShapeUtils.triangulateShape(
    contour.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y)))
  );
const PARAPET_H = 0.85; // bridge parapet wall height (m)
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
const DECK_END_INSET = 3; // the deck's width is read this far in from its ends (m)
const DECK_FRAME_STEP = 6; // a laid-out deck's top has no edge longer than this (m)

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

function finishGeo(acc: Mesh3): BufferGeometry | null {
  if (acc.pos.length === 0) {
    return null;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(acc.nrm, 3));
  if (acc.deck?.length === (acc.pos.length / 3) * 4) {
    g.setAttribute("aDeck", new Float32BufferAttribute(acc.deck, 4));
  }
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
export function plainMaterial(
  color: number,
  opts: MatOpts = {}
): MeshStandardNodeMaterial {
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

export function meshFrom(
  acc: Mesh3,
  color: number,
  opts: {
    cast: boolean;
    /** a material of its own (the bridges' surfaces) instead of the plain one */
    material?: Material;
    offsetUnits?: number;
    roughness?: number;
  }
): Mesh | null {
  const geo = finishGeo(acc);
  if (!geo) {
    return null;
  }
  const m = new Mesh(
    geo,
    opts.material ??
      plainMaterial(color, {
        offsetUnits: opts.offsetUnits,
        roughness: opts.roughness,
      })
  );
  m.castShadow = opts.cast;
  m.receiveShadow = true;
  return m;
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

/**
 * Splits the upward faces of `acc` from vertex `first` on — the deck's top
 * and its approaches — at their longest edge until no edge is longer than
 * `step` m. The triangulation of a curved deck joins vertices far apart
 * along its arc (191 m on the Marienbrücke), and the frame, exact at each
 * vertex, interpolates truly only over a short reach of a curved axis. A
 * face is planar, so its pieces are too; the sides and the underside stay
 * as they were.
 */
function splitDeckTop(acc: Mesh3, first: number, step: number): void {
  const pos = acc.pos.splice(first * 3);
  const nrm = acc.nrm.splice(first * 3);
  const limit = step * step;
  const d2 = (a: number[], b: number[]) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const mid = (a: number[], b: number[]) => a.map((v, k) => (v + b[k]) / 2);
  for (let t = 0; t < pos.length; t += 9) {
    const n = nrm.slice(t, t + 3);
    const corners = [0, 1, 2].map((k) => pos.slice(t + k * 3, t + k * 3 + 3));
    const stack = [corners];
    while (stack.length > 0) {
      const tri = stack.pop() as number[][];
      const lens = [d2(tri[0], tri[1]), d2(tri[1], tri[2]), d2(tri[2], tri[0])];
      const longest = lens.indexOf(Math.max(...lens));
      if (n[1] < 0.5 || lens[longest] <= limit) {
        for (const c of tri) {
          acc.pos.push(c[0], c[1], c[2]);
          acc.nrm.push(n[0], n[1], n[2]);
        }
        continue;
      }
      // the winding stays: each half keeps the corners' order
      const a = tri[longest];
      const b = tri[(longest + 1) % 3];
      const c = tri[(longest + 2) % 3];
      const m = mid(a, b);
      stack.push([a, m, c], [m, b, c]);
    }
  }
}

/**
 * The deck's frame on the top mesh's vertices from `first` on (its slab
 * and approaches): each vertex's station and offset on the axis and the
 * outline's edges there, which the deck's surface is laid out by
 * (bridge-surface.ts). Exact at each vertex and, the top split short
 * (`splitDeckTop`), true between them on a curved deck too. Zeros without
 * a frame (an older file): the surface keeps its plain colour.
 */
function addDeckFrame(
  top: Mesh3,
  first: number,
  frame: BridgeFrame | null
): void {
  top.deck ??= [];
  // The edges a few metres in from the abutments: at an end the outline
  // closes across the axis, and a corner there took a width of nothing —
  // which the slab's long triangles then spread over the whole deck.
  const ends = frame
    ? [Math.min(...frame.ringS), Math.max(...frame.ringS)]
    : [];
  const inset = Math.min(DECK_END_INSET, (ends[1] - ends[0]) / 2);
  for (let v = first; v < top.pos.length / 3; v++) {
    if (!frame) {
      top.deck.push(0, 0, 0, 0);
      continue;
    }
    const { s, offset } = frame.project(top.pos[v * 3], top.pos[v * 3 + 2]);
    const inside = Math.min(Math.max(s, ends[0] + inset), ends[1] - inset);
    const { left, right } = frame.edgesAt(inside);
    top.deck.push(s, offset, left, right);
  }
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
  const frame = bridgeFrame(f, ctx);
  const first = top.pos.length / 3;
  addFootprint(top, ring, topY, depth, ctx.triangulate, true);
  for (const a of approaches(ring, topY, kind, frame?.ringS, ctx, out.decks)) {
    addApproach(top, out.stone, a, DECK_DEPTH);
  }
  if (frame) {
    splitDeckTop(top, first, DECK_FRAME_STEP);
  }
  addDeckFrame(top, first, frame);
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
  for (const kind of Object.keys(out.tops) as DeckKind[]) {
    const m = meshFrom(out.tops[kind], topColor[kind], {
      cast: true,
      material: deckMaterial(kind, topColor[kind]),
    });
    if (m) {
      meshes.push(m);
    }
  }
  const stoneMesh = meshFrom(out.stone, COLORS.deckStone, {
    cast: true,
    material: stoneMaterial(COLORS.deckStone),
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
  /** a world (Y-up) point's station and offset (left > 0) */
  project(x: number, z: number): { offset: number; s: number };
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
    project: (x, z) => axis.project(x + ctx.offset.cx, ctx.offset.cy - z),
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
    const e = worldToEpsg(p.x, p.z, ctx.offset);
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
    const e = worldToEpsg(px, pz, ctx.offset);
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

/**
 * Builds a tile's bridges (one call, cross-tile heightAt) as stylized
 * geometry on the Y-up scene, every mesh tagged for the inquiry probe
 * (bridge-ask.ts). Empty inputs yield an empty group; the group is freed
 * with the scene (disposeObject3D).
 */
export function buildBridgeLayer(
  bridges: BridgeFeature[],
  ground: Omit<RailContext, "triangulate">
): Group {
  const group = new Group();
  group.name = "rail";
  const ctx: RailContext = { ...ground, triangulate };
  const decks = buildDeckTable(bridges, ctx);
  const meshes = buildBridges(bridges, ctx, decks);
  // what the inquiry probe raycasts for a bridge (bridge-ask.ts)
  for (const mesh of meshes) {
    mesh.userData.bridge = true;
  }
  // add() with no arguments logs a three error, so guard the spread.
  if (meshes.length > 0) {
    group.add(...meshes);
  }
  return group;
}

/** The baked railway's nodes (lib/city/rail-mesh.ts), as the viewer drew
 *  them: their material and whether they cast. */
export const RAIL_LOOKS = {
  "rail-ballast": {
    material: () =>
      plainMaterial(COLORS.ballast, { offsetUnits: -2, roughness: 1 }),
    cast: false,
  },
  "rail-tracks": {
    material: () =>
      plainMaterial(COLORS.rail, { offsetUnits: -1, roughness: 0.5 }),
    cast: false,
  },
  "rail-platforms": {
    material: () => plainMaterial(COLORS.platform),
    cast: true,
  },
  "rail-span-top": {
    material: () => deckMaterial("rail", COLORS.deckRail),
    cast: true,
  },
  "rail-span-stone": {
    material: () => stoneMaterial(COLORS.deckStone),
    cast: true,
  },
} as const satisfies Record<Extract<LineNode, `rail-${string}`>, LineLook>;
