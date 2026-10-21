/**
 * Kerb stones along the carriageway's edge (`pipeline/bake/edges.py` →
 * `kerbs_<tile>.geojson`: the smoothed DLM road edge, the road on each
 * line's left) as a low stone band: a face on the road side, a top and a
 * back. DOM-free, THREE-free, pure — the terrain bake
 * (scripts/bake-tiles.ts `kerbMesh`) writes them into the fine terrain glTF,
 * and `kerb-layer.ts` only gives them their material.
 *
 * The DGM1 smooths a 12 cm kerb into the ground, and the terrain grid is
 * 2 m, so the step cannot live in the terrain: the stone stands on it. Its
 * foot follows the ground on either side (read through `heightAt`, the
 * final shaped ground). The face stands the kerb height above the road
 * (or at the pavement, where that is higher); the back meets the pavement
 * where the stone ends, so the top falls off toward it as a bevel. A stone
 * level across stood a second step on the pavement side: the smoothed DGM
 * lies a few centimetres above the road there, not at the kerb's top, and
 * every kerb showed an edge toward the pavement as well as the road.
 *
 * Where the bake lowers it (`KerbLine.low`, pipeline/bake/kerb_drops.py: at
 * a crossing, a lowered or flush kerb node, a driveway) the stone stands
 * its drop's height over the road — 3 cm, or flush — and ramps back to the
 * full height over RAMP_M either side.
 */
import {
  followGround,
  type JoinPoint,
  joinsAlong,
  meetGround,
  SINK,
} from "./ground-join";
import { epsgToWorld, type RecenterOffset } from "./ground-clamp";
import { type Point2, subdividePolyline } from "./polyline";

type HeightAt = (x: number, y: number) => number | null;

export const KERB_HEIGHT = 0.12; // m above the road
export const KERB_WIDTH = 0.24; // m, face to back
/** How far a lowered stretch's ends ramp back to KERB_HEIGHT (m). */
export const RAMP_M = 0.5;

const SAMPLE_M = 2.5; // densify to this spacing (m) so the foot follows the ground
const PROBE_M = 0.4; // read the ground this far out on either side (m)
const SINK_M = SINK.kerb; // the foot reaches this far below the ground
const LIFT_M = 0.01; // the back's top this far above the pavement (m): no z-fight

/** A stretch where the kerb is lowered: from and to (m along its line) and
 *  the stone's height there over the road (m). */
export type KerbDrop = readonly [number, number, number];

/** A kerb line (EPSG, the carriageway on its left) and where it is
 *  lowered. */
export interface KerbLine {
  coords: Point2[];
  low?: readonly KerbDrop[];
}

/** The stone's height over the road `s` metres along its line: its drops'
 *  lowest, ramped over RAMP_M to KERB_HEIGHT outside each. */
export function kerbHeightAt(s: number, low: readonly KerbDrop[]): number {
  let h = KERB_HEIGHT;
  for (const [s0, s1, dh] of low) {
    const out = s < s0 ? s0 - s : s > s1 ? s - s1 : 0;
    if (out < RAMP_M) {
      h = Math.min(h, dh + ((KERB_HEIGHT - dh) * out) / RAMP_M);
    }
  }
  return h;
}

/** A line's points with a vertex added at every drop's and ramp's ends
 *  (so the profile bends there), then densified to SAMPLE_M. */
function profilePoints(line: Point2[], low: readonly KerbDrop[]): Point2[] {
  if (low.length === 0) {
    return subdividePolyline(line, SAMPLE_M);
  }
  const marks = low
    .flatMap(([s0, s1]) => [s0 - RAMP_M, s0, s1, s1 + RAMP_M])
    .toSorted((a, b) => a - b);
  const pts: Point2[] = [line[0]];
  let s = 0;
  let m = 0;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    while (m < marks.length && marks[m] <= s) {
      m++;
    }
    while (m < marks.length && marks[m] < s + len) {
      const t = (marks[m] - s) / len;
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      m++;
    }
    pts.push(line[i]);
    s += len;
  }
  return subdividePolyline(pts, SAMPLE_M);
}

/** Each point's distance along the polyline (m). */
function alongOf(pts: Point2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) {
    out.push(
      out[i - 1] +
        Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    );
  }
  return out;
}

export interface KerbGeometryData {
  /** where the stones meet the ground (ADR 0035): both feet, and the back
   *  edge of the top, which meets the pavement */
  joins: JoinPoint[];
  normals: number[];
  /** world frame (x, elevation, z), recentered */
  positions: number[];
}

interface KerbCol {
  /** the face's and the back's EPSG points */
  at: { back: Point2; face: Point2 };
  back: { x: number; z: number };
  backFoot: number;
  face: { x: number; z: number };
  faceFoot: number;
  /** the top at the back edge: the pavement's level there */
  backTop: number;
  /** world-frame unit normal of the face, toward the road */
  n: { x: number; z: number };
  /** the top at the face */
  top: number;
}

