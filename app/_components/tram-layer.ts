import {
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import type {
  BridgeFeature,
  FurnitureFeature,
  TramBed,
  TramFeature,
} from "@/lib/city/features";
import type { DeckPoly } from "@/lib/city/decks";
import { LEVEL_STEP } from "@/lib/city/levels";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { LANDCOVER_CLASSES, MEADOW_CLASS } from "@/lib/city/landcover";
import type { Point2 } from "@/lib/city/polyline";
import { subdividePolyline } from "@/lib/city/polyline";
import {
  CONTACT_WIRE_M,
  MAST_HEIGHT_M,
  RAIL_TOP_M,
  RAIL_TOP_ON_DECK_M,
  SPAN_ANCHOR_M,
  spanHeight,
  spanLift,
  TRAM_GAUGE,
  wireDrop,
  wireStations,
} from "@/lib/city/tram";
import { buildFurniture } from "./furniture-layer";
import { Instances, instancePosition } from "./instancing";
import {
  addRail,
  addRibbon,
  buildDeckTable,
  addSpanDeck,
  COLORS,
  lineLevelsAt,
  type Mesh3,
  meshFrom,
  mesh3,
  type Pt,
  quad,
  spanRuns,
} from "./rail-layer";
import { sceneMaterial } from "./three-utils";
import { addWire, wireMesh, wires, type Wires } from "./wire-ribbons";

/**
 * Trams (pipeline/bake/tram.py, OSM, ODbL): the tracks in their bed and the
 * overhead line above them.
 *
 * - Tracks: two rails per track at its mapped gauge (Dresden's 1 450 mm), reusing the
 *   rail layer's profile, in a soft lavender-grey a shade under the road's.
 *   In the street the rail heads flush with the road (no sleepers, no
 *   groove: fewer, calmer lines); on a lawn (*Rasengleis*) the rails a hand
 *   higher over a meadow strip — one lawn for a double track whose tracks
 *   lie at most 4.5 m apart, each strip's inner edge running to the
 *   midpoint between them (`lawnHalves`), not two strips with a seam of
 *   road between; on ballast a ballast strip.
 *   A track the OSM way puts on a bridge rides the deck (the rail layer's
 *   lift table, every deck kind).
 * - Overhead line: one contact wire per track 5.6 m over the rail top,
 *   sagging between the supports the bake found (`s`); span wires between
 *   masts or facade rosettes with a hanger down to each wire they cross;
 *   cantilever arms with a stay. All wires are camera-facing ribbons whose
 *   width never drops below a pixel floor, their alpha carrying the true
 *   coverage, faded out with distance — thin lines that would otherwise
 *   break into crawling dashes. Light and faint on purpose: a soft slate at
 *   under two-thirds opacity, like a pencil line on the watercolour, not
 *   ink. Wires never cast (the shadow map stays as it was); only the masts
 *   do.
 * - Masts: a pale green-grey pole each, instanced (`Instances`) — the
 *   mapped masts and the poles the bake placed where none is mapped.
 * - Stops: the bus stop's "H" sign (furniture-layer.ts, plan 030) on the
 *   platform of each tram stop the bake found one for.
 *
 * Built per fine terrain tile in the Y-up frame on the cross-tile ground
 * (tracks and spans reach past the tile edge); freed with the tile.
 */

const SAMPLE_M = LEVEL_STEP.tram; // rails follow the TIN closely
const WIRE_STRIDE = 2; // the contact wire at every other rail sample (4 m)
const RAIL_HALF = 0.075; // rail-layer's drawn rail
/** a street rail shows only the 2 cm it stands out of the road */
const STREET_RAIL_WEB = 0.04;
const BED_HALF: Record<TramBed, number> = {
  street: 0,
  grass: 1.3,
  ballast: 1.4,
};
const BED_WEB: Record<TramBed, number> = {
  street: 0,
  grass: 0.2,
  ballast: 0.3,
};
/** bed strip top under the rail top (m) */
const BED_BELOW_RAIL = 0.1;
/** Two lawn tracks at most this far apart (m, axis to axis) share one
 *  lawn: a double track's *Rasengleis* (Dresden's are 2.9–3.6 m). */
export const LAWN_PAIR_M = 4.5;
/** What a shared lawn's inner edge stops short of the midpoint (m): the
 *  two strips meet without overlapping (no z-fight where they would). */
const LAWN_SEAM_M = 0.01;
/** How square across a run its neighbour must lie to share its lawn (the
 *  cosine to its normal): the run's own next piece, end to end at a way's
 *  split or a level change, lies along it. */
const LAWN_ACROSS = 0.8;
/** half-widths (m) of the drawn wires */
const WIRE_HALF = { contact: 0.006, span: 0.005, hanger: 0.004, arm: 0.03 };
const MAST_COLOR = 0xb7_bc_b4; // pale green-grey
/** rail heads: the road's lavender-grey (200, 200, 206), a shade deeper */
const TRAM_RAIL = 0xa9_aa_b4;
/** the lawn under a *Rasengleis*: the ground's own meadow colour */
const MEADOW = (() => {
  const [r, g, b] = LANDCOVER_CLASSES.find((k) => k.id === MEADOW_CLASS)
    ?.srgb ?? [197, 211, 170];
  return (r << 16) | (g << 8) | b;
})();

// --- tracks -------------------------------------------------------------------

/** The rail top along one track, split where the ground has no data. */
interface TrackRun {
  /** distance (m) along the drawn line of each point */
  d: number[];
  pts: Pt[];
}

/**
 * A track's rail top on the level its line runs on (rail-layer.ts
 * `lineLevelsAt`, lib/city/levels.ts): the build step's runs where the
 * track has them, else solved with what OSM says — a way on a bridge rides
 * the deck, one off it the ground (and the approach ramps up to a deck).
 * The track under a deck stays under it; the track over a gap the DGM
 * leaves beside a bridge spans it, its deck drawn under it (`spans`).
 */
function trackRuns(
  f: TramFeature,
  coords: Point2[],
  bed: TramBed,
  decks: DeckPoly[],
  ctx: GroundContext,
  spans?: { stone: Mesh3; top: Mesh3 }
): TrackRun[] {
  const onBridge = f.properties?.bridge === 1;
  const dense = subdividePolyline(coords, SAMPLE_M);
  const levels = lineLevelsAt(
    dense,
    "tram",
    f.properties?.lv,
    ctx,
    decks,
    onBridge ? "deck" : "ground"
  );
  const runs: TrackRun[] = [];
  let run: TrackRun = { d: [], pts: [] };
  let d = 0;
  const drawn: (Pt | null)[] = [];
  dense.forEach((p, i) => {
    if (i > 0) {
      d += Math.hypot(p[0] - dense[i - 1][0], p[1] - dense[i - 1][1]);
    }
    const level = levels[i];
    if (!level) {
      drawn.push(null);
      if (run.pts.length >= 2) {
        runs.push(run);
      }
      run = { d: [], pts: [] };
      return;
    }
    const w = epsgToWorld(p[0], p[1], ctx.offset);
    const top =
      level.mode === "ground" || level.mode === "cut"
        ? RAIL_TOP_M[bed]
        : RAIL_TOP_ON_DECK_M;
    const pt = { x: w.x, y: level.y + top, z: w.z };
    drawn.push(pt);
    run.pts.push(pt);
    run.d.push(d);
  });
  if (run.pts.length >= 2) {
    runs.push(run);
  }
  if (spans) {
    for (const span of spanRuns(levels, drawn)) {
      addSpanDeck(
        spans.top,
        spans.stone,
        span
          .filter((p): p is Pt => p !== null)
          .map((p) => ({ ...p, y: p.y - RAIL_TOP_ON_DECK_M })),
        SPAN_HALF_M,
        ctx
      );
    }
  }
  return runs;
}

/** Half a tram span's deck (m): the track and a shoulder either side. */
const SPAN_HALF_M = 1.6;

/** Every `stride`-th point of a run, its ends kept: the contact wire
 *  needs no finer line than the rails'. */
function thinned(run: TrackRun, stride: number): TrackRun {
  const keep = run.pts.map(
    (_, i) => i % stride === 0 || i === run.pts.length - 1
  );
  return {
    d: run.d.filter((_, i) => keep[i]),
    pts: run.pts.filter((_, i) => keep[i]),
  };
}

interface TrackMeshes {
  ballast: Mesh3;
  grass: Mesh3;
  rail: Mesh3;
  streetRail: Mesh3;
}

/** The half-widths of a lawn strip along a run: `left` and `right` of its
 *  direction, each BED_HALF.grass unless another lawn track lies within
 *  LAWN_PAIR_M on that side, where it reaches the midpoint (`shared`). */
export interface LawnHalves {
  left: number[];
  right: number[];
  sharedLeft: boolean[];
  sharedRight: boolean[];
}

/** The left-hand unit normal (x, z) of a run at each point. */
function leftNormals(pts: Pt[]): [number, number][] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const t = Math.hypot(tx, tz) || 1;
    return [-tz / t, tx / t];
  });
}

