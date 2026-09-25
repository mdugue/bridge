/**
 * Fences, railings and gates from OSM (`pipeline/bake/walls.py`: the fence
 * lines and gate points ride the walls file) as one flat, double-sided panel
 * between each pair of posts, ≤ 2.5 m apart. DOM-free, THREE-free, pure —
 * the terrain bake (scripts/bake-tiles.ts `fenceMesh`) writes them into the
 * fine terrain glTF beside the walls (ADR 0029), and `fence-layer.ts` gives
 * them their material, which draws the panel's pattern (bars, mesh,
 * pickets) from the first UV set.
 *
 * A fence stands on its OSM line, on the final fine ground (`heightAt`, the
 * TIN): it never reshapes the terrain and never snaps to a step. At each gate
 * the line is cut `w` wide; a closed leaf (the panel with a darker frame)
 * stands in the gap, a boom where the gate is a lift gate, swing gate or
 * cycle barrier. A closed ring is cut across its closing vertex like
 * anywhere else. A gate the neighbouring tile owns whose gap reaches over
 * the seam (`seam`) cuts this tile's piece too, and draws its leaf's share
 * here, so the gate is whole across the seam. Gates on a freestanding wall
 * cut the wall the same way (`cutGaps`, used by the wall bake too).
 *
 * The panel's pattern is procedural in the fragment shader, not a texture:
 * the UV packs a pattern code and the distance along the panel,
 * `u = (code · FENCE_UV_SPAN + along) / (FENCE_UV_CODES · FENCE_UV_SPAN)`,
 * `v` = the height fraction — so the glTF carries no image and the shader can
 * box-filter the bars over the pixel footprint. The post at a panel's start
 * and the top rail are part of the pattern too (a run's last post is a
 * narrow quad of its own): posts and rails as boxes cost four times the
 * vertices and pushed the fine terrain glTF 12–32 % over its size, against
 * the plan's 10 % budget.
 */
import { epsgToWorld, type RecenterOffset } from "./ground-clamp";
import type { Point2 } from "./polyline";

type HeightAt = (x: number, y: number) => number | null;

/** The panel a fence draws: iron bars, a wire mesh, wooden pickets, or none
 *  (`rail`, a handrail: posts and a rail). */
export type FenceType = "mesh" | "picket" | "rail" | "railing";

export interface FenceLine {
  /** EPSG coordinates (NOT recentered) */
  coords: Point2[];
  /** height (m) */
  h: number;
  type: FenceType;
}

export interface GatePoint {
  /** EPSG position on its line (the bake snaps it there) */
  at: Point2;
  /** the line it stands on */
  on: "fence" | "wall";
  /** the neighbouring tile's gate, its gap reaching over the seam: it may
   *  stand past the end of this tile's piece of the line */
  seam?: boolean;
  /** lift_gate / swing_gate / cycle_barrier: a boom instead of a leaf */
  type?: string;
  /** gap width (m) */
  w: number;
}

/** Pattern codes in the UV (read by fence-layer.ts). Panels with a post and
 *  a rail: 0–4 (a handrail has no infill); solid quads (a run's last post,
 *  a boom): 5–7. */
export const FENCE_CODE = {
  railing: 0,
  mesh: 1,
  picket: 2,
  gate: 3,
  handrail: 4,
  iron: 5,
  wood: 6,
  frame: 7,
} as const;
/** Metres of along-panel distance each code owns in `u`. */
export const FENCE_UV_SPAN = 5;
/** Codes the `u` range is split into. */
export const FENCE_UV_CODES = 8;

const SAMPLE_M = 2.5; // the longest panel between two posts (m)
const SIMPLIFY_M = 0.1; // line vertices this close to the chord are dropped (m)
const SINK_M = 0.05; // panels reach this far into the ground (m)
const POST_M = 0.04; // a run's last post (m; fence-layer.ts draws the others)
const GATE_ON_M = 0.6; // a gate this close to a line cuts it (m)
const BOOM_M = 1.0; // a lift gate's boom (m)
const MIN_PIECE_M = 0.3; // shorter pieces between gaps are dropped (m)
const CLOSED_M = 0.01; // a line whose ends are this close is a closed ring (m)
const EPS_M = 1e-6; // a gap overhanging a ring's closure by less is not wrapped (m)

