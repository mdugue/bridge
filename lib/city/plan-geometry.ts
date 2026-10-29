/**
 * A landscape plan as a design (ADR 0054): its surfaces, trees, planned
 * buildings and ground as one set of triangles in the design reader's
 * frame (x east, y up, z south, metres), a group per class
 * (plan-classes.ts). The readers (dxf.ts, shapefile.ts, gpkg.ts,
 * landxml.ts) hand over features in the plan's own coordinates; this is
 * where they become something the city can stand.
 *
 * - An **area** is triangulated with its holes and cut into triangles of
 *   a few metres, so it can lie on the ground: each vertex takes the
 *   plan's own height where the plan has one (a planned level), else the
 *   ground's (`heightAt`, where the plan lies in the site's coordinates),
 *   lifted by its class (a bed above the lawn above the paving).
 * - A **tree** becomes a low-poly trunk and crown at its spot, its crown
 *   and height where the plan says them.
 * - A **building** area with a height becomes a block.
 * - A **mesh** (a TIN, 3D faces) is taken as it is: a planned ground.
 *
 * Coordinates are taken about `origin` in doubles before they become
 * float32: a plan in the Land's coordinates keeps its millimetres. No DOM.
 */

import earcut from "earcut";
import { PLAN_LOOKS, type PlanClass, type PlanLook } from "./plan-classes";

/** A point of the plan: x east, y north, z up where it has one. */
export type PlanPoint = readonly [number, number, number?];

export type PlanFeature =
  | {
      kind: "area";
      cls: PlanClass | null;
      /** the outer ring first, its holes after */
      rings: readonly (readonly PlanPoint[])[];
      /** a building's height (m), where the plan says it */
      height?: number | null;
    }
  | {
      kind: "tree";
      at: PlanPoint;
      /** crown diameter and height (m), where the plan says them */
      crown?: number | null;
      height?: number | null;
    }
  | {
      kind: "mesh";
      cls: PlanClass | null;
      /** triangles, three points each */
      triangles: readonly (readonly [PlanPoint, PlanPoint, PlanPoint])[];
    };

/** The triangles of one class, about the origin. */
export interface PlanGroup {
  cls: PlanLook;
  /** x, y, z per vertex, three vertices a triangle (unindexed) */
  positions: Float32Array;
}

export interface PlanMesh {
  groups: PlanGroup[];
  /** the plan's origin in its own coordinates (x east, y north) */
  origin: [number, number];
  /** how many vertices took the ground's height, and how many found none */
  draped: number;
  undraped: number;
}

/** A tree's crown and height where the plan gives none (m). */
export const TREE_CROWN_M = 6;
export const TREE_HEIGHT_M = 10;
/** The longest edge a draped area keeps (m) — and how many triangles the
 *  plan's areas may become in all, its edges lengthened to stay within. */
const DRAPE_EDGE_M = 4;
const DRAPE_TRIANGLES = 150_000;
/** Heights a plan's own z can take to be read as NHN (m). */
const NHN_MIN = -10;
const NHN_MAX = 3000;

type Height = (x: number, y: number) => number | null;

