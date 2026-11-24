/**
 * The bridges (ADR 0041): one clean slab per baked deck on its measured
 * line, with its approaches and parapets, flush walls or an open railing;
 * what carries it and stands on it, as the bake measured (steel arches,
 * frames, pylons and stays, masonry arches, piers); and the deck under a
 * span, where a line crosses a gap no baked deck covers. Authored in Y-up
 * world coordinates. The lift table these decks are also read through is
 * bridge-deck.ts; rail-layer.ts calls this and hangs the meshes.
 */
import type { Mesh } from "three/webgpu";
import {
  archFits,
  archSpringing,
  axisFrame,
  BRIDGE_STEP,
  beamSpan,
  beamSupports,
  deckCarrier,
  deckDepth,
  intradosAt,
  masonryArches,
  PIER_SPACING,
  parapetStyle,
  placeRibs,
  ribPeaks,
  ribProfile,
  ribRuns,
} from "@/lib/city/bridge";
import type {
  BridgeRib,
  DeckSupport,
  MasonryPier,
  MasonrySpan,
  Parabola,
} from "@/lib/city/bridge";
import { ringToWorld } from "@/lib/city/decks";
import type { DeckPoly, Ring2 } from "@/lib/city/decks";
import type { BridgeFeature } from "@/lib/city/features";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { SINK } from "@/lib/city/ground-join";
import { modeRuns } from "@/lib/city/levels";
import type { Level } from "@/lib/city/levels";
import type { Steps } from "@/lib/city/build-steps";
import { approaches, bridgeProps, endEdges } from "./bridge-deck";
import type { Approach, ApproachColumn, BridgeProps } from "./bridge-deck";
import { deckMaterial, stoneMaterial } from "./bridge-surface";
import type { DeckKind } from "./bridge-surface";
import {
  addColumn,
  addFootprint,
  addStrut,
  COLORS,
  cross,
  mesh3,
  meshSteps,
  outward,
  quad,
  ringWinding,
  tangentsXZ,
  unit,
} from "./mesh-kit";
import type { Mesh3, P3, Pt } from "./mesh-kit";

export interface BridgeContext extends GroundContext {
  /**
   * Whether this tile draws a bridge whose deck centre is at (x, y) (EPSG).
   * A deck across a seam is in both tiles' files — the same, from the
   * bake's mosaic — and every copy lifts the tile's own rails, but only its
   * owner draws it. Absent: every bridge is drawn.
   */
  owns?: (x: number, y: number) => boolean;
}