/** A grid of the other lawn runs' segments, to find the nearest. */
type SegmentGrid = Map<string, [Pt, Pt, number][]>;

const CELL_M = LAWN_PAIR_M;
const cellKey = (x: number, z: number) =>
  `${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`;

function segmentGrid(runs: TrackRun[]): SegmentGrid {
  const grid: SegmentGrid = new Map();
  runs.forEach((run, r) => {
    for (let i = 1; i < run.pts.length; i++) {
      const a = run.pts[i - 1];
      const b = run.pts[i];
      const keys = new Set([cellKey(a.x, a.z), cellKey(b.x, b.z)]);
      for (const key of keys) {
        const list = grid.get(key) ?? [];
        list.push([a, b, r]);
        grid.set(key, list);
      }
    }
  });
  return grid;
}

/** The nearest point (x, z) of another run's segment within LAWN_PAIR_M of
 *  p, and its distance; null where none is. */
function nearestOther(
  grid: SegmentGrid,
  p: Pt,
  self: number
): { d: number; x: number; z: number } | null {
  let best: { d: number; x: number; z: number } | null = null;
  const cx = Math.floor(p.x / CELL_M);
  const cz = Math.floor(p.z / CELL_M);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const [a, b, r] of grid.get(`${cx + i},${cz + j}`) ?? []) {
        if (r === self) {
          continue;
        }
        const ux = b.x - a.x;
        const uz = b.z - a.z;
        const len2 = ux * ux + uz * uz;
        const t =
          len2 > 0
            ? Math.min(
                Math.max(((p.x - a.x) * ux + (p.z - a.z) * uz) / len2, 0),
                1
              )
            : 0;
        const x = a.x + ux * t;
        const z = a.z + uz * t;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= LAWN_PAIR_M && (best === null || d < best.d)) {
          best = { d, x, z };
        }
      }
    }
  }
  return best;
}