function kerbCol(
  p: Point2,
  toRoad: Point2,
  heightAt: HeightAt,
  offset: RecenterOffset,
  kerbH = KERB_HEIGHT
): KerbCol | null {
  const [x, y] = p;
  const [rx, ry] = toRoad;
  const g = heightAt(x, y);
  if (g === null) {
    return null;
  }
  const road = heightAt(x + rx * PROBE_M, y + ry * PROBE_M) ?? g;
  const bx = x - rx * KERB_WIDTH;
  const by = y - ry * KERB_WIDTH;
  // the ground right where the stone ends: the back's top meets it there
  const walk = heightAt(bx, by) ?? g;
  const face = epsgToWorld(x, y, offset);
  const back = epsgToWorld(bx, by, offset);
  const n = epsgToWorld(x + rx, y + ry, offset);
  const top = Math.max(road + kerbH, walk + LIFT_M);
  return {
    at: { face: [x, y], back: [bx, by] },
    face,
    back,
    n: { x: n.x - face.x, z: n.z - face.z },
    // the feet reach the lower of the ground under them and beside them: a
    // gutter or a verge dips below the road a few decimetres out
    faceFoot: Math.min(road, g) - SINK_M,
    backFoot: walk - SINK_M,
    top,
    // on the pavement's level, a lower one too (a verge, a bank down): the
    // top then falls further rather than stand a step on it
    backTop: meetGround(top, walk, { lift: LIFT_M }),
  };
}

function pushTri(
  pos: number[],
  nrm: number[],
  n: [number, number, number],
  ...v: [number, number, number][]
): void {
  // Wound counter-clockwise seen from the side `n` faces (front faces).
  for (const p of [v[0], v[2], v[1]]) {
    pos.push(...p);
    nrm.push(...n);
  }
}

/** The top's normal: up, tilted toward the pavement by the bevel. */
function bevelNormal(c: KerbCol): [number, number, number] {
  const drop = (c.top - c.backTop) / KERB_WIDTH;
  const l = Math.hypot(drop, 1);
  // the top falls toward the back (−n): its normal leans that way
  return [(-c.n.x * drop) / l, 1 / l, (-c.n.z * drop) / l];
}

/** The face, the top and the back between two columns (flat-shaded). */
function pushSpan(pos: number[], nrm: number[], a: KerbCol, b: KerbCol): void {
  const fa0: [number, number, number] = [a.face.x, a.faceFoot, a.face.z];
  const fa1: [number, number, number] = [a.face.x, a.top, a.face.z];
  const fb0: [number, number, number] = [b.face.x, b.faceFoot, b.face.z];
  const fb1: [number, number, number] = [b.face.x, b.top, b.face.z];
  const ba0: [number, number, number] = [a.back.x, a.backFoot, a.back.z];
  const ba1: [number, number, number] = [a.back.x, a.backTop, a.back.z];
  const bb0: [number, number, number] = [b.back.x, b.backFoot, b.back.z];
  const bb1: [number, number, number] = [b.back.x, b.backTop, b.back.z];
  const nf: [number, number, number] = [a.n.x, 0, a.n.z];
  const nb: [number, number, number] = [-a.n.x, 0, -a.n.z];
  const up = bevelNormal(a);
  pushTri(pos, nrm, nf, fa0, fb0, fb1);
  pushTri(pos, nrm, nf, fa0, fb1, fa1);
  pushTri(pos, nrm, up, fa1, fb1, bb1);
  pushTri(pos, nrm, up, fa1, bb1, ba1);
  pushTri(pos, nrm, nb, ba0, bb1, bb0);
  pushTri(pos, nrm, nb, ba0, ba1, bb1);
}

/** A span's joins between two columns: its feet on either side, its
 *  top's back edge, which meets the pavement. */
function kerbJoins(a: KerbCol, b: KerbCol): JoinPoint[] {
  const end = (c: KerbCol, side: "back" | "face", z: number) => ({
    x: c.at[side][0],
    y: c.at[side][1],
    z,
  });
  return [
    ...joinsAlong(
      "foot",
      end(a, "face", a.faceFoot),
      end(b, "face", b.faceFoot)
    ),
    ...joinsAlong(
      "foot",
      end(a, "back", a.backFoot),
      end(b, "back", b.backFoot)
    ),
    ...joinsAlong("edge", end(a, "back", a.backTop), end(b, "back", b.backTop)),
  ];
}

/** Unit direction toward the road (left of the line) at each point. */
function towardRoad(pts: Point2[]): Point2[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  });
}

/**
 * Every kerb line as a stone band on the ground, lowered along its drops.
 * Lines are EPSG, not recentered, the carriageway on their left (a bare
 * point list is a line without drops). Null when nothing stands.
 */
export function kerbGeometry(
  lines: readonly (KerbLine | Point2[])[],
  heightAt: HeightAt,
  offset: RecenterOffset
): KerbGeometryData | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const joins: JoinPoint[] = [];
  for (const entry of lines) {
    const { coords: line, low = [] } = Array.isArray(entry)
      ? { coords: entry }
      : entry;
    if (line.length < 2) {
      continue;
    }
    const pts = followGround(profilePoints(line, low), heightAt);
    // followGround only adds points on the segments: their distance along
    // the line is the polyline's own
    const along = low.length > 0 ? alongOf(pts) : [];
    const dirs = towardRoad(pts);
    const cols = pts.map((p, i) =>
      kerbCol(
        p,
        dirs[i],
        heightAt,
        offset,
        low.length > 0 ? kerbHeightAt(along[i], low) : KERB_HEIGHT
      )
    );
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i];
      const b = cols[i + 1];
      if (a && b) {
        pushSpan(positions, normals, a, b);
        joins.push(...kerbJoins(a, b));
      }
    }
  }
  return positions.length > 0 ? { positions, normals, joins } : null;
}