export interface FenceGeometryData {
  indices: number[];
  /** world-frame (Y-up, recentered) normals, xyz per vertex */
  normals: number[];
  /** world-frame (Y-up, recentered) positions, xyz per vertex */
  positions: number[];
  /** pattern code + along (u) and height fraction (v) per vertex */
  uvs: number[];
}

/** `u` for a code and a distance along the panel (kept a centimetre inside
 *  the code's span, so 16-bit quantisation never tips it into the next). */
export function fenceU(code: number, along: number): number {
  const clamped = Math.min(Math.max(along, 0.01), FENCE_UV_SPAN - 0.01);
  return (code * FENCE_UV_SPAN + clamped) / (FENCE_UV_CODES * FENCE_UV_SPAN);
}

// --- gaps ---------------------------------------------------------------------

function cumulative(line: Point2[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    out.push(out[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  return out;
}

/**
 * Distance along the line of its point nearest to `p`, and how far off.
 * `extend` continues the first and last segments past the line's ends (a
 * neighbour's gate beyond the seam stands on the line's continuation): the
 * distance along is then negative, or beyond the line's length.
 */
function project(
  line: Point2[],
  acc: number[],
  p: Point2,
  extend = false
): [number, number] {
  let best: [number, number] = [0, Number.POSITIVE_INFINITY];
  const last = line.length - 2;
  for (let i = 0; i <= last; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const lo = extend && i === 0 ? Number.NEGATIVE_INFINITY : 0;
    const hi = extend && i === last ? Number.POSITIVE_INFINITY : 1;
    const t =
      len2 > 0
        ? Math.min(
            Math.max(((p[0] - x0) * dx + (p[1] - y0) * dy) / len2, lo),
            hi
          )
        : 0;
    const d = Math.hypot(x0 + dx * t - p[0], y0 + dy * t - p[1]);
    if (d < best[1]) {
      best = [acc[i] + Math.sqrt(len2) * t, d];
    }
  }
  return best;
}

/** The point `s` metres along the line. */
export function pointAlong(line: Point2[], acc: number[], s: number): Point2 {
  for (let i = 1; i < line.length; i++) {
    if (s <= acc[i] || i === line.length - 1) {
      const span = acc[i] - acc[i - 1];
      const t =
        span > 0 ? Math.min(Math.max((s - acc[i - 1]) / span, 0), 1) : 0;
      const [x0, y0] = line[i - 1];
      const [x1, y1] = line[i];
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
  }
  return line[0];
}

/** The stretch of the line between `s0` and `s1` metres along it. */
function slice(
  line: Point2[],
  acc: number[],
  s0: number,
  s1: number
): Point2[] {
  const out: Point2[] = [pointAlong(line, acc, s0)];
  for (let i = 1; i < line.length - 1; i++) {
    if (acc[i] > s0 && acc[i] < s1) {
      out.push(line[i]);
    }
  }
  out.push(pointAlong(line, acc, s1));
  return out;
}

/** Whether a line closes on itself (an area's ring, a closed way). */
function isClosed(line: Point2[]): boolean {
  const [x0, y0] = line[0];
  const [x1, y1] = line.at(-1) ?? line[0];
  return line.length > 3 && Math.hypot(x1 - x0, y1 - y0) <= CLOSED_M;
}

interface Gap {
  gate: GatePoint;
  s0: number;
  s1: number;
}

/** A gate's gap, `w` wide around `s`: clipped to the line's ends, or on a
 *  closed ring wrapped across its closing vertex (two intervals there). */
function gapIntervals(
  gate: GatePoint,
  s: number,
  total: number,
  closed: boolean
): Gap[] {
  const s0 = s - gate.w / 2;
  const s1 = s + gate.w / 2;
  const out: Gap[] = [];
  if (closed && s0 < -EPS_M) {
    out.push({ gate, s0: total + s0, s1: total });
  }
  if (closed && s1 > total + EPS_M) {
    out.push({ gate, s0: 0, s1: s1 - total });
  }
  const clipped = { gate, s0: Math.max(0, s0), s1: Math.min(total, s1) };
  if (clipped.s1 > clipped.s0) {
    out.push(clipped);
  }
  return out;
}

/** The gap intervals the gates cut into one line, merged where they overlap. */
function gapsOn(
  line: Point2[],
  acc: number[],
  gates: readonly GatePoint[],
  closed: boolean
): Gap[] {
  const total = acc.at(-1) ?? 0;
  const gaps: Gap[] = [];
  for (const gate of gates) {
    const [s, d] = project(line, acc, gate.at, gate.seam === true && !closed);
    if (d <= GATE_ON_M) {
      gaps.push(...gapIntervals(gate, s, total, closed));
    }
  }
  gaps.sort((a, b) => a.s0 - b.s0);
  const merged: Gap[] = [];
  for (const g of gaps) {
    const last = merged.at(-1);
    if (last && g.s0 <= last.s1) {
      last.s1 = Math.max(last.s1, g.s1);
    } else {
      merged.push({ ...g });
    }
  }
  return merged;
}

/** The same closed ring, starting (and closing) `s` metres along it. */
function rotateRing(line: Point2[], acc: number[], s: number): Point2[] {
  const start = pointAlong(line, acc, s);
  const out: Point2[] = [start];
  const n = line.length - 1; // line[n] repeats line[0]
  for (let i = 1; i <= n; i++) {
    if (acc[i] > s) {
      out.push(line[i]);
    }
  }
  for (let i = 1; i < n; i++) {
    if (acc[i] < s) {
      out.push(line[i]);
    }
  }
  out.push(start);
  return out;
}

/** Where to open a closed ring: where the gap across its closing vertex
 *  starts, if one wraps it, else where the first gap starts. */
function ringStart(gaps: Gap[], total: number): number {
  const first = gaps[0];
  const last = gaps.at(-1) ?? first;
  return gaps.length > 1 && first.s0 <= EPS_M && last.s1 >= total - EPS_M
    ? last.s0
    : first.s0;
}

export interface CutLine {
  /** the gate leaves: a straight chord across each gap */
  leaves: { a: Point2; b: Point2; gate: GatePoint }[];
  /** what is left of the line, in order */
  pieces: Point2[][];
}

/**
 * Cuts a line at every gate that stands on it (within GATE_ON_M), each gap
 * `w` wide around the gate, and returns the pieces and the leaves. A closed
 * ring with a gate on it is opened at a gap's start first, so no gap is cut
 * in two at the ring's closing vertex and no piece ends there.
 */
export function cutGaps(line: Point2[], gates: readonly GatePoint[]): CutLine {
  return cutLine(line, gates, false);
}

function cutLine(
  line: Point2[],
  gates: readonly GatePoint[],
  opened: boolean
): CutLine {
  if (line.length < 2) {
    return { pieces: [], leaves: [] };
  }
  const acc = cumulative(line);
  const total = acc.at(-1) ?? 0;
  const near = gates.filter((g) =>
    nearBox(line, g.at, g.seam ? Math.max(GATE_ON_M, g.w / 2) : GATE_ON_M)
  );
  const closed = isClosed(line);
  const gaps = gapsOn(line, acc, near, closed);
  if (closed && !opened && gaps.length > 0) {
    const start = ringStart(gaps, total);
    if (start > EPS_M) {
      return cutLine(rotateRing(line, acc, start), near, true);
    }
  }
  const pieces: Point2[][] = [];
  const leaves: CutLine["leaves"] = [];
  let from = 0;
  for (const gap of gaps) {
    if (gap.s0 - from >= MIN_PIECE_M) {
      pieces.push(slice(line, acc, from, gap.s0));
    }
    leaves.push({
      a: pointAlong(line, acc, gap.s0),
      b: pointAlong(line, acc, gap.s1),
      gate: gap.gate,
    });
    from = gap.s1;
  }
  if (total - from >= MIN_PIECE_M) {
    pieces.push(gaps.length > 0 ? slice(line, acc, from, total) : line);
  }
  return { pieces, leaves };
}

function nearBox(line: Point2[], p: Point2, margin: number): boolean {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [x, y] of line) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return (
    p[0] >= x0 - margin &&
    p[0] <= x1 + margin &&
    p[1] >= y0 - margin &&
    p[1] <= y1 + margin
  );
}

// --- geometry -----------------------------------------------------------------

/** A sample along a piece: world XZ, ground height, horizontal unit normal. */
interface Station {
  along: number;
  g: number;
  nx: number;
  nz: number;
  wx: number;
  wz: number;
}

/** Drops vertices within SIMPLIFY_M of the chord (Douglas–Peucker), so a
 *  finely drawn curve does not stand a post every few centimetres. */
function simplify(line: Point2[]): Point2[] {
  if (line.length <= 2) {
    return line;
  }
  const [x0, y0] = line[0];
  const [x1, y1] = line.at(-1) ?? line[0];
  const len = Math.hypot(x1 - x0, y1 - y0);
  let worst = 0;
  let at = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const [x, y] = line[i];
    const d =
      len > 0
        ? Math.abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / len
        : Math.hypot(x - x0, y - y0);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= SIMPLIFY_M) {
    return [line[0], line.at(-1) ?? line[0]];
  }
  return [
    ...simplify(line.slice(0, at + 1)).slice(0, -1),
    ...simplify(line.slice(at)),
  ];
}

/** Stations every ≤ SAMPLE_M along a piece; null where the ground is unknown. */
function stationsOf(
  piece: Point2[],
  heightAt: HeightAt,
  offset: RecenterOffset
): (Station | null)[] {
  const line = simplify(piece);
  const pts: Point2[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(x1 - x0, y1 - y0) / SAMPLE_M)
    );
    for (let s = 0; s < steps; s++) {
      pts.push([x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps]);
    }
  }
  pts.push(line.at(-1) ?? line[0]);
  let along = 0;
  return pts.map((p, i) => {
    if (i > 0) {
      along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    }
    const g = heightAt(p[0], p[1]);
    if (g === null) {
      return null;
    }
    // The panel's normal: across the segment ahead (the last: behind).
    const a = pts[Math.min(i, pts.length - 2)];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const wa = epsgToWorld(a[0], a[1], offset);
    const wb = epsgToWorld(b[0], b[1], offset);
    const w = epsgToWorld(p[0], p[1], offset);
    const tl = Math.hypot(wb.x - wa.x, wb.z - wa.z) || 1;
    return {
      along,
      g,
      wx: w.x,
      wz: w.z,
      nx: -(wb.z - wa.z) / tl,
      nz: (wb.x - wa.x) / tl,
    };
  });
}