/** A ring's signed area (anticlockwise positive). */
function ringArea(ring: readonly PlanPoint[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

/** A ring without its closing point (repeated first) and without
 *  duplicate neighbours. */
function openRing(ring: readonly PlanPoint[]): PlanPoint[] {
  const out: PlanPoint[] = [];
  for (const p of ring) {
    const last = out.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) {
      out.push(p);
    }
  }
  const first = out[0];
  const last = out.at(-1);
  if (out.length > 1 && first[0] === last?.[0] && first[1] === last[1]) {
    out.pop();
  }
  return out;
}

/** A plan point's own height, where it is one (a planned NHN level). */
function ownHeight(p: PlanPoint): number | null {
  const z = p[2];
  return z !== undefined && z !== 0 && z >= NHN_MIN && z <= NHN_MAX ? z : null;
}

/** Whether (x, y) lies inside a ring (even-odd). */
function inside(ring: readonly PlanPoint[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Rings in any order and turn as areas with their holes: a ring inside an
 * outer ring is its hole, a ring inside a hole an island of its own (the
 * nesting a hatch's paths, a shapefile's parts or a multipolygon say).
 */
export function nestRings(
  rings: readonly (readonly PlanPoint[])[]
): PlanPoint[][][] {
  const sorted = rings
    .map(openRing)
    .filter((r) => r.length >= 3)
    .map((ring) => ({ ring, size: Math.abs(ringArea(ring)) }))
    .sort((a, b) => b.size - a.size);
  const placed: { ring: PlanPoint[]; outer: boolean; area: PlanPoint[][] }[] =
    [];
  const areas: PlanPoint[][][] = [];
  for (const { ring } of sorted) {
    const [x, y] = ring[0];
    // the smallest ring placed so far that holds this one
    let container: (typeof placed)[number] | null = null;
    for (let i = placed.length - 1; i >= 0; i--) {
      if (inside(placed[i].ring, x, y)) {
        container = placed[i];
        break;
      }
    }
    if (container?.outer) {
      container.area.push(ring);
      placed.push({ ring, outer: false, area: container.area });
    } else {
      const area = [ring];
      areas.push(area);
      placed.push({ ring, outer: true, area });
    }
  }
  return areas;
}

type Tri = [PlanPoint, PlanPoint, PlanPoint];

/** The point between two (its height too, where both have one). */
function middle(a: PlanPoint, b: PlanPoint): PlanPoint {
  const za = ownHeight(a);
  const zb = ownHeight(b);
  return [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    za !== null && zb !== null ? (za + zb) / 2 : undefined,
  ];
}

const len2 = (a: PlanPoint, b: PlanPoint) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Cuts a triangle until no edge is longer than `edge` (m), each time on
 *  its longest edge. */
function cut(tri: Tri, edge: number, out: Tri[]): void {
  const stack: Tri[] = [tri];
  const max = edge * edge;
  while (stack.length > 0) {
    const [a, b, c] = stack.pop() as Tri;
    const ab = len2(a, b);
    const bc = len2(b, c);
    const ca = len2(c, a);
    const longest = Math.max(ab, bc, ca);
    if (longest <= max) {
      out.push([a, b, c]);
    } else if (longest === ab) {
      const m = middle(a, b);
      stack.push([a, m, c], [m, b, c]);
    } else if (longest === bc) {
      const m = middle(b, c);
      stack.push([a, b, m], [a, m, c]);
    } else {
      const m = middle(c, a);
      stack.push([a, b, m], [m, b, c]);
    }
  }
}

/** An area's triangles (anticlockwise seen from above), holes cut out. */
function triangulate(rings: readonly (readonly PlanPoint[])[]): Tri[] {
  const opened = rings.map(openRing).filter((r) => r.length >= 3);
  if (opened.length === 0) {
    return [];
  }
  const all = opened.flat();
  // earcut takes the rings flat, the holes by where they start; relative
  // to the first point, so a plan in the Land's coordinates stays exact
  const [x0, y0] = all[0];
  const flat = all.flatMap((p) => [p[0] - x0, p[1] - y0]);
  const holes: number[] = [];
  let start = 0;
  for (const ring of opened.slice(0, -1)) {
    start += ring.length;
    holes.push(start);
  }
  const index = earcut(flat, holes, 2);
  const out: Tri[] = [];
  for (let i = 0; i < index.length; i += 3) {
    out.push(
      anticlockwise([all[index[i]], all[index[i + 1]], all[index[i + 2]]])
    );
  }
  return out;
}

/** Collects one class's vertices as the design frame wants them. */
class GroupWriter {
  readonly values: number[] = [];
  constructor(private readonly origin: [number, number]) {}
  /** a plan point at height `y` (m) */
  vertex(p: PlanPoint, y: number): void {
    this.values.push(p[0] - this.origin[0], y, -(p[1] - this.origin[1]));
  }
  /** a triangle anticlockwise from above (in plan): its front face up —
   *  plan (x, y) to (x, −z) keeps the turn as seen from +y */
  triangle(a: PlanPoint, b: PlanPoint, c: PlanPoint, y: readonly number[]) {
    this.vertex(a, y[0]);
    this.vertex(b, y[1]);
    this.vertex(c, y[2]);
  }
}

/** A low-poly tree: an eight-sided trunk to half its height, a crown of
 *  three rings — narrow, widest, narrow — closed at both ends. */
function writeTree(
  w: GroupWriter,
  trunk: GroupWriter,
  at: PlanPoint,
  ground: number,
  crown: number,
  height: number
): void {
  const sides = 8;
  const ring = (r: number, y: number) =>
    Array.from({ length: sides }, (_, i) => {
      const t = (i / sides) * Math.PI * 2;
      return {
        p: [at[0] + r * Math.cos(t), at[1] + r * Math.sin(t)] as PlanPoint,
        y,
      };
    });
  /** the band between two rings, facing out */
  const band = (
    out: GroupWriter,
    low: ReturnType<typeof ring>,
    high: ReturnType<typeof ring>
  ) => {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      out.triangle(low[i].p, low[j].p, high[j].p, [
        low[i].y,
        low[j].y,
        high[j].y,
      ]);
      out.triangle(low[i].p, high[j].p, high[i].p, [
        low[i].y,
        high[j].y,
        high[i].y,
      ]);
    }
  };
  band(trunk, ring(0.18, ground - 0.2), ring(0.12, ground + height * 0.5));
  const r = crown / 2;
  const rings = [
    ring(r * 0.55, ground + height * 0.38),
    ring(r, ground + height * 0.62),
    ring(r * 0.7, ground + height * 0.86),
  ];
  band(w, rings[0], rings[1]);
  band(w, rings[1], rings[2]);
  const top: PlanPoint = [at[0], at[1]];
  const bottom: PlanPoint = [at[0], at[1]];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const [hi, hj] = [rings[2][i], rings[2][j]];
    w.triangle(hi.p, hj.p, top, [hi.y, hj.y, ground + height]);
    const [li, lj] = [rings[0][i], rings[0][j]];
    w.triangle(lj.p, li.p, bottom, [lj.y, li.y, ground + height * 0.33]);
  }
}

/** A planned building: its outline raised `height` m from its lowest
 *  ground, walls and a flat roof. */
function writeBuilding(
  w: GroupWriter,
  rings: readonly (readonly PlanPoint[])[],
  ground: number,
  height: number
): void {
  const top = ground + height;
  for (const [a, b, c] of triangulate(rings)) {
    w.triangle(a, b, c, [top, top, top]);
  }
  for (const [k, raw] of rings.entries()) {
    const ring = openRing(raw);
    // walls face out: the outer ring anticlockwise, holes clockwise — then
    // the outside lies right of each edge, and (a, b, b′) faces it
    const anticlockwise = ringArea(ring) >= 0;
    const r = anticlockwise === (k === 0) ? ring : [...ring].reverse();
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      w.vertex(a, ground);
      w.vertex(b, ground);
      w.vertex(b, top);
      w.vertex(a, ground);
      w.vertex(b, top);
      w.vertex(a, top);
    }
  }
}