/**
 * Each lawn run's strip halves: a double track's two strips share the lawn
 * between them, each inner edge at the midpoint (QA V23: two strips 1.3 m
 * either side of tracks 3–4.5 m apart left a band of road between them).
 */
export function lawnHalves(runs: TrackRun[]): LawnHalves[] {
  const grid = segmentGrid(runs);
  return runs.map((run, r) => {
    const n = leftNormals(run.pts);
    const out: LawnHalves = {
      left: [],
      right: [],
      sharedLeft: [],
      sharedRight: [],
    };
    run.pts.forEach((p, i) => {
      out.left.push(BED_HALF.grass);
      out.right.push(BED_HALF.grass);
      out.sharedLeft.push(false);
      out.sharedRight.push(false);
      const q = nearestOther(grid, p, r);
      if (!q || q.d < 0.5) {
        return;
      }
      const side = (q.x - p.x) * n[i][0] + (q.z - p.z) * n[i][1];
      if (Math.abs(side) < LAWN_ACROSS * q.d) {
        return;
      }
      const half = Math.max(q.d / 2 - LAWN_SEAM_M, 0);
      if (side >= 0) {
        out.left[i] = half;
        out.sharedLeft[i] = true;
      } else {
        out.right[i] = half;
        out.sharedRight[i] = true;
      }
    });
    return out;
  });
}