/** Splits stations at unknown ground into runs that stand. */
function runsOf(stations: (Station | null)[]): Station[][] {
  const runs: Station[][] = [];
  let run: Station[] = [];
  for (const s of stations) {
    if (s) {
      run.push(s);
    } else {
      if (run.length >= 2) {
        runs.push(run);
      }
      run = [];
    }
  }
  if (run.length >= 2) {
    runs.push(run);
  }
  return runs;
}

class Builder {
  readonly data: FenceGeometryData = {
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
  };

  private vertex(
    x: number,
    y: number,
    z: number,
    n: [number, number, number],
    u: number,
    v: number
  ): number {
    const d = this.data;
    d.positions.push(x, y, z);
    d.normals.push(...n);
    d.uvs.push(u, v);
    return d.positions.length / 3 - 1;
  }

  /**
   * One flat quad from A to B (double-sided in the material), from `lo` to
   * `hi` over the ground: `u` runs 0 → the segment's length, `v` 0 → 1. Wound
   * counter-clockwise about its normal (the segment's left).
   */
  quad(
    a: Station,
    b: Station,
    code: number,
    lo: number,
    hi: number,
    length = b.along - a.along
  ): void {
    const dx = b.wx - a.wx;
    const dz = b.wz - a.wz;
    const tl = Math.hypot(dx, dz) || 1;
    const n: [number, number, number] = [-dz / tl, 0, dx / tl];
    const u0 = fenceU(code, 0);
    const u1 = fenceU(code, length);
    const v0 = this.vertex(a.wx, a.g + lo, a.wz, n, u0, 0);
    const v1 = this.vertex(b.wx, b.g + lo, b.wz, n, u1, 0);
    const v2 = this.vertex(b.wx, b.g + hi, b.wz, n, u1, 1);
    const v3 = this.vertex(a.wx, a.g + hi, a.wz, n, u0, 1);
    this.data.indices.push(v0, v1, v2, v0, v2, v3);
  }

