/**
 * The railway's geometry (pipeline/bake/rail.py, OSM platforms): the
 * ballast yards, the steel rails on the level their whole line runs on, the
 * station platforms and the decks under a span — as triangle soups
 * (lib/city/mesh3.ts) in the Y-up scene frame. The build bakes them into
 * the fine terrain glTF (scripts/bake-lines.ts, ADR 0029); the viewer only
 * gives them their materials (app/_components/rail-layer.ts, which still
 * draws the bridges at runtime: the inquiry asks a bridge by its meshes).
 * Also the decks' lift table with their approach ramps, which the tram, the
 * traffic and the bridges share. No THREE, no DOM.
 *
 *  - Ballast yards: ONE merged surface from the DISSOLVED Basis-DLM ver03_f
 *    area polygons (no per-line overlap → no z-fight), draped on the ground.
 *  - Rails: Basis-DLM ver03_l centrelines (heavy rail), split at NoData gaps.
 *  - Platforms: OSM railway=platform polygons (ODbL).
 */
import {
  APPROACH_GRADE,
  approachLanding,
  axisFrame,
  PIER_SPACING,
} from "./bridge";
import {
  type DeckPoly,
  decksAt,
  deckPoly,
  deckRing,
  longAxis,
  pointInRing,
  type Ring2,
  ringToWorld,
} from "./decks";
import type { AreaFeature, BridgeFeature, RailFeature } from "./features";
import { epsgToWorld, type GroundContext, worldToEpsg } from "./ground-clamp";
import { type JoinPoint, joinsAlong, SINK } from "./ground-join";
import {
  type Level,
  LEVEL_GRADE,
  LEVEL_STEP,
  type LevelLine,
  type LevelRun,
  lineLevels,
  modeRuns,
  runLevelAt,
} from "./levels";
import { DECK_REACH_M, RIDES } from "./line-levels";
import {
  addColumn,
  addFootprint,
  addRibbon,
  type Mesh3,
  mesh3,
  outward,
  type P3,
  type Pt,
  pushTri,
  quad,
  ringWinding,
  surfaceNormal,
  tangentsXZ,
  type Triangulate,
} from "./mesh3";
import { type Point2, subdividePolyline } from "./polyline";

/** The ground, and what a part needs to triangulate a polygon. */
export interface MeshContext extends GroundContext {
  triangulate: Triangulate;
}

export interface RailContext extends MeshContext {
  /**
   * Whether this tile draws a bridge whose deck centre is at (x, y) (EPSG).
   * A deck across a seam is in both tiles' files — the same, from the
   * bake's mosaic — and every copy lifts the tile's own rails, but only its
   * owner draws it. Absent: every bridge is drawn.
   */
  owns?: (x: number, y: number) => boolean;
}

/** A tile's baked railway features. */
export interface RailFeatures {
  /** dissolved ballast areas (Basis-DLM ver03_f) */
  ballast: AreaFeature[];
  /** bridge decks (Basis-DLM ver06_f): the rails ride them */
  bridges: BridgeFeature[];
  /** OSM platforms (ODbL) */
  platforms: AreaFeature[];
  /** railway-track centrelines (Basis-DLM ver03_l) */
  rails: RailFeature[];
}

const SAMPLE_M = LEVEL_STEP.rail; // densify polylines to this spacing (m)
const BALLAST_RAISE = 0.18; // ballast crown above ground (m)
const BALLAST_DROP = 0.45; // ballast shoulder depth at the edge (m)
export const RAIL_RAISE = BALLAST_RAISE + 0.16; // rail head above ground on terrain (m)
const RAIL_DECK_RAISE = 0.08; // rail head above a bridge deck (no ballast) (m)
const RAIL_WEB = 0.11; // rail vertical web depth so it reads obliquely (m)
const GAUGE = 1.435; // standard-gauge rail spacing (m)
const TRACK_PITCH = 4.0; // spacing between parallel track centres (m)
const RAIL_HALF = 0.075; // half-width of a drawn rail (m)
export const DECK_DEPTH = 1.1; // bridge-deck slab thickness (m)
export const PIER_MIN_GAP = 2.5; // only pier where the deck clears the ground by this (m)
export const PIER_HALF = 0.65; // pier column half-width (m)
const PLATFORM_H = 0.55; // station platform height above ground (m)
const END_EDGE_COS = 0.5; // a ring edge this far off the axis is an abutment end

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

type BridgeProps = NonNullable<BridgeFeature["properties"]>;