/** A lawn strip with its own half-widths per point: the top, and a web
 *  down each side that is not shared with a neighbour's strip. */
function addLawn(acc: Mesh3, pts: Pt[], halves: LawnHalves): void {
  const n = leftNormals(pts);
  const web = BED_WEB.grass;
  const edge = (i: number, sign: number): [number, number, number] => {
    const w = sign > 0 ? halves.left[i] : halves.right[i];
    return [
      pts[i].x + n[i][0] * w * sign,
      pts[i].y,
      pts[i].z + n[i][1] * w * sign,
    ];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = edge(i, 1);
    const l1 = edge(i + 1, 1);
    const r0 = edge(i, -1);
    const r1 = edge(i + 1, -1);
    quad(acc, l0, r0, r1, l1, [0, 1, 0]);
    const out: [number, number, number] = [n[i][0], 0, n[i][1]];
    if (!(halves.sharedLeft[i] && halves.sharedLeft[i + 1])) {
      quad(
        acc,
        l0,
        l1,
        [l1[0], l1[1] - web, l1[2]],
        [l0[0], l0[1] - web, l0[2]],
        out
      );
    }
    if (!(halves.sharedRight[i] && halves.sharedRight[i + 1])) {
      quad(
        acc,
        r0,
        r1,
        [r1[0], r1[1] - web, r1[2]],
        [r0[0], r0[1] - web, r0[2]],
        [-out[0], 0, -out[2]]
      );
    }
  }
}

function addTrack(
  acc: TrackMeshes,
  run: TrackRun,
  bed: TramBed,
  gauge = TRAM_GAUGE,
  lawn?: LawnHalves
): void {
  const half = gauge / 2;
  if (bed === "street") {
    for (const side of [-1, 1]) {
      addRibbon(
        acc.streetRail,
        run.pts,
        side * half,
        RAIL_HALF,
        STREET_RAIL_WEB
      );
    }
    return;
  }
  addRail(acc.rail, run.pts, half);
  addRail(acc.rail, run.pts, -half);
  const strip = run.pts.map((p) => ({ ...p, y: p.y - BED_BELOW_RAIL }));
  if (bed === "grass" && lawn) {
    addLawn(acc.grass, strip, lawn);
    return;
  }
  addRibbon(
    bed === "grass" ? acc.grass : acc.ballast,
    strip,
    0,
    BED_HALF[bed],
    BED_WEB[bed]
  );
}

// --- the overhead line ----------------------------------------------------------

/** Where the contact wires are held (x, y projected; h wire height), so a
 *  hanger from a span ends exactly on its wire. */
type WirePoint = { h: number; x: number; y: number };

function addContactWire(
  w: Wires,
  held: WirePoint[],
  run: TrackRun,
  stations: number[],
  ctx: GroundContext
): void {
  const wire = run.pts.map((p, i) => ({
    x: p.x,
    y: p.y + CONTACT_WIRE_M - wireDrop(stations, run.d[i]),
    z: p.z,
  }));
  addWire(w, wire, WIRE_HALF.contact);
  for (let i = 0; i < wire.length; i++) {
    const q = wire[i];
    held.push({
      x: q.x + ctx.offset.cx,
      y: ctx.offset.cy - q.z,
      h: q.y,
    });
  }
}

/** The contact wire's height nearest a projected point (≤ 3 m away). */
function heldAt(held: WirePoint[], x: number, y: number): number | null {
  let best: number | null = null;
  let bd = 9;
  for (const p of held) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p.h;
    }
  }
  return best;
}

function worldPt(x: number, y: number, h: number, ctx: GroundContext): Pt {
  const w = epsgToWorld(x, y, ctx.offset);
  return { x: w.x, y: h, z: w.z };
}

/** A span wire between two anchors with a hanger down to every contact wire
 *  it crosses. */
