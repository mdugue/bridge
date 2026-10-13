/**
 * The trams' geometry (pipeline/bake/tram.py, OSM, ODbL): the tracks in
 * their bed, the decks under a span, the overhead line and where the masts
 * stand — baked into the fine terrain glTF (scripts/bake-lines.ts, ADR
 * 0029); the viewer gives them their materials (app/_components/
 * tram-layer.ts) and stands the stop signs. No THREE, no DOM.
 *
 * - Tracks: two rails per track at its mapped gauge (Dresden's 1 450 mm),
 *   the rail layer's profile. In the street the rail heads flush with the
 *   road (no sleepers, no groove: fewer, calmer lines); on a lawn
 *   (*Rasengleis*) the rails a hand higher over a meadow strip; on ballast
 *   a ballast strip. A track the OSM way puts on a bridge rides the deck
 *   (the rail layer's lift table, every deck kind).
 * - Overhead line: one contact wire per track 5.6 m over the rail top,
 *   sagging between the supports the bake found (`s`); span wires between
 *   masts or facade rosettes with a hanger down to each wire they cross;
 *   cantilever arms with a stay (camera-facing ribbons, lib/city/
 *   wire-mesh.ts).
 * - Masts: where each stands (the build merges a pole there).
 *
 * Built per fine terrain tile in the Y-up frame on the ground of every
 * tile (tracks and spans reach past the tile edge).
 */
import type { DeckPoly } from "./decks";
import type { BridgeFeature, TramBed, TramFeature } from "./features";
import { epsgToWorld, type GroundContext } from "./ground-clamp";
import { type JoinPoint, joinsAlong } from "./ground-join";
import { LEVEL_STEP } from "./levels";
import { addRibbon, type Mesh3, mesh3, type Pt, tangentsXZ } from "./mesh3";
import type { Point2 } from "./polyline";
import { subdividePolyline } from "./polyline";
import {
  addRail,
  addSpanDeck,
  buildDeckTable,
  lineLevelsAt,
  type MeshContext,
  spanRuns,
} from "./rail-mesh";
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
} from "./tram";
import { addWire, wires, type Wires } from "./wire-mesh";

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
/** half-widths (m) of the drawn wires */
const WIRE_HALF = { contact: 0.006, span: 0.005, hanger: 0.004, arm: 0.03 };
/** A mast stands this far into the ground (m). */
const MAST_SINK = 0.2;
/** The mast's radius at its foot (m: the pole the build merges). */
export const MAST_FOOT_R = 0.14;

// --- tracks -------------------------------------------------------------------

/** The rail top along one track, split where the ground has no data. */
interface TrackRun {
  /** distance (m) along the drawn line of each point */
  d: number[];
  /** each point stands on the ground (its level the ground, or a cut
   *  through it), not on a deck or a span */
  onGround: boolean[];
  pts: Pt[];
}

/** Half a tram span's deck (m): the track and a shoulder either side. */
const SPAN_HALF_M = 1.6;

/**
 * A track's rail top on the level its line runs on (lib/city/rail-mesh.ts
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
  ctx: MeshContext,
  spans: { stone: Mesh3; top: Mesh3 },
  joins: JoinPoint[]
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
  let run: TrackRun = { d: [], onGround: [], pts: [] };
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
      run = { d: [], onGround: [], pts: [] };
      return;
    }
    const w = epsgToWorld(p[0], p[1], ctx.offset);
    const grounded = level.mode === "ground" || level.mode === "cut";
    const top = grounded ? RAIL_TOP_M[bed] : RAIL_TOP_ON_DECK_M;
    const pt = { x: w.x, y: level.y + top, z: w.z };
    drawn.push(pt);
    run.pts.push(pt);
    run.d.push(d);
    run.onGround.push(grounded);
  });
  if (run.pts.length >= 2) {
    runs.push(run);
  }
  for (const span of spanRuns(levels, drawn)) {
    addSpanDeck(
      spans.top,
      spans.stone,
      span
        .filter((p): p is Pt => p !== null)
        .map((p) => ({ ...p, y: p.y - RAIL_TOP_ON_DECK_M })),
      SPAN_HALF_M,
      ctx,
      joins
    );
  }
  return runs;
}

/** Every `stride`-th point of a run, its ends kept: the contact wire
 *  needs no finer line than the rails'. */
function thinned(run: TrackRun, stride: number): TrackRun {
  const keep = run.pts.map(
    (_, i) => i % stride === 0 || i === run.pts.length - 1
  );
  return {
    d: run.d.filter((_, i) => keep[i]),
    onGround: run.onGround.filter((_, i) => keep[i]),
    pts: run.pts.filter((_, i) => keep[i]),
  };
}

/** The track meshes, one material each at runtime. */
export interface TrackMeshes {
  ballast: Mesh3;
  grass: Mesh3;
  rail: Mesh3;
  streetRail: Mesh3;
}

/**
 * The foot of a ribbon's web `lateral` off a run, `depth` under its top,
 * as joins between the points that stand on the ground (`onGround`) —
 * the ribbon's edge where `addRibbon` drops its web.
 */
function ribbonFeet(
  run: TrackRun,
  lateral: number,
  depth: number,
  offset: { cx: number; cy: number },
  joins: JoinPoint[]
): void {
  const tan = tangentsXZ(run.pts);
  const at = (i: number) => {
    const p = run.pts[i];
    const x = p.x - tan[i].y * lateral;
    const z = p.z + tan[i].x * lateral;
    return { x: x + offset.cx, y: offset.cy - z, z: p.y - depth };
  };
  for (let i = 0; i < run.pts.length - 1; i++) {
    if (run.onGround[i] && run.onGround[i + 1]) {
      joins.push(...joinsAlong("foot", at(i), at(i + 1)));
    }
  }
}