/** Turns a plan triangle anticlockwise (seen from above). */
function anticlockwise(tri: readonly [PlanPoint, PlanPoint, PlanPoint]): Tri {
  const cross =
    (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) -
    (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
  return cross >= 0 ? [tri[0], tri[1], tri[2]] : [tri[0], tri[2], tri[1]];
}

type Area = Extract<PlanFeature, { kind: "area" }>;

/** An area's outer ring's size (m²). */
const areaSize = (f: Area) => Math.abs(ringArea(openRing(f.rings[0] ?? [])));

/** The edge the areas are cut to: a few metres, longer for a large plan. */
function drapeEdge(areas: readonly Area[]): number {
  let total = 0;
  for (const f of areas) {
    total += areaSize(f);
  }
  return Math.max(DRAPE_EDGE_M, Math.sqrt(total / (0.45 * DRAPE_TRIANGLES)));
}

/** The ground under the plan: its heights where known, counted. */
class PlanGround {
  draped = 0;
  undraped = 0;
  private lowest = Number.POSITIVE_INFINITY;
  constructor(private readonly heightAt: Height) {}
  /** the ground at a point, or null */
  at(p: PlanPoint): number | null {
    const h = this.heightAt(p[0], p[1]);
    if (h === null) {
      this.undraped++;
    } else {
      this.draped++;
      this.lowest = Math.min(this.lowest, h);
    }
    return h;
  }
  /** where the ground was not to be had: the lowest that was, else 0 */
  get fallback(): number {
    return Number.isFinite(this.lowest) ? this.lowest : 0;
  }
}

/** How far an area drawn into another lies above it (m). */
const NEST_LIFT_M = 0.1;

/** How many of the larger areas (`outers` before `k`, largest first)
 *  hold area `k`: a square in a lawn lies above it, a bed in the square
 *  above both, whatever their classes. */
function nestingDepth(outers: readonly PlanPoint[][], k: number): number {
  const ring = outers[k];
  if (ring.length === 0) {
    return 0;
  }
  // a point well inside: the middle of its first triangle's edge pair
  const [x, y] = ring[0];
  const [x1, y1] = ring[Math.floor(ring.length / 2)];
  const px = x + (x1 - x) * 0.01;
  const py = y + (y1 - y) * 0.01;
  let depth = 0;
  for (let i = 0; i < k; i++) {
    if (inside(outers[i], px, py)) {
      depth++;
    }
  }
  return depth;
}

/** The areas, cut and laid on the ground: largest first, what is drawn
 *  into them a little above them. */
function writeAreas(
  areas: readonly Area[],
  ground: PlanGround,
  writer: (cls: PlanLook) => GroupWriter
): void {
  const edge = drapeEdge(areas);
  const laid: { w: GroupWriter; tri: Tri; y: number[]; lift: number }[] = [];
  const sorted = [...areas].sort((a, b) => areaSize(b) - areaSize(a));
  const outers = sorted.map((f) => openRing(f.rings[0] ?? []));
  sorted.forEach((f, rank) => {
    const cls = f.cls ?? "other";
    const lift =
      PLAN_LOOKS[cls].lift + nestingDepth(outers, rank) * NEST_LIFT_M;
    const cuts: Tri[] = [];
    for (const tri of triangulate(f.rings)) {
      cut(tri, edge, cuts);
    }
    for (const tri of cuts) {
      const y = tri.map((p) => ownHeight(p) ?? ground.at(p) ?? Number.NaN);
      laid.push({ w: writer(cls), tri, y, lift });
    }
  });
  // (the fallback is known only once every vertex has asked)
  const fallback = ground.fallback;
  for (const { w, tri, y, lift } of laid) {
    w.triangle(
      tri[0],
      tri[1],
      tri[2],
      y.map((h) => (Number.isNaN(h) ? fallback : h) + lift)
    );
  }
}

/**
 * The plan's features as triangles about `origin`, a group per class.
 * `heightAt` is the ground's height at a plan point (null: unknown, or
 * the plan is not in the site's coordinates).
 */
export function planMesh(
  features: readonly PlanFeature[],
  origin: [number, number],
  heightAt: Height
): PlanMesh {
  const writers = new Map<PlanLook, GroupWriter>();
  const writer = (cls: PlanLook) => {
    let w = writers.get(cls);
    if (!w) {
      w = new GroupWriter(origin);
      writers.set(cls, w);
    }
    return w;
  };
  const ground = new PlanGround(heightAt);
  const isBlock = (f: Area) => f.cls === "building" && Boolean(f.height);
  const areas = features.filter((f): f is Area => f.kind === "area");
  writeAreas(
    areas.filter((f) => !isBlock(f)),
    ground,
    writer
  );
  const groundOr = (p: PlanPoint) =>
    ownHeight(p) ?? ground.at(p) ?? ground.fallback;
  for (const f of areas.filter(isBlock)) {
    const low = Math.min(...openRing(f.rings[0] ?? []).map(groundOr));
    writeBuilding(writer("building"), f.rings, low, f.height ?? 0);
  }
  for (const f of features) {
    if (f.kind === "tree") {
      writeTree(
        writer("tree"),
        writer("trunk"),
        f.at,
        groundOr(f.at),
        f.crown && f.crown > 0 ? f.crown : TREE_CROWN_M,
        f.height && f.height > 0 ? f.height : TREE_HEIGHT_M
      );
    } else if (f.kind === "mesh") {
      const w = writer(f.cls ?? "terrain");
      for (const raw of f.triangles) {
        const t = anticlockwise(raw);
        w.triangle(
          t[0],
          t[1],
          t[2],
          t.map((p) => p[2] ?? groundOr(p))
        );
      }
    }
  }
  const groups: PlanGroup[] = [];
  for (const [cls, w] of writers) {
    if (w.values.length > 0) {
      groups.push({ cls, positions: new Float32Array(w.values) });
    }
  }
  return {
    groups,
    origin,
    draped: ground.draped,
    undraped: ground.undraped,
  };
}