const DECK_DEPTH = 1.1; // a line's own span deck's slab thickness (m)
const PARAPET_H = 0.85; // a masonry bridge's ashlar parapet height (m)
// every other bridge's railing is open steel: posts and a top rail on a
// low kerb (photo QA V18: the walls read as stone bridges everywhere)
const RAILING_H = 1.1; // the railing's top above the deck (m)
const RAILING_KERB_H = 0.2; // the kerb it stands on: height (m)...
const RAILING_KERB_W = 0.3; // ...and width (m)
const RAILING_IN = 0.15; // posts and rail stand this far in from the deck's edge (m)
const RAILING_BAR_HALF = 0.04; // half-section of a post and of the top rail (m)
const RAILING_POST_EVERY = 2.5; // a railing post every this many metres (m)
const PIER_MIN_GAP = 2.5; // only pier where the deck clears the ground by this (m)
const PIER_HALF = 0.65; // pier column half-width (m)
const VIADUCT_COLUMN_HALF = 0.3; // half-section of a viaduct's edge column (m)
const VIADUCT_COLUMN_IN = 0.6; // its centre this far in from the deck's edge (m)
const VIADUCT_CAP_HALF = 0.35; // half-section of the crossbeam between a pair (m)
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
  for (let i = 0; i < pts.length; i += 1) {
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
 * An open steel railing along the deck's sides (not across its ends): a
 * low kerb flush with the fascia, a post every RAILING_POST_EVERY on it
 * and a top rail RAILING_H over the deck — the beam, truss and cable
 * bridges' railing, which an ashlar wall drew as a stone bridge.
 */
function addRailing(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  ringS?: number[]
): void {
  const { pts } = ring;
  const across = endEdges(ring, ringS);
  const winding = ringWinding(pts);
  const bar = RAILING_BAR_HALF;
  let since = RAILING_POST_EVERY; // metres since the last post
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    if (across[i]) {
      since = RAILING_POST_EVERY; // a post where the next side begins
      continue;
    }
    const [ox, oz] = outward(pts, i, winding);
    const len = Math.hypot(ox, oz) || 1;
    const nx = ox / len;
    const nz = oz / len;
    const at = (t: number, inset: number, lift: number): P3 => [
      pts[i].x + (pts[j].x - pts[i].x) * t - nx * inset,
      topY[i] + (topY[j] - topY[i]) * t + lift,
      pts[i].z + (pts[j].z - pts[i].z) * t - nz * inset,
    ];
    const kh = RAILING_KERB_H;
    const kw = RAILING_KERB_W;
    quad(acc, at(0, 0, 0), at(1, 0, 0), at(1, 0, kh), at(0, 0, kh), [
      nx,
      0,
      nz,
    ]);
    quad(
      acc,
      at(0, 0, kh),
      at(1, 0, kh),
      at(1, kw, kh),
      at(0, kw, kh),
      [0, 1, 0]
    );
    quad(acc, at(0, kw, 0), at(1, kw, 0), at(1, kw, kh), at(0, kw, kh), [
      -nx,
      0,
      -nz,
    ]);
    const top = RAILING_H - bar;
    addStrut(acc, at(0, RAILING_IN, top), at(1, RAILING_IN, top), bar);
    const edge = Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z);
    let d = RAILING_POST_EVERY - since;
    for (; d <= edge; d += RAILING_POST_EVERY) {
      const t = edge > 0 ? Math.max(d, 0) / edge : 0;
      addStrut(acc, at(t, RAILING_IN, kh), at(t, RAILING_IN, top), bar);
    }
    since = edge - (d - RAILING_POST_EVERY);
  }
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
  for (let i = 0; i < cols.length - 1; i += 1) {
    const p = cols[i];
    const q = cols[i + 1];
    const p0: P3 = [p.x, p.y, p.z];
    const q0: P3 = [q.x, q.y, q.z];
    const q1: P3 = [q.land.x, q.land.y, q.land.z];
    const p1: P3 = [p.land.x, p.land.y, p.land.z];
    // both columns flush with the ground: nothing to draw between them
    if (same(p0, p1) && same(q0, q1)) {
      continue;
    }
    quad(top, p0, q0, q1, p1, rampNormal(p0, q0, q1, p1));
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

const same = (a: P3, b: P3): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const edgeOf = (a: P3, b: P3): P3 => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];

/** A ramp quad's upward unit normal: both its triangles' normals summed, so
 *  a column already flush with the ground (its landing is itself, one
 *  triangle has no area) still gets the other's. Never zero: that is NaN
 *  on the GPU, a black face. */