  /** A post drawn solid at the end of a run: a quad POST_M wide, ending there. */
  endPost(last: Station, prev: Station, code: number, h: number): void {
    const dx = last.wx - prev.wx;
    const dz = last.wz - prev.wz;
    const tl = Math.hypot(dx, dz) || 1;
    const back: Station = {
      ...last,
      wx: last.wx - (dx / tl) * POST_M,
      wz: last.wz - (dz / tl) * POST_M,
      along: last.along - POST_M,
    };
    this.quad(back, last, code, -SINK_M, h);
  }
}

const panelCode = (type: FenceType): number =>
  type === "rail" ? FENCE_CODE.handrail : FENCE_CODE[type];
const solidCode = (type: FenceType): number =>
  type === "picket" ? FENCE_CODE.wood : FENCE_CODE.iron;
/** Gates drawn as a boom at 1 m rather than a leaf. */
const BOOM_TYPES = new Set(["lift_gate", "swing_gate", "cycle_barrier"]);

/** One run of a fence: a panel per station pair (its post at the start, its
 *  rail along the top, both drawn by the pattern), and a post at the end. */
function buildRun(
  b: Builder,
  run: Station[],
  type: FenceType,
  h: number
): void {
  for (let i = 1; i < run.length; i++) {
    b.quad(run[i - 1], run[i], panelCode(type), -SINK_M, h);
  }
  const last = run.at(-1);
  const prev = run.at(-2);
  if (last && prev) {
    b.endPost(last, prev, solidCode(type), h);
  }
}

