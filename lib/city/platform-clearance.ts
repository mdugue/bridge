/**
 * A station platform keeps clear of the tracks beside it. Its edge stands
 * where a train's side passes, so no platform reaches nearer a track's
 * centre than the edge distance: 1.65 m on a main line, an S-Bahn and a
 * U-Bahn (EBO §13, DB Ril 813: the edge of a 0.55–0.96 m platform 1.65 m
 * from the track's centre), 1.35 m beside a tram (half the widest German
 * tram, 2.65 m, and a step's gap). OSM maps the platforms and the
 * Basis-DLM the tracks, a metre apart in places: at Dresden Hbf the edge
 * of an island platform stood 0.6 m from a track's centre, and the slab
 * covered the rails. The build step (scripts/prepare-data.ts) cuts every
 * platform outline back to that distance from every drawn track
 * (scripts/line-levels.ts `siteTrackAxes`), so the layer stands it beside
 * the track, never over it. DOM-free, THREE-free.
 */

import { difference, type Polygon as ClipPolygon } from "polygon-clipping";
import type { MultiPolygonGeometry, PolygonGeometry } from "./features";
import type { Point2 } from "./polyline";

/** A platform's edge from a track's centre (m), by the line. */
export const PLATFORM_EDGE_M = { rail: 1.65, tram: 1.35 } as const;

/** One drawn track's axis and how near a platform may come to it (m;
 *  a line of several tracks: its outer track's edge distance from the
 *  axis), with its profile (m) where it has one. */
export interface TrackAxis {
  clear: number;
  coords: Point2[];
  z?: number[];
}

/** A track this far (m) over the lowest track beside it passes over the
 *  platform there, on a bridge, and leaves it whole: a storey, as a
 *  crossing's span (lib/city/line-levels.ts `CROSS_CLEAR_M`). */
const OVER_M = 3;
/** …beside it: within this (m). */
const BESIDE_M = 15;

/** A part the cut leaves smaller than this is dropped (m²)… */
const MIN_PART_M2 = 2;
/** …or narrower than this on average (m; twice its area over its
 *  perimeter): the strip left beyond a track that ran through it. */
const MIN_WIDTH_M = 0.8;
/** Segments per half circle of a segment's end caps. */
const CAP_STEPS = 8;
/** The index's cell (m). */
const CELL_M = 16;

interface Segment {
  a: Point2;
  b: Point2;
  clear: number;
  /** the lower end's profile (m), NaN where the line has none */
  z: number;
}

/** The axes' segments by grid cell, for the platforms near them. */
export class AxisIndex {
  private readonly cells = new Map<string, Segment[]>();
  private reach = 0;

  constructor(axes: Iterable<TrackAxis>) {
    for (const axis of axes) {
      this.reach = Math.max(this.reach, axis.clear);
      for (let i = 1; i < axis.coords.length; i++) {
        this.add({
          a: axis.coords[i - 1],
          b: axis.coords[i],
          clear: axis.clear,
          z: axis.z ? Math.min(axis.z[i - 1], axis.z[i]) : Number.NaN,
        });
      }
    }
  }

  private add(s: Segment): void {
    const [x0, x1] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
    const [y0, y1] = [Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])];
    for (
      let cx = Math.floor(x0 / CELL_M);
      cx <= Math.floor(x1 / CELL_M);
      cx++
    ) {
      for (
        let cy = Math.floor(y0 / CELL_M);
        cy <= Math.floor(y1 / CELL_M);
        cy++
      ) {
        const key = `${cx}:${cy}`;
        const cell = this.cells.get(key);
        if (cell) {
          cell.push(s);
        } else {
          this.cells.set(key, [s]);
        }
      }
    }
  }

  /** Every segment whose clearance may reach into the box, and those
   *  `margin` (m) further. */
  near(x0: number, y0: number, x1: number, y1: number, margin = 0): Segment[] {
    const r = this.reach + margin;
    const found = new Set<Segment>();
    for (
      let cx = Math.floor((x0 - r) / CELL_M);
      cx <= Math.floor((x1 + r) / CELL_M);
      cx++
    ) {
      for (
        let cy = Math.floor((y0 - r) / CELL_M);
        cy <= Math.floor((y1 + r) / CELL_M);
        cy++
      ) {
        for (const s of this.cells.get(`${cx}:${cy}`) ?? []) {
          found.add(s);
        }
      }
    }
    return [...found];
  }
}

/** The capsule's radius over the clearance: its polygon's edges, not
 *  only its corners, at the clearance. */
const CIRCUMSCRIBE = 1 / Math.cos(Math.PI / (2 * CAP_STEPS));

