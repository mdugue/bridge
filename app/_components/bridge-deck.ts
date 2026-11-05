/**
 * The deck table: every baked bridge deck as a lift entry (`buildDeckTable`,
 * what rails, trams, traffic and the data overlays ride), with the
 * approaches from its abutment ends down to the ground (`approaches`, ADR
 * 0041). Geometry of the plan only: nothing here builds a mesh, so a layer
 * that only rides the decks does not bring the bridges' drawing
 * (bridge-layer.ts, which imports this, never the other way).
 */
import { APPROACH_GRADE, approachLanding, axisFrame } from "@/lib/city/bridge";
import { deckPoly, deckRing, longAxis, pointInRing } from "@/lib/city/decks";
import type { DeckPoly, Ring2 } from "@/lib/city/decks";
import type { BridgeFeature } from "@/lib/city/features";
import { worldToEpsg } from "@/lib/city/ground-clamp";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { outward, ringWinding } from "./mesh-kit";

const END_EDGE_COS = 0.5; // a ring edge this far off the axis is an abutment end

export type BridgeProps = NonNullable<BridgeFeature["properties"]>;

/** A bridge feature's properties with defaults (`properties` may be null). */
export function bridgeProps(f: BridgeFeature): {
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
  const { heightAt } = ctx;
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
export interface ApproachColumn {
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
  if (start === -1) {
    return [];
  }
  const runs: number[][] = [];
  let run: number[] = [];
  for (let k = 1; k <= n; k += 1) {
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
  for (let k = 0; k < run.length - 1; k += 1) {
    const a = run[k];
    const b = run[k + 1];
    const len = Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z);
    const m = Math.max(1, Math.ceil(len / APPROACH_COLUMN_M));
    for (let j = 0; j < m; j += 1) {
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
    for (let k = 0; k < run.length - 1; k += 1) {
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