/** A gate across its gap: a closed leaf, or a boom (BOOM_TYPES). */
function buildLeaf(
  b: Builder,
  leaf: CutLine["leaves"][number],
  h: number,
  heightAt: HeightAt,
  offset: RecenterOffset
): void {
  const run = runsOf(stationsOf([leaf.a, leaf.b], heightAt, offset))[0];
  if (!run) {
    return;
  }
  const boom = BOOM_TYPES.has(leaf.gate.type ?? "");
  for (let i = 1; i < run.length; i++) {
    if (boom) {
      b.quad(run[i - 1], run[i], FENCE_CODE.frame, BOOM_M - 0.05, BOOM_M);
    } else {
      b.quad(run[i - 1], run[i], FENCE_CODE.gate, -SINK_M, h);
    }
  }
}

/** A wall line as the wall bake reads it (lib/city/walls.ts `WallRibbon`). */
interface WallLike {
  coords: Point2[];
  h: number;
  kind?: string;
}

/** A leaf in a wall's gap, and how tall it stands. */
export interface WallLeaf {
  h: number;
  leaf: CutLine["leaves"][number];
}

/**
 * Cuts the freestanding walls (`kind` "wall") at the gates standing on a
 * wall: the pieces replace the wall, and each gap gets a leaf as tall as the
 * wall (1–2.2 m). Retaining walls, city walls and cliffs are never cut — a
 * gap in a step would show the ramp behind it.
 */
export function cutWallGates<W extends WallLike>(
  walls: readonly W[],
  gates: readonly GatePoint[]
): { leaves: WallLeaf[]; walls: W[] } {
  const wallGates = gates.filter((g) => g.on === "wall");
  const out: W[] = [];
  const leaves: WallLeaf[] = [];
  for (const wall of walls) {
    if (wall.kind !== "wall" || wallGates.length === 0) {
      out.push(wall);
      continue;
    }
    const cut = cutGaps(wall.coords, wallGates);
    out.push(...cut.pieces.map((coords) => ({ ...wall, coords })));
    const h = Math.min(Math.max(wall.h, 1), 2.2);
    leaves.push(...cut.leaves.map((leaf) => ({ leaf, h })));
  }
  return { walls: out, leaves };
}

/**
 * Every fence (cut at its gates) as panels with their posts and rail, plus a leaf in
 * each gap — and a leaf in every gap `wallLeaves` names (gates the wall bake
 * cut into freestanding walls). Null when nothing stands.
 */
export function fenceGeometry(
  fences: readonly FenceLine[],
  gates: readonly GatePoint[],
  heightAt: HeightAt,
  offset: RecenterOffset,
  wallLeaves: readonly WallLeaf[] = []
): FenceGeometryData | null {
  const b = new Builder();
  const fenceGates = gates.filter((g) => g.on === "fence");
  for (const fence of fences) {
    const h = Math.min(Math.max(fence.h, 0.3), 4);
    const cut = cutGaps(fence.coords, fenceGates);
    for (const piece of cut.pieces) {
      for (const run of runsOf(stationsOf(piece, heightAt, offset))) {
        buildRun(b, run, fence.type, h);
      }
    }
    for (const leaf of cut.leaves) {
      buildLeaf(b, leaf, Math.max(h, 1), heightAt, offset);
    }
  }
  for (const { leaf, h } of wallLeaves) {
    buildLeaf(b, leaf, h, heightAt, offset);
  }
  return b.data.indices.length > 0 ? b.data : null;
}