function rampNormal(p0: P3, q0: P3, q1: P3, p1: P3): P3 {
  const a = cross(edgeOf(p0, q0), edgeOf(p0, q1));
  const b = cross(edgeOf(p0, q1), edgeOf(p0, p1));
  const sum: P3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  if (sum[0] === 0 && sum[1] === 0 && sum[2] === 0) {
    return [0, 1, 0];
  }
  const u = unit(sum);
  return u[1] < 0 ? [-u[0], -u[1], -u[2]] : u;
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

/** Whether this tile draws the deck (its centre is the tile's, or no
 *  owner test was given). */
function drawsDeck(coords: [number, number][], ctx: BridgeContext): boolean {
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

/** A deck slab laid on its measured line: the vertices before `end` are
 *  the slab's (not its approaches'), its top at `top` there and its
 *  underside `depth` under it. */
interface SlabLine {
  depth: number;
  end: number;
  top: (x: number, z: number) => number;
}

/**
 * Splits the upward faces of `acc` from vertex `first` on — the deck's top
 * and its approaches — at their longest edge until no edge is longer than
 * `step` m. The triangulation of a curved deck joins vertices far apart
 * along its arc (191 m on the Marienbrücke), and the frame, exact at each
 * vertex, interpolates truly only over a short reach of a curved axis.
 * Given the `slab`, its top and underside are split alike and every vertex
 * the split adds is set on the measured line at its station: the
 * triangulation's long faces joined an abutment to the middle of the span
 * and cut under the line's camber, 4.4 m on the Waldschlößchenbrücke.
 * Elsewhere a face is planar, so its pieces are too; the sides stay as
 * they were (the slab's ring is split short, `onLine`).
 */
function* splitDeckTop(
  acc: Mesh3,
  first: number,
  step: number,
  slab?: SlabLine
): Steps<void> {
  const pos = acc.pos.splice(first * 3);
  const nrm = acc.nrm.splice(first * 3);
  for (let t = 0; t < pos.length; t += 9) {
    const n = nrm.slice(t, t + 3);
    const corners = [0, 1, 2].map((k) => pos.slice(t + k * 3, t + k * 3 + 3));
    const onSlab =
      slab !== undefined && first + t / 3 < slab.end && Math.abs(n[1]) >= 0.5;
    const lift =
      slab && onSlab
        ? (m: number[]) => {
            m[1] = slab.top(m[0], m[2]) - (n[1] < 0 ? slab.depth : 0);
          }
        : null;
    splitFace(acc, corners, n, n[1] >= 0.5 || onSlab ? step : 0, lift);
    if ((t / 9 + 1) % DECK_RUN === 0) {
      yield;
    }
  }
}

/** The squared distance between two points. */
const d2 = (a: number[], b: number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** One face into `acc`, split at its longest edge while that is longer
 *  than `step` (0: as it is), each new corner moved by `lift`. */
function splitFace(
  acc: Mesh3,
  corners: number[][],
  n: number[],
  step: number,
  lift: ((m: number[]) => void) | null
): void {
  const limit = step * step;
  const stack = [corners];
  for (let tri = stack.pop(); tri; tri = stack.pop()) {
    const lens = [d2(tri[0], tri[1]), d2(tri[1], tri[2]), d2(tri[2], tri[0])];
    const longest = lens.indexOf(Math.max(...lens));
    if (step === 0 || lens[longest] <= limit) {
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
    const m = a.map((v, k) => (v + b[k]) / 2);
    lift?.(m);
    stack.push([a, m, c], [m, b, c]);
  }
}

/** A deck ring's edges are split into pieces at most this long (m): under
 *  the top's DECK_FRAME_STEP, so `splitDeckTop` never splits a side the
 *  fascia does not share. */
const DECK_RING_STEP = 0.8 * DECK_FRAME_STEP;

/** Deck faces split per step (build-steps.ts). */
const DECK_RUN = 256;

/**
 * The deck's outline with a vertex every DECK_RING_STEP along each edge,
 * every one on the measured line at its station, and the frame with every
 * vertex's station. The bake gives a deck a few vertices (14 on the
 * Waldschlößchenbrücke's 660 m), and between them the fascia, the parapets
 * and the spandrels ran straight under its camber. Its corners' own
 * heights (`deck`) lie within 12 cm of the line; read off the line too,
 * the fascia's and the parapets' top meets the top the slab is laid on
 * there (`splitDeckTop`, at the line) without a step.
 */
function onLine(
  ring: Ring2,
  frame: BridgeFrame
): { frame: BridgeFrame; ring: Ring2; topY: number[] } {
  const pts: Ring2["pts"] = [];
  const ys: number[] = [];
  const ringS: number[] = [];
  const n = ring.pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = ring.pts[i];
    const b = ring.pts[(i + 1) % n];
    const pieces = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DECK_RING_STEP)
    );
    pts.push(a);
    ys.push(frame.deckAt(frame.ringS[i]));
    ringS.push(frame.ringS[i]);
    for (let k = 1; k < pieces; k += 1) {
      const x = a.x + ((b.x - a.x) * k) / pieces;
      const z = a.z + ((b.z - a.z) * k) / pieces;
      const { s } = frame.project(x, z);
      pts.push({ x, z });
      ys.push(frame.deckAt(s));
      ringS.push(s);
    }
  }
  return { frame: { ...frame, ringS }, ring: { ...ring, pts }, topY: ys };
}

/**
 * The deck's frame on the top mesh's vertices from `first` on (its slab
 * and approaches): each vertex's station and offset on the axis and the
 * outline's edges there, which the deck's surface is laid out by
 * (bridge-surface.ts). Exact at each vertex and, the top split short
 * (`splitDeckTop`), true between them on a curved deck too. Zeros without
 * a frame (an older file): the surface keeps its plain colour.
 */
function* addDeckFrame(
  top: Mesh3,
  first: number,
  frame: BridgeFrame | null
): Steps<void> {
  top.deck ??= [];
  // The edges a few metres in from the abutments: at an end the outline
  // closes across the axis, and a corner there took a width of nothing —
  // which the slab's long triangles then spread over the whole deck.
  const ends = frame
    ? [Math.min(...frame.ringS), Math.max(...frame.ringS)]
    : [];
  const inset = Math.min(DECK_END_INSET, (ends[1] - ends[0]) / 2);
  for (let v = first; v < top.pos.length / 3; v += 1) {
    if (!frame) {
      top.deck.push(0, 0, 0, 0);
      continue;
    }
    const { s, offset } = frame.project(top.pos[v * 3], top.pos[v * 3 + 2]);
    const inside = Math.min(Math.max(s, ends[0] + inset), ends[1] - inset);
    const { left, right } = frame.edgesAt(inside);
    top.deck.push(s, offset, left, right);
    if ((v - first + 1) % (DECK_RUN * 8) === 0) {
      yield;
    }
  }
}

/** A bridge's deck: its slab `depth` deep on the measured line
 *  (`onLine`), the approaches and the frame attributes. Returns where it
 *  was laid, the frame null on an older file without an axis.
 * @yields {void} once per slice boundary, so the build can be spread over frames (build-steps.ts)
 */
function* drawDeck(
  f: BridgeFeature,
  baked: Ring2,
  bakedY: number[],
  out: BridgeMeshes,
  ctx: BridgeContext,
  depth: number
): Steps<{ frame: BridgeFrame | null; ring: Ring2; topY: number[] }> {
  const { kind } = bridgeProps(f);
  const top = out.tops[kind] ?? out.tops.other;
  const measured = bridgeFrame(f, ctx);
  yield;
  const laid = measured ? onLine(baked, measured) : null;
  const frame = laid?.frame ?? null;
  const ring = laid?.ring ?? baked;
  const topY = laid?.topY ?? bakedY;
  const first = top.pos.length / 3;
  addFootprint(top, ring, topY, depth, true);
  const slabEnd = top.pos.length / 3;
  for (const a of approaches(ring, topY, kind, frame?.ringS, ctx, out.decks)) {
    addApproach(top, out.stone, a, depth);
  }
  yield;
  if (frame) {
    yield* splitDeckTop(top, first, DECK_FRAME_STEP, {
      depth,
      end: slabEnd,
      top: (x, z) => frame.deckAt(frame.project(x, z).s),
    });
  }
  yield* addDeckFrame(top, first, frame);
  return { frame, ring, topY };
}

/**
 * What carries a deck and how deep its slab is (photo QA V16, V17): a beam
 * deck's supports (`beamSupports`: piers on the axis, a railway viaduct's
 * paired columns) and the depth its structure gives it (`deckDepth`, the
 * baked fairway depth only a cap). An older file without an axis: no
 * supports, a depth for the usual pier spacing.
 */
function deckPlan(p: BridgeProps): { depth: number; supports: DeckSupport[] } {
  const length = p.axis ? (axisFrame(p.axis)?.length ?? 0) : 0;
  const supports =
    length > 0
      ? beamSupports(length, {
          fairway: p.fairway,
          kind: p.kind,
          span: p.span,
          structure: p.structure,
          water: p.water,
        })
      : [];
  const span = length > 0 ? beamSpan(length, supports, p.span) : PIER_SPACING;
  return {
    depth: deckDepth(deckCarrier(p.structure), span, p.depth),
    supports,
  };
}

/** The deck's parapet (photo QA V18): a masonry bridge's ashlar wall, an
 *  open steel railing on every other — none where a frame stands on the
 *  deck's edge (it is the railing: a parapet beside it read as a second
 *  strip along the roadway). */
function addParapet(
  out: BridgeMeshes,
  p: BridgeProps,
  deck: { ring: Ring2; ringS?: number[]; topY: number[] },
  steelArch: boolean
): void {
  if (drawsFrames(p)) {
    return;
  }
  if (parapetStyle(p.structure, steelArch) === "ashlar") {
    addParapetWalls(out.stone, deck.ring, deck.topY, deck.ringS);
  } else {
    addRailing(out.steel, deck.ring, deck.topY, deck.ringS);
  }
}

/**
 * Draws one bridge: deck, parapets, whatever carries it and stands on it.
 * @yields {void} once per slice boundary, so the build can be spread over frames (build-steps.ts)
 */
function* drawBridge(
  f: BridgeFeature,
  baked: Ring2,
  bakedY: number[],
  out: BridgeMeshes,
  ctx: BridgeContext
): Steps<void> {
  const p = f.properties ?? {};
  const { depth, supports } = deckPlan(p);
  const { frame, ring, topY } = yield* drawDeck(
    f,
    baked,
    bakedY,
    out,
    ctx,
    depth
  );
  yield;
  if (!frame) {
    // an older file: no axis, no measurements
    addParapet(out, p, { ring, topY }, false);
    addPiers(out.stone, ring, topY, ctx, depth);
    return;
  }
  const carried = addSuperstructure(out, frame, p, depth);
  yield;
  const deck = { ring, topY, ringS: frame.ringS };
  addParapet(out, p, deck, carried.arches.length > 0);
  if (carried.pylons) {
    return;
  }
  if (
    carried.arches.length === 0 &&
    deckCarrier(p.structure) === "arch" &&
    addMasonry(out.stone, frame, { ...deck, depth }, p)
  ) {
    return;
  }
  for (const { s, edge } of supports) {
    if (carried.arches.some(([from, to]) => s >= from && s <= to)) {
      continue;
    }
    if (edge) {
      addColumnPair(out.stone, frame, s, depth);
    } else {
      addPierAt(out.stone, frame, s, 0, depth, PIER_HALF);
    }
  }
}

/** Builds the bridges this tile draws (deck, parapets, what carries them
 *  and what stands on them). The rails' deck table is buildDeckTable's.
 * @yields {void} once per slice boundary, so the build can be spread over frames (build-steps.ts)
 */
export function* buildBridges(
  features: BridgeFeature[],
  ctx: BridgeContext,
  decks: DeckPoly[]
): Steps<Mesh[]> {
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
      yield* drawBridge(f, ring, topY, out, ctx);
    }
    yield;
  }

  const meshes: Mesh[] = [];
  const topColor: Record<string, number> = {
    rail: COLORS.deckRail,
    road: COLORS.deckRoad,
    path: COLORS.deckPath,
    other: COLORS.deckStone,
  };
  for (const kind of Object.keys(out.tops) as DeckKind[]) {
    const m = yield* meshSteps(out.tops[kind], topColor[kind], {
      cast: true,
      material: deckMaterial(kind, topColor[kind]),
    });
    if (m) {
      meshes.push(m);
    }
  }
  const stoneMesh = yield* meshSteps(out.stone, COLORS.deckStone, {
    cast: true,
    material: stoneMaterial(COLORS.deckStone),
  });
  if (stoneMesh) {
    stoneMesh.name = "bridge-stone";
    meshes.push(stoneMesh);
  }
  const steelMesh = yield* meshSteps(out.steel, COLORS.steel, {
    cast: true,
  });
  if (steelMesh) {
    steelMesh.name = "bridge-steel";
    meshes.push(steelMesh);
  }
  return meshes;
}