/** The points within `s.clear` of a segment, as one polygon (a capsule,
 *  circumscribed). */
function capsule(s: Segment): ClipPolygon {
  const r = s.clear * CIRCUMSCRIBE;
  const [ax, ay] = s.a;
  const [bx, by] = s.b;
  const len = Math.hypot(bx - ax, by - ay);
  const ux = len > 0 ? (bx - ax) / len : 1;
  const uy = len > 0 ? (by - ay) / len : 0;
  const base = Math.atan2(uy, ux);
  const ring: [number, number][] = [];
  // around b from its left (+normal) through ahead to its right, then
  // around a from its right through behind back to its left: counter-
  // clockwise
  for (let k = 0; k <= CAP_STEPS; k++) {
    const t = base - Math.PI / 2 + (Math.PI * k) / CAP_STEPS;
    ring.push([bx + r * Math.cos(t), by + r * Math.sin(t)]);
  }
  for (let k = 0; k <= CAP_STEPS; k++) {
    const t = base + Math.PI / 2 + (Math.PI * k) / CAP_STEPS;
    ring.push([ax + r * Math.cos(t), ay + r * Math.sin(t)]);
  }
  ring.push(ring[0]);
  return [ring];
}

/** A ring's area (m², unsigned). */
function ringArea(ring: readonly Point2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a) / 2;
}

/** A polygon's area (m²): its outer ring less its holes. */
function polygonArea(rings: readonly (readonly Point2[])[]): number {
  return rings.reduce(
    (sum, ring, i) => sum + (i === 0 ? ringArea(ring) : -ringArea(ring)),
    0
  );
}

/** A ring's perimeter, or a polyline's length (m). */
export function ringLength(ring: readonly Point2[]): number {
  let l = 0;
  for (let i = 1; i < ring.length; i++) {
    l += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  }
  return l;
}

/** Whether a part the cut leaves is a platform, not a sliver. */
function keeps(rings: readonly (readonly Point2[])[]): boolean {
  const area = polygonArea(rings);
  return (
    area >= MIN_PART_M2 && (2 * area) / ringLength(rings[0]) >= MIN_WIDTH_M
  );
}

/** A polygon geometry as a list of polygons. */
function polygonsOf(g: MultiPolygonGeometry | PolygonGeometry): Point2[][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/** Whether a segment's clearance touches the box. */
function reaches(
  s: Segment,
  [x0, y0, x1, y1]: readonly [number, number, number, number]
): boolean {
  return (
    Math.max(s.a[0], s.b[0]) + s.clear > x0 &&
    Math.min(s.a[0], s.b[0]) - s.clear < x1 &&
    Math.max(s.a[1], s.b[1]) + s.clear > y0 &&
    Math.min(s.a[1], s.b[1]) - s.clear < y1
  );
}

/** The distance (m) from a point to a segment. */
function toSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t =
    l2 > 0
      ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
      : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** The distance (m) between two segments (0 where they cross). */
function apart(s: Segment, t: Segment): number {
  if (crossing(s.a, s.b, t.a, t.b) !== null) {
    return 0;
  }
  return Math.min(
    toSegment(s.a, t.a, t.b),
    toSegment(s.b, t.a, t.b),
    toSegment(t.a, s.a, s.b),
    toSegment(t.b, s.a, s.b)
  );
}

/** The segments that run beside the platform, not over it: a segment a
 *  storey over the lowest one beside it crosses on a bridge. */
function besides(segments: readonly Segment[]): Segment[] {
  return segments.filter(
    (s) =>
      Number.isNaN(s.z) ||
      !segments.some(
        (t) => t.z < s.z - OVER_M && apart(s, t) <= BESIDE_M + s.clear
      )
  );
}

/** One polygon less the capsules, slivers dropped; the polygon itself
 *  where the capsules leave it whole (or the clipper fails on it). */
function cut(polygon: Point2[][], capsules: ClipPolygon[]): Point2[][][] {
  let parts: Point2[][][];
  try {
    parts = difference(polygon, ...capsules).map((p) =>
      p.map((ring) => ring.map(([x, y]): Point2 => [cm(x), cm(y)]))
    );
  } catch {
    return [polygon]; // a degenerate outline: kept as OSM maps it
  }
  const before = polygonArea(polygon);
  const after = parts.reduce((sum, p) => sum + polygonArea(p), 0);
  return Math.abs(after - before) < 0.01 ? [polygon] : parts.filter(keeps);
}

/** A coordinate rounded to the centimetre, as the bakes write them. */
const cm = (v: number) => Math.round(v * 100) / 100;

/**
 * A platform outline cut back to its edge distance from every track
 * beside it (`index`; a track a storey over the lowest beside it crosses
 * on a bridge): the same geometry where no track comes that near,
 * otherwise what is left of it, the slivers a cut leaves dropped
 * (`keeps`) — null when nothing is.
 */
export function clearOfTracks(
  g: MultiPolygonGeometry | PolygonGeometry,
  index: AxisIndex
): MultiPolygonGeometry | PolygonGeometry | null {
  const polygons = polygonsOf(g);
  const xs = polygons.flatMap((p) => p[0].map((c) => c[0]));
  const ys = polygons.flatMap((p) => p[0].map((c) => c[1]));
  const box = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ] as const;
  const segments = besides(index.near(...box, BESIDE_M)).filter((s) =>
    reaches(s, box)
  );
  if (segments.length === 0) {
    return g;
  }
  const capsules = segments.map(capsule);
  let changed = false;
  const left = polygons.flatMap((polygon) => {
    const parts = cut(polygon, capsules);
    changed ||= parts.length !== 1 || parts[0] !== polygon;
    return parts;
  });
  if (!changed) {
    return g; // no track came that near: the outline as it was
  }
  if (left.length === 0) {
    return null;
  }
  return left.length === 1
    ? { type: "Polygon", coordinates: left[0] }
    : { type: "MultiPolygon", coordinates: left };
}