/** A bridge feature's properties with defaults (`properties` may be null). */
export function bridgeProps(f: BridgeFeature): {
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

/**
 * Which ring edges (edge i runs from vertex i to i + 1) cross the axis
 * rather than run along it: the abutment ends. With the vertices' stations
 * an edge that advances along the axis by less than END_EDGE_COS of its
 * length is an end (this holds on a curved deck); without them, the edge's
 * direction against the ring's long axis decides.
 */
export function endEdges(ring: Ring2, ringS?: number[]): boolean[] {
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
 * same baked features the decks are built from. Shared by the rails, the
 * trams, the traffic and the bridges.
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
    const e = worldToEpsg(x, z, ctx.offset);
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
export function addApproach(
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
  ctx: GroundContext
): number[] | null {
  const ys: (number | null)[] = ring.pts.map((p) => {
    const e = worldToEpsg(p.x, p.z, ctx.offset);
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

/** A single rail: a thin top ribbon + two vertical webs along a run of points. */
export function addRail(acc: Mesh3, pts: Pt[], lateral: number): void {
  addRibbon(acc, pts, lateral, RAIL_HALF, RAIL_WEB);
}

/** A point of a part (world x, y, z) as a join's end (EPSG x, y, z). */
function joinEnd(
  p: { x: number; y: number; z: number },
  offset: { cx: number; cy: number }
): { x: number; y: number; z: number } {
  const e = worldToEpsg(p.x, p.z, offset);
  return { x: e.x, y: e.y, z: p.y };
}

/** The feet of a box column `half` wide whose foot is at `y0`: its four
 *  bottom edges, every metre (the ground under its corners is where it
 *  opens a gap on a slope). */
export function columnFeet(
  x: number,
  z: number,
  y0: number,
  half: number,
  offset: { cx: number; cy: number }
): JoinPoint[] {
  const c = [
    { x: x - half, y: y0, z: z - half },
    { x: x + half, y: y0, z: z - half },
    { x: x + half, y: y0, z: z + half },
    { x: x - half, y: y0, z: z + half },
  ];
  return c.flatMap((p, i) =>
    joinsAlong("foot", joinEnd(p, offset), joinEnd(c[(i + 1) % 4], offset))
  );
}

/** A triangle whose longest side exceeds this (m) is split into four, and
 *  so is one whose corners' plane the ground under it strays from by more
 *  than DRAPE_TOLERANCE_M (m), down to DRAPE_M: the ground under a yard is
 *  not flat between its outline's corners. The tolerance is coarse on
 *  purpose — the class raster paints the yard on the ground under it
 *  anyway — so a tile's yards stay ~5·10⁴ triangles. */
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
 *
 * Where it meets the ground: the fascia's foot, `drop − raise` under the
 * ground at every DRAPE_M sample, straight between them (`joins`). Where
 * the ground beside the yard is higher than its crown the fascia is
 * buried; where it falls away between two samples by more than that, the
 * foot stands over it — what the joins measure.
 */
function addDrapedArea(
  acc: Mesh3,
  rings: Ring2[],
  raise: number,
  drop: number,
  ctx: MeshContext,
  skip: (x: number, z: number) => boolean,
  joins: JoinPoint[]
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
      const e = worldToEpsg(x, z, ctx.offset);
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
  const tris = ctx.triangulate(
    outer.map((p) => ({ x: p.x, y: p.z })),
    holes.map((h) => h.map((p) => ({ x: p.x, y: p.z })))
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
      joins.push(
        ...joinsAlong(
          "foot",
          joinEnd({ x: p.x, y: yp - drop, z: p.z }, ctx.offset),
          joinEnd({ x: q.x, y: yq - drop, z: q.z }, ctx.offset)
        )
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
 * the tracks ride the deck.
 */
export function ballastMesh(
  features: AreaFeature[],
  ctx: MeshContext,
  decks: DeckPoly[] = [],
  joins: JoinPoint[] = []
): Mesh3 {
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
        onDeck,
        joins
      );
    }
  }
  return acc;
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
 *
 * Where it meets the ground: its piers' feet, `SINK.wall` under the
 * ground at the pier's centre (`joins`); on a slope the corners of the
 * downhill side stand higher. The slab's ends meet the line's rims, not
 * the ground.
 */
export function addSpanDeck(
  top: Mesh3,
  stone: Mesh3,
  pts: readonly Pt[],
  half: number,
  ctx: MeshContext,
  joins: JoinPoint[] = []
): void {
  if (pts.length < 2) {
    return;
  }
  const tan = tangentsXZ(pts);
  const side = (sign: number) =>
    pts.map((p, i) => ({
      x: p.x - tan[i].y * half * sign,
      z: p.z + tan[i].x * half * sign,
    }));
  const left = side(1);
  const right = side(-1).reverse();
  const ring = { pts: [...left, ...right] };
  const topY = [...pts.map((p) => p.y), ...[...pts].reverse().map((p) => p.y)];
  // the top in the deck's colour, the rest in stone
  addFootprint(top, ring, topY, 0, ctx.triangulate);
  addFootprint(stone, ring, topY, DECK_DEPTH, ctx.triangulate, true);
  let run = 0;
  let next = PIER_SPACING / 2;
  for (let i = 1; i < pts.length; i++) {
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
      joins.push(...columnFeet(p.x, p.z, g - SINK.wall, PIER_HALF, ctx.offset));
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
 *  (`lineLevelsAt`): the ground, a rail deck, a span (with its deck). On
 *  the ground they ride the ballast yard: no joins of their own. */
function railTracks(
  features: RailFeature[],
  ctx: RailContext,
  decks: DeckPoly[],
  spans: { stone: Mesh3; top: Mesh3 },
  joins: JoinPoint[]
): Mesh3 {
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
      const e = centre ? worldToEpsg(centre.x, centre.z, ctx.offset) : null;
      if (e && (!ctx.owns || ctx.owns(e.x, e.y))) {
        addSpanDeck(
          spans.top,
          spans.stone,
          pts.map((p) => ({ ...p, y: p.y - RAIL_RAISE + BALLAST_RAISE })),
          half,
          ctx,
          joins
        );
      }
    }
  }
  return acc;
}

/**
 * Station platforms: flat slabs raised above ground (polygons + line
 * ribbons).
 *
 * Where a polygon meets the ground: its top PLATFORM_H over the ground at
 * each outline vertex, its fascia down to the ground there, straight
 * between two vertices (`joins`: the fascia's foot) — buried where the
 * ground between them rises, standing over it where it falls. A
 * line-mapped platform is a thin ribbon at platform height along the
 * line, not a body standing on the ground: it reports no joins (it
 * floats by construction — plan 074's findings).
 */
function platformsMesh(
  features: AreaFeature[],
  ctx: MeshContext,
  joins: JoinPoint[]
): Mesh3 {
  const acc = mesh3();
  for (const f of features) {
    const g = f.geometry;
    if (g?.type === "Polygon" || g?.type === "MultiPolygon") {
      for (const outer of outerRings(g)) {
        const ring = ringToWorld(outer, ctx.offset);
        const topY = clampRing(ring, PLATFORM_H, ctx);
        if (topY) {
          addFootprint(acc, ring, topY, PLATFORM_H, ctx.triangulate);
          const { pts } = ring;
          pts.forEach((p, i) => {
            const j = (i + 1) % pts.length;
            joins.push(
              ...joinsAlong(
                "foot",
                joinEnd(
                  { x: p.x, y: topY[i] - PLATFORM_H, z: p.z },
                  ctx.offset
                ),
                joinEnd(
                  { x: pts[j].x, y: topY[j] - PLATFORM_H, z: pts[j].z },
                  ctx.offset
                )
              )
            );
          });
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
  return acc;
}

/** A tile's railway, part by part (each one material at runtime), and
 *  where it meets the ground (`joins`, ADR 0035). */
export interface RailParts {
  ballast: Mesh3;
  joins: JoinPoint[];
  platforms: Mesh3;
  /** the decks under the spans: their top and their stone */
  spanStone: Mesh3;
  spanTop: Mesh3;
  tracks: Mesh3;
}

/**
 * A tile's rails, ballast yards, platforms and span decks, on the ground
 * `ctx` reads (the build: every tile's fine ground) and the decks the
 * tile's bridges and their approaches make. The bridges themselves are
 * the viewer's (app/_components/rail-layer.ts).
 */
export function railParts(features: RailFeatures, ctx: RailContext): RailParts {
  const decks = buildDeckTable(features.bridges, ctx);
  const joins: JoinPoint[] = [];
  const ballast = ballastMesh(features.ballast, ctx, decks, joins);
  const spans = { top: mesh3(), stone: mesh3() };
  const tracks = railTracks(features.rails, ctx, decks, spans, joins);
  const platforms = platformsMesh(features.platforms, ctx, joins);
  return {
    ballast,
    joins,
    platforms,
    spanStone: spans.stone,
    spanTop: spans.top,
    tracks,
  };
}
