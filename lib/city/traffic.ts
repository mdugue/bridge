/**
 * The counted traffic as bands on the road (app/_components/traffic-layer.ts),
 * the pure half: one lane per counted direction, laid on the right of its
 * travel (Germany drives on the right), as wide and as busy as its vehicles
 * per day say. No THREE, no DOM.
 *
 * - A section counted both ways gets two lanes, either side of the line.
 * - A section counted one way only (a one-way street, or a count of one
 *   side) gets one lane on the line itself, flowing that way.
 * - A section with only the table's total gets one lane on the line that
 *   does not flow (no direction is known).
 */
import type { TrafficFeature } from "./features";
import type { Point2 } from "./polyline";

/** The vehicles per day at which a lane reads as calm, and as full: the
 *  site's busiest sections carry ~35 000 a day in one direction, a quiet
 *  residential street a few hundred. */
export const TRAFFIC_DTV = { calm: 300, full: 30_000 } as const;
/** A lane's width (m) at no traffic and at `TRAFFIC_DTV.full`. */
export const LANE_WIDTH_M = { min: 1.2, max: 3.6 } as const;
/** The gap (m) between the two lanes of a section. */
export const LANE_GAP_M = 0.5;
/** A flow body's height (m) at no traffic and at `TRAFFIC_DTV.full`. */
export const FLOW_HEIGHT_M = { min: 0.6, max: 6 } as const;

export interface TrafficLane {
  /** the lane's centreline in travel order (projected coordinates) */
  coords: Point2[];
  /** vehicles per day */
  dtv: number;
  /** whether the lane flows (false: only the undirected total is known) */
  flows: boolean;
  /** heavy-goods share 0..1 (0 when not counted) */
  heavy: number;
  /** 0 (calm) .. 1 (full), on a log scale of the vehicles per day */
  load: number;
  /** the lane's centre, metres to the right of its travel direction */
  offset: number;
  /** the lane's width (m) */
  width: number;
}

/** 0..1 on a log scale between `TRAFFIC_DTV.calm` and `.full`: a doubling
 *  of the traffic is the same step anywhere on the scale. */
export function trafficLoad(dtv: number): number {
  if (!(dtv > 0)) {
    return 0;
  }
  const t =
    Math.log(dtv / TRAFFIC_DTV.calm) /
    Math.log(TRAFFIC_DTV.full / TRAFFIC_DTV.calm);
  return Math.min(Math.max(t, 0), 1);
}

/** A lane's width (m): the square root of the traffic, so the band's area
 *  per metre grows with the flow without swamping the street. */
export function laneWidth(dtv: number): number {
  const f = Math.min(Math.max(dtv, 0) / TRAFFIC_DTV.full, 1);
  return (
    LANE_WIDTH_M.min + (LANE_WIDTH_M.max - LANE_WIDTH_M.min) * Math.sqrt(f)
  );
}

/** A flow body's height (m): the root of the traffic, like its width, so
 *  its cross-section grows with the flow — a street with four times the
 *  traffic stands twice as tall and twice as wide. */
export function flowHeight(dtv: number): number {
  const f = Math.min(Math.max(dtv, 0) / TRAFFIC_DTV.full, 1);
  return (
    FLOW_HEIGHT_M.min + (FLOW_HEIGHT_M.max - FLOW_HEIGHT_M.min) * Math.sqrt(f)
  );
}

/** How far (m) a flow body tapers in at each end: a soft point, not a cut
 *  face — each counted section reads as one body. */
export function flowTaper(length: number): number {
  return Math.min(8, length / 4);
}

/**
 * The flow body's cross-section at its full size: `segments` + 1 points
 * from the right foot over the crown to the left foot, as (across, up) in
 * units of half the width and the height — a soft dome with near-upright
 * flanks (a superellipse's upper half).
 */
export function flowProfile(segments: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = (Math.PI * i) / segments;
    out.push([Math.cos(t), Math.sin(t) ** 0.45]);
  }
  return out;
}

function lane(
  coords: Point2[],
  dtv: number,
  heavy: number | undefined,
  flows: boolean,
  paired: boolean
): TrafficLane {
  const width = laneWidth(dtv);
  return {
    coords,
    dtv,
    flows,
    heavy: heavy ?? 0,
    load: trafficLoad(dtv),
    offset: paired ? width / 2 + LANE_GAP_M / 2 : 0,
    width,
  };
}

/** The lanes of one counted section (see the module comment). */
export function trafficLanes(f: TrafficFeature): TrafficLane[] {
  const p = f.properties;
  const coords = f.geometry.coordinates;
  if (!p || coords.length < 2) {
    return [];
  }
  const along = p.f ?? 0;
  const against = p.b ?? 0;
  const paired = along > 0 && against > 0;
  const lanes: TrafficLane[] = [];
  if (along > 0) {
    lanes.push(lane(coords, along, p.hf, true, paired));
  }
  if (against > 0) {
    lanes.push(lane([...coords].reverse(), against, p.hb, true, paired));
  }
  if (lanes.length === 0 && p.t > 0) {
    lanes.push(lane(coords, p.t, undefined, false, false));
  }
  return lanes;
}

/** The unit vector to the right of travel from `a` to `b` (projected
 *  coordinates, y north), or null for a zero-length step. */
export function rightOf(a: Point2, b: Point2): Point2 | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len > 0 ? [dy / len, -dx / len] : null;
}
