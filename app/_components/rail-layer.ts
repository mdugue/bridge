import { Group, Mesh, ShapeUtils, Vector2 } from "three/webgpu";
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
  beamSpan,
  beamSupports,
  type DeckSupport,
  deckCarrier,
  deckDepth,
  intradosAt,
  masonryArches,
  type MasonryPier,
  type MasonrySpan,
  type Parabola,
  PIER_SPACING,
  parapetStyle,
  placeRibs,
  ribPeaks,
  ribProfile,
  ribRuns,
} from "@/lib/city/bridge";
import {
  bridgeDecks,
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
import { OVERPASS_DEPTH_M, OVERPASS_M } from "@/lib/city/catenary";
import { DECK_REACH_M, RIDES, railPrefer } from "@/lib/city/line-levels";
import {
  platformTops,
  TrackIndex,
  type TrackSample,
} from "@/lib/city/platform-level";
import { decodeProfile } from "@/lib/city/line-profile";
import { PASSAGE_UNDER_DECK } from "@/lib/city/passages";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import {
  BURIED_M,
  type Bed,
  BedIndex,
  RAIL_BED_HALF_M,
  TRACK_PITCH_M,
} from "@/lib/city/track-beds";
import { finished, type Steps } from "@/lib/city/build-steps";
import { type DeckKind, deckMaterial, stoneMaterial } from "./bridge-surface";
import {
  addCatenary,
  type CatenaryRun,
  catenaryParts,
  catenaryWires,
} from "./catenary-layer";
import {
  addColumn,
  addFootprint,
  addRibbon,
  addStrut,
  cross,
  type Mesh3,
  mesh3,
  meshFrom,
  meshSteps,
  outward,
  type P3,
  type Pt,
  pushTri,
  quad,
  ringWinding,
  tangentsXZ,
  unit,
} from "./mesh-kit";
import {
  addSleepers,
  SLEEPER_TOP,
  type SleeperRibbons,
  sleeperMesh,
  sleeperRibbons,
} from "./track-bed";

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
 *  - Rails: OSM's every track one by one, and the Basis-DLM ver03_l
 *    centrelines (heavy rail) OSM has none beside, built per fine terrain
 *    tile on the cross-tile heightAt (every loaded terrain) and split at NoData
 *    gaps, so tracks follow the ground across tile seams; their heads 0.17 m
 *    over the level their line runs on (the DGM holds the ballast's surface;
 *    on a rail deck the ballast runs on across it), flush in the paving; the
 *    sleepers under them (track-bed.ts); a buried stretch (cut under a lid)
 *    not drawn.
 *  - Bridges: ONE clean slab volume per Basis-DLM ver06_f deck polygon (top +
 *    continuous fascia), flush parapet walls (no floating cap), piers dropped even
 *    over the river. Rails ride the deck directly (no ballast stacked on top).
 *  - Platforms: OSM railway=platform polygons (ODbL), on the level of the
 *    track beside them (lib/city/platform-level.ts).
 *  - Catenary: over the contact lines, masts and portals with their wires
 *    (catenary-layer.ts, lib/city/catenary.ts).
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
// The DGM already holds the ballast's surface: the ground at a track and
// 5 m beside it differ by nothing. Drawn 0.18 m over it with the rail head
// 0.16 m above that, the heads stood 0.17 m too high; 0.08 m over a deck's
// measured top, 0.09 m too low.
const BALLAST_RAISE = 0.03; // ballast surface above the DGM: off the ground's own (m)
const BALLAST_DROP = 0.45; // ballast shoulder depth at the edge (m)
const RAIL_RAISE = 0.17; // rail head above the ballast's surface, a rail deck's top too (m)
const RAIL_PAVED_RAISE = 0.02; // rail head above the paving it is set in (m)
const BED_HALF_M = RAIL_BED_HALF_M; // half a one-track ballast bed (m)
const RAIL_WEB = 0.11; // rail vertical web depth so it reads obliquely (m)
const GAUGE = 1.435; // standard-gauge rail spacing (m)
const TRACK_PITCH = TRACK_PITCH_M; // spacing between parallel track centres (m)
const RAIL_HALF = 0.075; // half-width of a drawn rail (m)
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
const END_EDGE_COS = 0.5; // a ring edge this far off the axis is an abutment end
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
  mast: 0xa9_ad_a6, // galvanised steel: the catenary's masts and portals
};

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
  for (let i = 0; i < pts.length; i++) {
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

/** A bridge's ring, per-vertex deck tops and properties from its baked
 *  feature, or null when it is no deck. */
function deckOf(
  f: BridgeFeature,
  offset: { cx: number; cy: number }
): {
  line: { x: number; y: number; z: number }[] | null;
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
  for (const { ring, topY, props, line } of parsed) {
    decks.push(deckPoly(ring.pts, topY, props.kind, line));
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

function worldToEpsg(
  p: { x: number; z: number },
  offset: { cx: number; cy: number }
) {
  return { x: p.x + offset.cx, y: offset.cy - p.z };
}

/** A single rail: a thin top ribbon + two vertical webs along a run of points. */
export function addRail(acc: Mesh3, pts: Pt[], lateral: number): void {
  addRibbon(acc, pts, lateral, RAIL_HALF, RAIL_WEB);
}

type BridgeProps = NonNullable<BridgeFeature["properties"]>;

/** A bridge feature's properties with defaults (`properties` may be null). */
function bridgeProps(f: BridgeFeature): {
  deck: number[];
  kind: NonNullable<BridgeProps["kind"]>;
  structure: string;
} {
  return {
    deck: f.properties?.deck ?? [],
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
  const d2 = (a: number[], b: number[]) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const stack = [corners];
  while (stack.length > 0) {
    const tri = stack.pop() as number[][];
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
  for (let i = 0; i < n; i++) {
    const a = ring.pts[i];
    const b = ring.pts[(i + 1) % n];
    const pieces = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DECK_RING_STEP)
    );
    pts.push(a);
    ys.push(frame.deckAt(frame.ringS[i]));
    ringS.push(frame.ringS[i]);
    for (let k = 1; k < pieces; k++) {
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
  for (let v = first; v < top.pos.length / 3; v++) {
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
 *  was laid, the frame null on an older file without an axis. */
function* drawDeck(
  f: BridgeFeature,
  baked: Ring2,
  bakedY: number[],
  out: BridgeMeshes,
  ctx: RailContext,
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

/** Draws one bridge: deck, parapets, whatever carries it and stands on it. */
function* drawBridge(
  f: BridgeFeature,
  baked: Ring2,
  bakedY: number[],
  out: BridgeMeshes,
  ctx: RailContext
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
 *  and what stands on them). The rails' deck table is buildDeckTable's. */
function* buildBridges(
  features: BridgeFeature[],
  ctx: RailContext,
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
      standing++;
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
/** How finely an area is draped: its triangles split down to `step` (m)
 *  while the surface strays from them by more than `tolerance` (m). */
interface Drape {
  step: number;
  tolerance: number;
  /** where the surface is smooth enough for `fine` instead (world x, z) */
  fineAt?: (x: number, z: number) => boolean;
  fine?: { step: number; tolerance: number };
}
const GROUND_DRAPE: Drape = { step: DRAPE_M, tolerance: DRAPE_TOLERANCE_M };
/** On the beds the surface is the tracks' profiles — smooth, its only
 *  creases where two beds meet: draped to the centimetres the sleepers
 *  stand over it. */
const BED_DRAPE = { step: 1, tolerance: 0.02 };
/** A triangle longer than this (m) is split whatever its probes say: four
 *  probes can miss a passage under a deck. */
const DRAPE_PROBE_M = 48;

/** Draped triangles per step (build-steps.ts). */
const DRAPE_RUN = 512;

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
function* addDrapedArea(
  acc: Mesh3,
  rings: Ring2[],
  raise: number,
  drop: number,
  ctx: RailContext,
  skip: (x: number, z: number) => boolean,
  how: Drape = GROUND_DRAPE
): Steps<void> {
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
  const centre = (a: XZ, b: XZ, c: XZ): XZ => ({
    x: (a.x + b.x + c.x) / 3,
    z: (a.z + b.z + c.z) / 3,
  });
  const limits = (a: XZ, b: XZ, c: XZ) => {
    const m = centre(a, b, c);
    return how.fine && how.fineAt?.(m.x, m.z) ? how.fine : how;
  };
  const flat = (a: XZ, b: XZ, c: XZ, tolerance: number): boolean => {
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
      [centre(a, b, c), (ya + yb + yc) / 3],
    ];
    return probes.every(([p, plane]) => {
      const y = yAt(p.x, p.z);
      return y === null || Math.abs(y - plane) <= tolerance;
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
  // each triangle split into four until it is short or flat enough —
  // depth first, as a recursion would, on a stack of its own so that the
  // drape can pause between triangles (a 1 m drape over a yard is a
  // hundred thousand of them)
  const stack: XZ[] = [];
  function* drape(a0: XZ, b0: XZ, c0: XZ): Steps<void> {
    stack.push(a0, b0, c0);
    let n = 0;
    while (stack.length > 0) {
      const c = stack.pop() as XZ;
      const b = stack.pop() as XZ;
      const a = stack.pop() as XZ;
      if (++n % DRAPE_RUN === 0) {
        yield;
      }
      const longest = Math.max(
        Math.hypot(b.x - a.x, b.z - a.z),
        Math.hypot(c.x - b.x, c.z - b.z),
        Math.hypot(a.x - c.x, a.z - c.z)
      );
      const { step, tolerance } = limits(a, b, c);
      if (
        longest <= step ||
        (longest <= DRAPE_PROBE_M && flat(a, b, c, tolerance))
      ) {
        emit(a, b, c);
        continue;
      }
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      // last in, first out: the first of the four goes on last
      stack.push(ab, bc, ca, ca, bc, c, ab, b, bc, a, ab, ca);
    }
  }
  const all = [outer, ...holes].flat();
  const tris = ShapeUtils.triangulateShape(
    outer.map((p) => new Vector2(p.x, p.z)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.z)))
  );
  for (const [ia, ib, ic] of tris) {
    yield* drape(all[ia], all[ib], all[ic]);
  }
  // the fascia along the outline and round the holes, facing out of the
  // area, its top on the ground every DRAPE_M
  for (const [k, raw] of [outer, ...holes].entries()) {
    const ring = densified(raw, Math.min((how.fine ?? how).step * 4, DRAPE_M));
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
 * (`addDrapedArea`) on the beds its tracks lie on (`beds`: their profile,
 * lib/city/track-beds.ts — the ground the bake laid under them) or, off
 * every bed and without them, on the ground; left out on the rail decks,
 * where the tracks ride the deck, and where `buried` (a track the line
 * levels cut under a lid: its bed is not on the lid's top). Exported for
 * tests.
 */
export function buildBallast(
  features: AreaFeature[],
  ctx: RailContext,
  decks: DeckPoly[] = [],
  buried: (x: number, z: number) => boolean = () => false,
  beds?: BedIndex
): Mesh | null {
  return finished(ballastSteps(features, ctx, decks, buried, beds));
}

function* ballastSteps(
  features: AreaFeature[],
  ctx: RailContext,
  decks: DeckPoly[],
  buried: (x: number, z: number) => boolean,
  beds?: BedIndex
): Steps<Mesh | null> {
  const acc = mesh3();
  const skip = (x: number, z: number) =>
    decksAt(decks, x, z, RIDES.rail, "decks").length > 0 || buried(x, z);
  const surface = beds
    ? {
        ...ctx,
        heightAt: (x: number, y: number) =>
          beds.levelAt(x, y) ?? ctx.heightAt(x, y),
      }
    : ctx;
  // on the beds finely, off them as the ground
  const drape: Drape = beds
    ? {
        ...GROUND_DRAPE,
        fine: BED_DRAPE,
        fineAt: (x, z) => {
          const e = worldToEpsg({ x, z }, ctx.offset);
          return beds.levelAt(e.x, e.y) !== null;
        },
      }
    : GROUND_DRAPE;
  for (const f of features) {
    for (const rings of polygonsOf(f.geometry)) {
      yield* addDrapedArea(
        acc,
        rings.map((r) => ringToWorld(r, ctx.offset)),
        BALLAST_RAISE,
        BALLAST_DROP,
        surface,
        skip,
        drape
      );
    }
  }
  return yield* meshSteps(acc, COLORS.ballast, {
    cast: false,
    offsetUnits: -2,
    roughness: 1,
  });
}

/** A line on the ground rides an approach ramp up to its deck while the
 *  ramp stays this close above the ground (m) — not one passing over it,
 *  far above (a track under a deck's end). */
const APPROACH_RIDE_M = 1.5;

/** Whether a line's baked profile fits its `n` samples: the layer then
 *  draws it on the profile (`lineLevelsAt`) and its ballast on its bed. */
export function isProfiled(
  baked: { lz?: (number | null)[] },
  n: number
): boolean {
  return baked.lz?.length === n;
}

/**
 * The level of every sample of a line (lib/city/levels.ts). Where the
 * build step baked the line (scripts/line-levels.ts), its runs off the
 * ground (`lv`) give each sample's mode and its profile (`lz`,
 * lib/city/line-profile.ts) the height: the track lies on its grade and
 * vertical curves, the ground was laid under it (lib/city/track-beds.ts).
 * Else the line is solved over this piece alone (with what its source
 * says: `prefer`, `below`), on the ground sample by sample, riding an
 * approach ramp close above it; on a deck it rides the deck top nearest
 * the run's line. Null where the ground is unknown and no level holds it
 * (the line breaks there).
 */
export function lineLevelsAt(
  pts: readonly Point2[],
  line: LevelLine,
  baked: { lv?: LevelRun[]; lz?: (number | null)[] } | undefined,
  ctx: GroundContext,
  decks: DeckPoly[],
  prefer?: "deck" | "ground",
  below?: boolean
): (Level | null)[] {
  if (baked && isProfiled(baked, pts.length)) {
    return profiledLevels(pts, baked.lv ?? [], decodeProfile(baked.lz ?? []));
  }
  const runs = baked?.lv;
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
        pts.map((_, i) => ({
          d: d[i],
          ground: ground[i],
          decks: under[i],
          below,
        })),
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

/** The levels of a baked line: each sample's mode from its run (the
 *  ground outside every run), its height the profile's. */
function profiledLevels(
  pts: readonly Point2[],
  runs: readonly LevelRun[],
  profile: readonly (number | null)[]
): (Level | null)[] {
  const d: number[] = [];
  pts.forEach(([ex, ey], i) => {
    d.push(
      i === 0
        ? 0
        : d[i - 1] + Math.hypot(ex - pts[i - 1][0], ey - pts[i - 1][1])
    );
  });
  return profile.map((y, i) =>
    y === null ? null : { mode: runLevelAt(runs, d, i)?.mode ?? "ground", y }
  );
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

/** A rail line as the layer draws it, its levels solved once for the
 *  rails, the sleepers, the ballast's gaps, the platforms and the
 *  catenary. */
interface DrawnLine {
  /** distance along the line per sample (m) */
  d: number[];
  /** the samples (EPSG) */
  dense: Point2[];
  /** the gauge (m) */
  gauge: number;
  /** each sample's level; null where the line breaks or is buried */
  levels: (Level | null)[];
  /** the mapped catenary masts ([station, offset to the right], m: the
   *  scene's lateral, see `mastsAcross`) */
  masts: readonly (readonly [number, number])[];
  /** a contact line over it (`electrified` 1) */
  overhead: boolean;
  /** set in the paving: no ballast, no sleepers, the rail head flush */
  paved: boolean;
  /** its heights are the baked profile (`lz`): its ballast lies on it */
  profiled: boolean;
  /** the samples where the line runs buried (world x, z) */
  buried: XZ[];
  tracks: number;
  /** the samples in the world frame (y unset) */
  world: XZ[];
}

/** The file's mast offsets lie to the map's left of the line
 *  (rail_osm.py `masts`); a lateral here is along (−tz, tx), the map's
 *  right, the scene's z being −north. */
function mastsAcross(
  m: readonly (readonly [number, number])[]
): (readonly [number, number])[] {
  return m.map(([s, o]) => [s, -o] as const);
}

/** Each track's lateral from its line's centre (m, along (−tz, tx)). */
function trackOffsets(tracks: number): number[] {
  return Array.from(
    { length: tracks },
    (_, k) => (k - (tracks - 1) / 2) * TRACK_PITCH
  );
}

/** The rail head over the level a track runs on (m): the DGM holds the
 *  ballast's surface, and a rail deck's measured top the ballast run on
 *  across it; a track set in the paving shows its head flush with it. */
function railRaise(paved: boolean): number {
  return paved ? RAIL_PAVED_RAISE : RAIL_RAISE;
}

/**
 * The samples of the cuts the build opens as passages under a deck (their
 * share under a drawn deck at least PASSAGE_UNDER_DECK, as
 * scripts/line-levels.ts `sitePassages` decides): the track shows through
 * them. Any other cut deeper than BURIED_M runs under a lid — under a deck
 * too, where only a stretch of a longer cut passes (a tunnel's portal
 * under a station's bridges).
 */
function openedCuts(
  levels: readonly (Level | null)[],
  dense: readonly Point2[],
  ctx: RailContext,
  decks: DeckPoly[]
): boolean[] {
  const opened = levels.map(() => false);
  for (const [a, b] of modeRuns(levels, "cut")) {
    let covered = 0;
    for (let i = a; i <= b; i++) {
      const w = epsgToWorld(dense[i][0], dense[i][1], ctx.offset);
      if (decksAt(decks, w.x, w.z, undefined, "all", DECK_REACH_M).length) {
        covered++;
      }
    }
    if (covered >= PASSAGE_UNDER_DECK * (b - a + 1)) {
      opened.fill(true, a, b + 1);
    }
  }
  return opened;
}

/** Every line's samples and levels; a buried sample's level is null. */
function* drawnLines(
  features: RailFeature[],
  ctx: RailContext,
  decks: DeckPoly[]
): Steps<DrawnLine[]> {
  const out: DrawnLine[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const p = f.properties ?? {};
    const dense = subdividePolyline(f.geometry.coordinates, SAMPLE_M);
    const levels = lineLevelsAt(
      dense,
      "rail",
      p,
      ctx,
      decks,
      railPrefer(f),
      (p.layer ?? 0) < 0
    );
    const d: number[] = [];
    const world: XZ[] = [];
    const buried: XZ[] = [];
    const opened = openedCuts(levels, dense, ctx, decks);
    dense.forEach(([ex, ey], i) => {
      d.push(
        i === 0
          ? 0
          : d[i - 1] + Math.hypot(ex - dense[i - 1][0], ey - dense[i - 1][1])
      );
      const w = epsgToWorld(ex, ey, ctx.offset);
      world.push({ x: w.x, z: w.z });
      const level = levels[i];
      const g = ctx.heightAt(ex, ey);
      if (
        level?.mode === "cut" &&
        !opened[i] &&
        g !== null &&
        g - level.y > BURIED_M
      ) {
        buried.push(world[i]);
        levels[i] = null;
      }
    });
    out.push({
      d,
      dense,
      gauge: p.g ?? GAUGE,
      levels,
      masts: mastsAcross(p.m ?? []),
      overhead: p.electrified === 1,
      paved: p.paved === 1,
      profiled: isProfiled(p, dense.length),
      buried,
      tracks: Math.min(Math.max(p.tracks ?? 1, 1), 3),
      world,
    });
    yield;
  }
  return out;
}

/** How far past its bed's edge a yard's ballast takes the bed's level
 *  (m): half the gap pipeline/bake/rail.py closes between two beds
 *  (YARD_GAP_M). */
const BED_MARGIN_M = 2;

/**
 * The beds the baked lines lie on (lib/city/track-beds.ts): each stretch
 * on the ground at its profile, as the terrain bake laid the ground under
 * it. Undefined when no line is baked (the ballast drapes the ground).
 */
function ballastBeds(lines: readonly DrawnLine[]): BedIndex | undefined {
  const beds: Bed[] = [];
  for (const l of lines) {
    if (!l.profiled || l.paved) {
      continue;
    }
    const shape = {
      half: RAIL_BED_HALF_M + ((l.tracks - 1) * TRACK_PITCH) / 2,
      drop: 0,
    };
    let run: { coords: Point2[]; z: number[] } = { coords: [], z: [] };
    const flush = () => {
      if (run.coords.length >= 2) {
        beds.push({ ...run, ...shape });
      }
      run = { coords: [], z: [] };
    };
    l.levels.forEach((level, i) => {
      if (level?.mode !== "ground") {
        flush();
        return;
      }
      run.coords.push(l.dense[i]);
      run.z.push(level.y);
    });
    flush();
  }
  if (beds.length === 0) {
    return undefined;
  }
  return new BedIndex(beds, BED_MARGIN_M);
}

/** Whether a point lies on the bed of a buried stretch (the bed's half
 *  width and a little more). */
function buriedTest(
  lines: readonly DrawnLine[]
): (x: number, z: number) => boolean {
  const pts: { half: number; x: number; z: number }[] = [];
  for (const l of lines) {
    const half = BED_HALF_M + ((l.tracks - 1) * TRACK_PITCH) / 2;
    for (const p of l.buried) {
      pts.push({ half, x: p.x, z: p.z });
    }
  }
  if (pts.length === 0) {
    return () => false;
  }
  const cell = 16;
  const grid = new Map<string, typeof pts>();
  for (const p of pts) {
    const k = `${Math.floor(p.x / cell)}:${Math.floor(p.z / cell)}`;
    const list = grid.get(k);
    if (list) {
      list.push(p);
    } else {
      grid.set(k, [p]);
    }
  }
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const p of grid.get(`${cx + dx}:${cz + dz}`) ?? []) {
          // a sample every 4 m: within its half-step along, the bed across
          if (
            Math.hypot(p.x - x, p.z - z) <= Math.hypot(p.half, SAMPLE_M / 2)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };
}

/** The runs of consecutive indices where `has` holds: [first, last]. */
function runsWhere(n: number, has: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let first = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && has(i)) {
      if (first < 0) {
        first = i;
      }
    } else if (first >= 0) {
      if (i - 1 > first) {
        out.push([first, i - 1]);
      }
      first = -1;
    }
  }
  return out;
}

/** A rail deck the sleepers lie open on (a truss: no ballast bed). */
function openDecks(features: BridgeFeature[], ctx: RailContext): DeckPoly[] {
  return bridgeDecks(
    features.filter(
      (f) =>
        f.properties?.kind === "rail" &&
        (f.properties.structure ?? "").includes("truss")
    ),
    ctx.offset
  );
}

/** What the rails are built into. */
interface RailMeshes {
  catenary: CatenaryRun[];
  rail: Mesh3;
  sleepers: SleeperRibbons;
  spans: { stone: Mesh3; top: Mesh3 };
  /** every drawn sample, for the platforms beside the tracks */
  tracks: TrackSample[];
}

/** One line's rails, sleepers, span decks, platform samples and catenary
 *  runs into `out`. */
function addLine(
  out: RailMeshes,
  line: DrawnLine,
  ctx: RailContext,
  decks: { all: DeckPoly[]; open: DeckPoly[] }
): void {
  const { open } = decks;
  const raise = railRaise(line.paved);
  const head = line.levels.map((level, i): Pt | null =>
    level
      ? { x: line.world[i].x, y: level.y + raise, z: line.world[i].z }
      : null
  );
  const offsets = trackOffsets(line.tracks);
  for (const [a, b] of runsWhere(head.length, (i) => head[i] !== null)) {
    const run = head.slice(a, b + 1) as Pt[];
    const d = line.d.slice(a, b + 1);
    const opens = run.map(
      (p, k) =>
        line.levels[a + k]?.mode === "deck" &&
        decksAt(open, p.x, p.z, undefined, "decks").length > 0
    );
    const bed = run.map((p) => ({ ...p, y: p.y - raise + SLEEPER_TOP }));
    for (const lateral of offsets) {
      addRail(out.rail, run, lateral + line.gauge / 2);
      addRail(out.rail, run, lateral - line.gauge / 2);
      if (!line.paved) {
        addSleepers(out.sleepers, bed, d, lateral, opens);
      }
    }
    if (line.overhead) {
      out.catenary.push(...catenaryRuns(line, [a, b], run, offsets, decks.all));
    }
  }
  line.levels.forEach((level, i) => {
    if (level) {
      out.tracks.push({
        raised: level.mode === "deck" || level.mode === "span",
        x: line.world[i].x,
        y: level.y,
        z: line.world[i].z,
      });
    }
  });
  const half =
    ((line.tracks - 1) / 2) * TRACK_PITCH + line.gauge / 2 + SPAN_SHOULDER_M;
  for (const span of spanRuns(line.levels, head)) {
    // a line near a seam is in both tiles' files: the span's owner
    // draws its deck
    const pts = span.filter((p): p is Pt => p !== null);
    const centre = pts[Math.floor(pts.length / 2)];
    const e = centre
      ? worldToEpsg({ x: centre.x, z: centre.z }, ctx.offset)
      : null;
    if (e && (!ctx.owns || ctx.owns(e.x, e.y))) {
      addSpanDeck(
        out.spans.top,
        out.spans.stone,
        pts.map((p) => ({ ...p, y: p.y - raise + BALLAST_RAISE })),
        half,
        ctx
      );
    }
  }
}

/** The catenary runs of one stretch [a, b] of a line, one per track: the
 *  rail heads offset to each track, the structure a mast there stands on,
 *  the soffit of a bridge over it (a deck OVERPASS_M over the rail head,
 *  OVERPASS_DEPTH_M deep), the mapped masts on the track nearest each. */
function catenaryRuns(
  line: DrawnLine,
  [a, b]: [number, number],
  run: Pt[],
  offsets: number[],
  decks: DeckPoly[]
): CatenaryRun[] {
  const tan = tangentsXZ(run);
  const deck = line.levels
    .slice(a, b + 1)
    .map((l) => (l && l.mode !== "ground" && l.mode !== "cut" ? l.y : null));
  const over = run.map((p) => {
    const tops = decksAt(decks, p.x, p.z, undefined, "decks").filter(
      (y) => y > p.y + OVERPASS_M
    );
    return tops.length > 0 ? Math.min(...tops) - OVERPASS_DEPTH_M : null;
  });
  const d = line.d.slice(a, b + 1);
  return offsets.map((lateral) => ({
    d,
    deck,
    over,
    mapped: line.masts
      .filter(
        ([, o]) =>
          offsets.reduce((best, x) =>
            Math.abs(o - x) < Math.abs(o - best) ? x : best
          ) === lateral
      )
      .map(([s, o]) => [s, o - lateral] as const),
    pts: run.map((p, i) => ({
      x: p.x - tan[i].y * lateral,
      y: p.y,
      z: p.z + tan[i].x * lateral,
    })),
  }));
}

/** Steel rails: one pair per track, on the level their line runs on
 *  (`lineLevelsAt`): the ground, a rail deck, a span (with its deck);
 *  the sleepers under them; the catenary over the contact lines. */
function* buildRails(
  lines: readonly DrawnLine[],
  ctx: RailContext,
  decks: { all: DeckPoly[]; open: DeckPoly[] },
  out: RailMeshes
): Steps<Mesh[]> {
  for (const line of lines) {
    addLine(out, line, ctx, decks);
    yield;
  }
  const meshes: Mesh[] = [];
  const rails = yield* meshSteps(out.rail, COLORS.rail, {
    cast: false,
    offsetUnits: -1,
    roughness: 0.5,
  });
  if (rails) {
    meshes.push(rails);
  }
  const sleepers = sleeperMesh(out.sleepers);
  if (sleepers) {
    meshes.push(sleepers);
  }
  return meshes;
}

/** A few samples of the ground inside a ring (world), a grid of at most
 *  ~64 points. */
function groundInside(ring: Ring2, ctx: RailContext): number[] {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of ring.pts) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  const step = Math.max(2, Math.max(maxX - minX, maxZ - minZ) / 8);
  const out: number[] = [];
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      if (pointInRing(ring.pts, x, z)) {
        const e = worldToEpsg({ x, z }, ctx.offset);
        const g = ctx.heightAt(e.x, e.y);
        if (g !== null) {
          out.push(g);
        }
      }
    }
  }
  return out;
}

/** A platform's height above the rail top (m) and the trains it serves,
 *  from the bake (pipeline/bake/rail.py `platforms`). */
function platformOf(f: AreaFeature): { h?: number; kind?: string } {
  const h = f.properties?.h;
  const k = f.properties?.k;
  return {
    h: typeof h === "number" ? h : undefined,
    kind: typeof k === "string" ? k : undefined,
  };
}

/**
 * Station platforms on the level of the track beside them, their height
 * over its rail head (lib/city/platform-level.ts): slabs from the polygons,
 * a slim ribbon for a platform OSM maps as a line.
 */
function buildPlatforms(
  features: AreaFeature[],
  ctx: RailContext,
  index: TrackIndex
): Mesh | null {
  const acc = mesh3();
  for (const f of features) {
    const g = f.geometry;
    const kind = platformOf(f);
    if (g?.type === "Polygon" || g?.type === "MultiPolygon") {
      for (const outer of outerRings(g)) {
        const ring = ringToWorld(outer, ctx.offset);
        const placed = platformTops(
          {
            ...kind,
            ground: ring.pts.map((p) => {
              const e = worldToEpsg(p, ctx.offset);
              return ctx.heightAt(e.x, e.y);
            }),
            inside: groundInside(ring, ctx),
            ring: ring.pts,
          },
          index,
          RAIL_RAISE
        );
        if (placed) {
          addFootprint(acc, ring, placed.top, placed.depth);
        }
      }
    } else if (g?.type === "LineString") {
      const run: Pt[] = [];
      for (const [ex, ey] of subdividePolyline(g.coordinates, SAMPLE_M)) {
        const ground = ctx.heightAt(ex, ey);
        const w = epsgToWorld(ex, ey, ctx.offset);
        const placed =
          ground === null
            ? null
            : platformTops(
                { ...kind, ground: [ground], inside: [], ring: [w] },
                index,
                RAIL_RAISE
              );
        if (placed) {
          run.push({ x: w.x, y: placed.top[0], z: w.z });
        }
      }
      addRail(acc, run, 0); // a thin slab ribbon for line-mapped platforms
    }
  }
  const mesh = meshFrom(acc, COLORS.platform, { cast: true });
  if (mesh) {
    mesh.name = "rail-platforms";
  }
  return mesh;
}

/**
 * Builds the WHOLE tile block's rails, bridges, ballast and platforms (one
 * call, cross-tile heightAt) as stylized geometry on the Y-up scene. Bridges
 * build first so the rails can ride their decks; the rails' levels next,
 * so the ballast leaves out where a track runs buried and the platforms
 * stand on their track's level; the catenary over the contact lines last.
 * Empty inputs yield an empty group; the group is freed with the scene
 * (disposeObject3D).
 */
export function buildRail(features: RailFeatures, ctx: RailContext): Group {
  return finished(railSteps(features, ctx));
}

/** `buildRail` in steps: per bridge, line and draped triangle run
 *  (build-steps.ts). */
export function* railSteps(
  features: RailFeatures,
  ctx: RailContext
): Steps<Group> {
  const group = new Group();
  group.name = "rail";

  const decks = buildDeckTable(features.bridges, ctx);
  yield;
  const bridgeMeshes = yield* buildBridges(features.bridges, ctx, decks);
  // what the inquiry probe raycasts for a bridge (bridge-ask.ts)
  for (const mesh of bridgeMeshes) {
    mesh.userData.bridge = true;
  }
  // add() with no arguments logs a three error, so guard the spread.
  if (bridgeMeshes.length > 0) {
    group.add(...bridgeMeshes);
  }
  const lines = yield* drawnLines(features.rails, ctx, decks);
  const out: RailMeshes = {
    catenary: [],
    rail: mesh3(),
    sleepers: sleeperRibbons(),
    spans: { top: mesh3(), stone: mesh3() },
    tracks: [],
  };
  const rails = yield* buildRails(
    lines,
    ctx,
    { all: decks, open: openDecks(features.bridges, ctx) },
    out
  );
  // the rails first (a test reads them as the group's first child when no
  // bridge is drawn), then the ballast under them
  if (rails.length > 0) {
    group.add(...rails);
  }
  const ballast = yield* ballastSteps(
    features.ballast,
    ctx,
    decks,
    buriedTest(lines),
    ballastBeds(lines)
  );
  if (ballast) {
    group.add(ballast);
  }
  const spanTop = yield* meshSteps(out.spans.top, COLORS.deckRail, {
    cast: true,
    material: deckMaterial("rail", COLORS.deckRail),
  });
  const spanStone = yield* meshSteps(out.spans.stone, COLORS.deckStone, {
    cast: true,
    material: stoneMaterial(COLORS.deckStone),
  });
  yield;
  const platforms = buildPlatforms(
    features.platforms,
    ctx,
    new TrackIndex(out.tracks)
  );
  yield;
  const catenary = catenaryParts(mesh3());
  addCatenary(catenary, out.catenary, ctx);
  const masts = yield* meshSteps(catenary.steel, COLORS.mast, {
    cast: true,
    roughness: 0.7,
  });
  if (masts) {
    masts.name = "rail-catenary-masts";
  }
  for (const m of [
    spanTop,
    spanStone,
    platforms,
    masts,
    catenaryWires(catenary),
  ]) {
    if (m) {
      group.add(m);
    }
  }
  return group;
}