function addSpan(
  w: Wires,
  f: TramFeature,
  held: WirePoint[],
  ctx: GroundContext
): void {
  if (f.geometry.type !== "LineString" || f.geometry.coordinates.length < 2) {
    return;
  }
  const [[ax, ay], [bx, by]] = f.geometry.coordinates;
  const ga = ctx.heightAt(ax, ay);
  const gb = ctx.heightAt(bx, by);
  if (ga === null || gb === null) {
    return;
  }
  const anchor =
    f.properties?.k === "rosette" ? SPAN_ANCHOR_M.rosette : SPAN_ANCHOR_M.mast;
  const crossings: { h: number; t: number }[] = [];
  for (const t of f.properties?.x ?? []) {
    const h = heldAt(held, ax + (bx - ax) * t, ay + (by - ay) * t);
    if (h !== null) {
      crossings.push({ t, h });
    }
  }
  const lift = spanLift(ga + anchor, gb + anchor, crossings);
  const ha = ga + anchor + lift;
  const hb = gb + anchor + lift;
  const n = 8;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(
      worldPt(
        ax + (bx - ax) * t,
        ay + (by - ay) * t,
        spanHeight(ha, hb, t),
        ctx
      )
    );
  }
  addWire(w, pts, WIRE_HALF.span);
  for (const { t, h } of crossings) {
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    addWire(
      w,
      [worldPt(x, y, spanHeight(ha, hb, t), ctx), worldPt(x, y, h, ctx)],
      WIRE_HALF.hanger
    );
  }
}

/** A cantilever arm from a mast out over its track, a stay from the mast
 *  head to its middle and a hanger at its end. */
function addArm(
  w: Wires,
  f: TramFeature,
  held: WirePoint[],
  ctx: GroundContext
): void {
  if (f.geometry.type !== "LineString" || f.geometry.coordinates.length < 2) {
    return;
  }
  const [[ax, ay], [bx, by]] = f.geometry.coordinates;
  const ga = ctx.heightAt(ax, ay);
  const gb = ctx.heightAt(bx, by);
  if (ga === null || gb === null) {
    return;
  }
  const wire = heldAt(held, bx, by) ?? gb + RAIL_TOP_M.street + CONTACT_WIRE_M;
  const armH = wire + 0.35;
  addWire(
    w,
    [worldPt(ax, ay, armH, ctx), worldPt(bx, by, armH, ctx)],
    WIRE_HALF.arm
  );
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  addWire(
    w,
    [
      worldPt(ax, ay, ga + MAST_HEIGHT_M - 0.2, ctx),
      worldPt(mx, my, armH, ctx),
    ],
    WIRE_HALF.arm / 2
  );
  addWire(
    w,
    [worldPt(bx, by, armH, ctx), worldPt(bx, by, wire, ctx)],
    WIRE_HALF.hanger
  );
}