// --- the measured bridge (ADR 0041) -------------------------------------------------

/** A bridge's axis frame: stations along it, lateral offsets across it. */
interface BridgeFrame {
  /** world point at station `s` (m from the first abutment), `offset` to the left */
  at: (s: number, offset: number) => { x: number; z: number };
  /** the terrain there (the DGM's water surface over the river) */
  groundAt: (s: number, offset: number) => number | null;
  length: number;
  /** deck height per BRIDGE_STEP */
  line: number[];
  /** the deck height at station `s` */
  deckAt: (s: number) => number;
  /** the deck ring's extreme offsets from the axis (left > 0 > right) */
  edges: { left: number; right: number };
  /** each ring vertex's station (the open ring, as `ringToWorld`) */
  ringS: number[];
  /** the deck's edges at station `s`: its outline's offsets there (a
   *  curved deck around a straight axis is narrower locally than `edges`) */
  edgesAt: (s: number) => { left: number; right: number };
  /** a world (Y-up) point's station and offset (left > 0) */
  project: (x: number, z: number) => { offset: number; s: number };
}

function bridgeFrame(f: BridgeFeature, ctx: BridgeContext): BridgeFrame | null {
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
  for (let i = 0; i < ring.length; i += 1) {
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
    for (const [r, fit] of archFits(ribs, frame.line).entries()) {
      if (fit) {
        const { offset } = ribs[r];
        const span = archSpringing(fit, frame.length, (s) =>
          frame.groundAt(s, offset)
        );
        addArchRib(out.steel, frame, offset, { fit, ...span }, depth);
        arches.push([span.from, span.to]);
      }
    }
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
  for (let i = from; i < to; i += 1) {
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
  for (let k = 0; k < n; k += 1) {
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
  for (let r = 0; r < ribs.length; r += 1) {
    const rib = ribs[r];
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
  }
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

/** A railway viaduct's frame at a station: a column under each deck edge,
 *  from the ground up to the soffit, and the crossbeam they carry under
 *  it (the U3's steel viaduct; a pier on the axis drew a road bridge). */
function addColumnPair(
  acc: Mesh3,
  frame: BridgeFrame,
  s: number,
  depth: number
): void {
  const under = frame.deckAt(s) - depth;
  const { left, right } = frame.edgesAt(s);
  if (left - right < 2 * (VIADUCT_COLUMN_IN + VIADUCT_COLUMN_HALF)) {
    addPierAt(acc, frame, s, 0, depth, PIER_HALF);
    return;
  }
  const sides = [left - VIADUCT_COLUMN_IN, right + VIADUCT_COLUMN_IN];
  let standing = 0;
  for (const offset of sides) {
    const ground = frame.groundAt(s, offset);
    if (ground !== null && under - ground >= PIER_MIN_GAP) {
      const w = frame.at(s, offset);
      addColumn(acc, w.x, w.z, ground, under, VIADUCT_COLUMN_HALF);
      standing += 1;
    }
  }
  if (standing === 2) {
    const y = under - VIADUCT_CAP_HALF;
    const a = point(frame, s, sides[0] + VIADUCT_COLUMN_HALF, y);
    const b = point(frame, s, sides[1] - VIADUCT_COLUMN_HALF, y);
    addStrut(acc, a, b, VIADUCT_CAP_HALF);
  }
}

/** Drops box piers from the deck underside to terrain along the deck's long axis,
 *  placed even over the river by interpolating ground between the abutments. */
function addPiers(
  acc: Mesh3,
  ring: Ring2,
  topY: number[],
  ctx: BridgeContext,
  depth: number
): void {
  // Long axis = farthest-apart ring vertices (the two abutment ends).
  let ai = 0;
  let bi = 1;
  let bd = -1;
  for (let i = 0; i < ring.pts.length; i += 1) {
    for (let j = i + 1; j < ring.pts.length; j += 1) {
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
  for (let k = 1; k < n; k += 1) {
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
 * arches between piers of real thickness (`masonryArches`: DOM1's piers,
 * else Wikidata's spans, `known`). The deck's own
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
  deck: { ring: Ring2; topY: number[]; depth: number },
  known: BridgeProps
): boolean {
  const { spans, piers } = masonryArches(
    frame.length,
    (s) => frame.groundAt(s, 0),
    (s) => frame.deckAt(s) - deck.depth,
    {
      fairway: known.fairway,
      piers: known.piers,
      span: known.span,
      spans: known.spans,
    }
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
    const pier = piers.find((p) => Math.abs(s - p.s) <= p.half);
    return pier ? pier.top : null;
  };
  for (let i = 0; i < ring.pts.length; i += 1) {
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
  for (let k = 0; k < n; k += 1) {
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
  for (let k = 1; k <= n; k += 1) {
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

/** A pier across the whole deck: a box `half` either side of its station,
 *  from the ground up to its arches' springing. */
function addMasonryPier(
  acc: Mesh3,
  frame: BridgeFrame,
  pier: MasonryPier
): void {
  const { s, ground, half, top } = pier;
  const { left, right } = frame.edgesAt(s);
  if (top - ground < 0.3 || left - right < 1) {
    return;
  }
  const corner = (ds: number, off: number) => frame.at(s + ds, off);
  const c = [
    corner(-half, right),
    corner(half, right),
    corner(half, left),
    corner(-half, left),
  ];
  const cx = (c[0].x + c[2].x) / 2;
  const cz = (c[0].z + c[2].z) / 2;
  for (let k = 0; k < 4; k += 1) {
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
  for (let i = 1; i < pts.length; i += 1) {
    run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (run < next || i === pts.length - 1) {
      continue;
    }
    next += PIER_SPACING;
    const p = pts[i];
    const e = worldToEpsg(p.x, p.z, ctx.offset);
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