/**
 * One track in its bed. Where it meets the ground (on its ground and cut
 * samples; on a deck or a span it stands on the deck): a street rail's
 * web 2 cm under the road beside it; a lawn or ballast strip's web under
 * the ground at its edges, `BED_HALF` out from the centreline the levels
 * are read on — where the ground falls away across the track more
 * steeply than the web is deep, the strip's downhill edge stands over it;
 * where it rises, the edge is buried. The rails on a strip ride it.
 */
function addTrack(
  acc: TrackMeshes,
  run: TrackRun,
  bed: TramBed,
  offset: { cx: number; cy: number },
  joins: JoinPoint[],
  gauge = TRAM_GAUGE
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
      for (const edge of [-1, 1]) {
        ribbonFeet(
          run,
          side * half + edge * RAIL_HALF,
          STREET_RAIL_WEB,
          offset,
          joins
        );
      }
    }
    return;
  }
  addRail(acc.rail, run.pts, half);
  addRail(acc.rail, run.pts, -half);
  const strip = run.pts.map((p) => ({ ...p, y: p.y - BED_BELOW_RAIL }));
  addRibbon(
    bed === "grass" ? acc.grass : acc.ballast,
    strip,
    0,
    BED_HALF[bed],
    BED_WEB[bed]
  );
  for (const edge of [-1, 1]) {
    ribbonFeet(
      run,
      edge * BED_HALF[bed],
      BED_BELOW_RAIL + BED_WEB[bed],
      offset,
      joins
    );
  }
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

/**
 * Where each mast's foot stands (Y-up): MAST_SINK into the ground under
 * its point. Its joins: the foot's rim, MAST_FOOT_R round the point — on
 * a slope the downhill side of a pole planted at its centre's ground.
 */
function mastFeet(
  masts: Point2[],
  ctx: GroundContext,
  joins: JoinPoint[]
): Pt[] {
  const out: Pt[] = [];
  for (const [x, y] of masts) {
    const ground = ctx.heightAt(x, y);
    if (ground === null) {
      continue;
    }
    const w = epsgToWorld(x, y, ctx.offset);
    out.push({ x: w.x, y: ground - MAST_SINK, z: w.z });
    for (const [dx, dy] of [
      [MAST_FOOT_R, 0],
      [0, MAST_FOOT_R],
      [-MAST_FOOT_R, 0],
      [0, -MAST_FOOT_R],
    ]) {
      joins.push({ kind: "foot", x: x + dx, y: y + dy, z: ground - MAST_SINK });
    }
  }
  return out;
}

/** A tile's trams, part by part (each one material at runtime), and where
 *  they meet the ground (`joins`, ADR 0035). */
export interface TramParts {
  joins: JoinPoint[];
  /** each mast's foot (Y-up): the pole stands MAST_HEIGHT_M + MAST_SINK
   *  tall from it */
  masts: Pt[];
  spanStone: Mesh3;
  spanTop: Mesh3;
  tracks: TrackMeshes;
  wires: Wires;
}

/** One tile's tracks, span decks, overhead line and masts (the stop signs
 *  are the viewer's: furniture, app/_components/tram-layer.ts). */
export function tramParts(
  features: TramFeature[],
  bridges: BridgeFeature[],
  ctx: MeshContext
): TramParts {
  const byKind = (k: string) => features.filter((f) => f.properties?.k === k);
  const joins: JoinPoint[] = [];
  const tracks: TrackMeshes = {
    rail: mesh3(),
    streetRail: mesh3(),
    grass: mesh3(),
    ballast: mesh3(),
  };
  // a track's piece is its tile's alone (the bake cuts them at the edge):
  // its spans' decks need no owner
  const spans = { top: mesh3(), stone: mesh3() };
  const w = wires();
  const held: WirePoint[] = [];
  const out: TramParts = {
    joins,
    masts: [],
    spanStone: spans.stone,
    spanTop: spans.top,
    tracks,
    wires: w,
  };
  if (features.length === 0) {
    return out;
  }
  const decks = buildDeckTable(bridges, ctx);
  for (const f of byKind("track")) {
    if (f.geometry.type !== "LineString") {
      continue;
    }
    const bed = f.properties?.bed ?? "street";
    const onBridge = f.properties?.bridge === 1;
    const coords = f.geometry.coordinates;
    const runs = trackRuns(f, coords, bed, decks, ctx, spans, joins);
    for (const run of runs) {
      addTrack(
        tracks,
        run,
        onBridge ? "street" : bed,
        ctx.offset,
        joins,
        f.properties?.g
      );
    }
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
  for (const f of [...byKind("span"), ...byKind("rosette")]) {
    addSpan(w, f, held, ctx);
  }
  for (const f of byKind("arm")) {
    addArm(w, f, held, ctx);
  }
  out.masts = mastFeet(
    byKind("mast").flatMap((f) =>
      f.geometry.type === "Point" ? [f.geometry.coordinates] : []
    ),
    ctx,
    joins
  );
  return out;
}

/** The tram stops of a tile's features: what the viewer stands a sign at
 *  and the inquiry asks (the fine terrain's extras carry them). */
export function tramStops(features: readonly TramFeature[]): TramFeature[] {
  return features.filter(
    (f) => f.properties?.k === "stop" && f.geometry.type === "Point"
  );
}