function buildMasts(masts: Point2[], ctx: GroundContext): Instances | null {
  const stood: Matrix4[] = [];
  for (const [x, y] of masts) {
    const ground = ctx.heightAt(x, y);
    if (ground === null) {
      continue;
    }
    const w = epsgToWorld(x, y, ctx.offset);
    stood.push(new Matrix4().makeTranslation(w.x, ground - 0.2, w.z));
  }
  if (stood.length === 0) {
    return null;
  }
  const geo = new CylinderGeometry(0.1, 0.14, MAST_HEIGHT_M + 0.2, 8);
  geo.translate(0, (MAST_HEIGHT_M + 0.2) / 2, 0);
  const material = sceneMaterial("tram-mast", () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(MAST_COLOR),
      roughness: 0.7,
      metalness: 0.2,
    });
    m.positionNode = instancePosition();
    return m;
  });
  const mesh = new Instances(geo, material, stood.length);
  for (let i = 0; i < stood.length; i++) {
    mesh.setMatrixAt(i, stood[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "tram-masts";
  return mesh;
}

function buildTracks(
  tracks: TramFeature[],
  decks: DeckPoly[],
  ctx: GroundContext,
  w: Wires,
  held: WirePoint[]
): Mesh[] {
  const acc: TrackMeshes = {
    rail: mesh3(),
    streetRail: mesh3(),
    grass: mesh3(),
    ballast: mesh3(),
  };
  // a track's piece is its tile's alone (the bake cuts them at the edge):
  // its spans' decks need no owner
  const spans = { top: mesh3(), stone: mesh3() };
  const laid: { bed: TramBed; f: TramFeature; runs: TrackRun[] }[] = [];
  for (const f of tracks) {
    if (f.geometry.type !== "LineString") {
      continue;
    }
    const bed = f.properties?.bed ?? "street";
    const onBridge = f.properties?.bridge === 1;
    const runs = trackRuns(f, f.geometry.coordinates, bed, decks, ctx, spans);
    laid.push({ f, bed: onBridge ? "street" : bed, runs });
  }
  // the lawn tracks' strips, a double track's two sharing the lawn
  const lawnRuns = laid.flatMap((t) => (t.bed === "grass" ? t.runs : []));
  const halves = new Map(
    lawnHalves(lawnRuns).map((h, i) => [lawnRuns[i], h] as const)
  );
  for (const { f, bed, runs } of laid) {
    if (f.geometry.type !== "LineString") {
      continue;
    }
    for (const run of runs) {
      addTrack(acc, run, bed, f.properties?.g, halves.get(run));
    }
    const coords = f.geometry.coordinates;
    let length = 0;
    for (let i = 1; i < coords.length; i++) {
      length += Math.hypot(
        coords[i][0] - coords[i - 1][0],
        coords[i][1] - coords[i - 1][1]
      );
    }
    const stations = wireStations(length, f.properties?.s ?? []);
    for (const run of runs) {
      addContactWire(w, held, thinned(run, WIRE_STRIDE), stations, ctx);
    }
  }
  const parts: [Mesh3, number, number][] = [
    [acc.rail, TRAM_RAIL, -1],
    [acc.streetRail, TRAM_RAIL, -2],
    [acc.grass, MEADOW, -1],
    [acc.ballast, COLORS.ballast, -1],
  ];
  const meshes: Mesh[] = [];
  for (const [part, color, offsetUnits] of parts) {
    const m = meshFrom(part, color, {
      cast: false,
      offsetUnits,
      roughness: 0.9,
    });
    if (m) {
      m.name = "tram-track";
      meshes.push(m);
    }
  }
  for (const [part, color] of [
    [spans.top, COLORS.deckRoad],
    [spans.stone, COLORS.deckStone],
  ] as const) {
    const m = meshFrom(part, color, { cast: true });
    if (m) {
      m.name = "tram-span";
      meshes.push(m);
    }
  }
  return meshes;
}

/** The tram stops' signs: the furniture layer's stop model and instancing. */
function buildStops(stops: TramFeature[], ctx: GroundContext): Group | null {
  const signs: FurnitureFeature[] = stops.flatMap((f) =>
    f.geometry.type === "Point"
      ? [
          {
            geometry: f.geometry,
            properties: { k: "stop", a: f.properties?.a },
          },
        ]
      : []
  );
  if (signs.length === 0) {
    return null;
  }
  const group = buildFurniture(signs, ctx);
  group.name = "tram-stops";
  return group;
}

/** One tile's trams: tracks, masts, the overhead line and the stop signs.
 *  Empty input yields an empty group; freed with the tile
 *  (disposeObject3D). */
export function buildTram(
  features: TramFeature[],
  bridges: BridgeFeature[],
  ctx: GroundContext
): Group {
  const group = new Group();
  group.name = "tram";
  const byKind = (k: string) => features.filter((f) => f.properties?.k === k);
  const tracks = byKind("track");
  if (features.length === 0) {
    return group;
  }
  const decks = buildDeckTable(bridges, ctx);
  const w = wires();
  const held: WirePoint[] = [];
  const parts: (Group | Mesh | null)[] = buildTracks(
    tracks,
    decks,
    ctx,
    w,
    held
  );
  for (const f of [...byKind("span"), ...byKind("rosette")]) {
    addSpan(w, f, held, ctx);
  }
  for (const f of byKind("arm")) {
    addArm(w, f, held, ctx);
  }
  parts.push(
    buildMasts(
      [...byKind("mast"), ...byKind("pole")].flatMap((f) =>
        f.geometry.type === "Point" ? [f.geometry.coordinates] : []
      ),
      ctx
    ),
    wireMesh(w, "tram-wires"),
    buildStops(byKind("stop"), ctx)
  );
  for (const part of parts) {
    if (part) {
      group.add(part);
    }
  }
  return group;
}