/** A Basis-DLM line's rest shorter than this is dropped (m): the bake's
 *  own floor (pipeline/bake/rail.py `DLM_REST_M`). */
export const DLM_REST_M = 20;

/** Whether a point lies inside a polygon (outer ring less its holes). */
function insidePolygon(
  x: number,
  y: number,
  rings: readonly Point2[][]
): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Where along a→b (0…1) it crosses the edge c→d, or null. */
function crossing(a: Point2, b: Point2, c: Point2, d: Point2): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) {
    return null;
  }
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

/** One segment cut at every area edge it crosses, each piece with whether
 *  it lies inside an area. */
function segmentPieces(
  a: Point2,
  b: Point2,
  areas: readonly Point2[][][]
): { from: Point2; inside: boolean; to: Point2 }[] {
  const ts = [0, 1];
  for (const rings of areas) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const t = crossing(a, b, ring[i - 1], ring[i]);
        if (t !== null) {
          ts.push(t);
        }
      }
    }
  }
  ts.sort((p, q) => p - q);
  const at = (t: number): Point2 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const out: { from: Point2; inside: boolean; to: Point2 }[] = [];
  for (let k = 1; k < ts.length; k++) {
    if (ts[k] - ts[k - 1] < 1e-9) {
      continue;
    }
    const [mx, my] = at((ts[k] + ts[k - 1]) / 2);
    out.push({
      from: at(ts[k - 1]),
      to: at(ts[k]),
      inside: areas.some((rings) => insidePolygon(mx, my, rings)),
    });
  }
  return out;
}

/** A list of points' box: x0, y0, x1, y1. */
function boxOf(pts: readonly Point2[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/**
 * The parts of a line outside every area (polygons, holes kept), each at
 * least `minLength` long — null when no part of it lies inside one. A
 * Basis-DLM line kept where OSM maps no track
 * near (pipeline/bake/rail.py `rails`) is a line's centreline: through a
 * station it runs between its tracks, over the island platform, where no
 * track runs (OSM's tracks never do, the DLM's rests did for a fifth of
 * their length at Dresden and Leipzig) — the build drops it there.
 */
export function outsideAreas(
  coords: readonly Point2[],
  areas: readonly Point2[][][],
  minLength: number
): Point2[][] | null {
  const [x0, y0, x1, y1] = boxOf(coords);
  const near = areas.filter((rings) => {
    const [ax0, ay0, ax1, ay1] = boxOf(rings[0]);
    return ax0 <= x1 && ax1 >= x0 && ay0 <= y1 && ay1 >= y0;
  });
  if (near.length === 0) {
    return null;
  }
  const parts: Point2[][] = [];
  let crossed = false;
  let run: Point2[] = [];
  const flush = () => {
    if (run.length >= 2 && ringLength(run) >= minLength) {
      parts.push(run.map(([x, y]): Point2 => [cm(x), cm(y)]));
    }
    run = [];
  };
  for (let i = 1; i < coords.length; i++) {
    for (const piece of segmentPieces(coords[i - 1], coords[i], near)) {
      if (piece.inside) {
        crossed = true;
        flush();
        continue;
      }
      if (run.length === 0) {
        run.push(piece.from);
      }
      run.push(piece.to);
    }
  }
  flush();
  return crossed ? parts : null;
}
