import { expect, test } from "bun:test";
import type { TrafficFeature } from "./features";
import {
  FLOW_HEIGHT_M,
  flowHeight,
  flowProfile,
  flowTaper,
  LANE_WIDTH_M,
  openEnds,
  laneWidth,
  rightOf,
  TRAFFIC_DTV,
  TRAFFIC_SCALE,
  trafficLanes,
  trafficLoad,
} from "./traffic";

const section = (
  props: NonNullable<TrafficFeature["properties"]>
): TrafficFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [100, 0],
    ],
  },
  properties: props,
});

test("the load steps a quarter per colour stop, log-spaced between them", () => {
  expect(trafficLoad(0)).toBe(0);
  expect(trafficLoad(TRAFFIC_SCALE[0].dtv)).toBe(0);
  TRAFFIC_SCALE.forEach((stop, i) => {
    expect(trafficLoad(stop.dtv)).toBeCloseTo(i / 4, 9);
  });
  expect(trafficLoad(TRAFFIC_SCALE[4].dtv * 3)).toBe(1);
  const mid = Math.sqrt(TRAFFIC_SCALE[1].dtv * TRAFFIC_SCALE[2].dtv);
  expect(trafficLoad(mid)).toBeCloseTo(0.375, 6);
  // the main roads no longer share one colour: 6 000 and 12 000 a day
  // lie a whole stop apart
  expect(trafficLoad(12_000) - trafficLoad(6000)).toBeGreaterThan(0.2);
});

test("a busier lane is wider, within its bounds", () => {
  expect(laneWidth(0)).toBe(LANE_WIDTH_M.min);
  expect(laneWidth(TRAFFIC_DTV.full)).toBeCloseTo(LANE_WIDTH_M.max, 9);
  expect(laneWidth(5000)).toBeGreaterThan(laneWidth(1000));
});

test("a section counted both ways has a lane each side, each running its way", () => {
  const lanes = trafficLanes(section({ t: 9000, f: 6000, b: 3000, hf: 0.1 }));
  expect(lanes).toHaveLength(2);
  const [along, against] = lanes;
  expect(along.coords[0]).toEqual([0, 0]);
  expect(against.coords[0]).toEqual([100, 0]);
  expect(along.offset).toBeGreaterThan(along.width / 2);
  expect(against.offset).toBeGreaterThan(against.width / 2);
  expect(along.heavy).toBe(0.1);
  expect(against.heavy).toBe(0);
  expect(along.flows && against.flows).toBe(true);
  // Right of travel: east-bound traffic keeps to the south, west-bound to
  // the north — two lanes that do not overlap.
  const south = rightOf(along.coords[0], along.coords[1]);
  const north = rightOf(against.coords[0], against.coords[1]);
  expect(south?.[1]).toBe(-1);
  expect(north?.[1]).toBe(1);
});

test("a one-way count flows on the line itself", () => {
  const [only, ...rest] = trafficLanes(section({ t: 3700, f: 3700 }));
  expect(rest).toHaveLength(0);
  expect(only.offset).toBe(0);
  expect(only.flows).toBe(true);
});

test("only a total: one lane that does not flow", () => {
  const [only, ...rest] = trafficLanes(section({ t: 1200 }));
  expect(rest).toHaveLength(0);
  expect(only.flows).toBe(false);
  expect(only.dtv).toBe(1200);
});

test("a zero-length step has no side", () => {
  expect(rightOf([1, 1], [1, 1])).toBeNull();
});

test("a flow body grows with the root of its traffic, tapers at its ends", () => {
  expect(flowHeight(0)).toBe(FLOW_HEIGHT_M.min);
  expect(flowHeight(TRAFFIC_DTV.full)).toBeCloseTo(FLOW_HEIGHT_M.max, 9);
  expect(flowHeight(4 * 2000) - FLOW_HEIGHT_M.min).toBeCloseTo(
    2 * (flowHeight(2000) - FLOW_HEIGHT_M.min),
    9
  );
  expect(flowTaper(100)).toBe(8);
  expect(flowTaper(12)).toBe(3);
});

test("the profile runs from foot over the crown to foot", () => {
  const p = flowProfile(8);
  expect(p).toHaveLength(9);
  expect(p[0][0]).toBeCloseTo(1, 9);
  expect(p[0][1]).toBeCloseTo(0, 9);
  expect(p[4][0]).toBeCloseTo(0, 9);
  expect(p[4][1]).toBeCloseTo(1, 9);
  expect(p[8][0]).toBeCloseTo(-1, 9);
  // near-upright flanks: halfway out, already most of the height
  expect(p[2][1]).toBeGreaterThan(0.8);
});

const line = (
  coords: [number, number][],
  props: NonNullable<TrafficFeature["properties"]> = { t: 1000, f: 500, b: 500 }
): TrafficFeature => ({
  geometry: { type: "LineString", coordinates: coords },
  properties: props,
});

test("a flow ends only where no counted section runs on", () => {
  const ends = openEnds([
    line([
      [0, 0],
      [100, 0],
    ]),
    // the next stretch of the street, its end 1 m off (a junction)
    line([
      [101, 0],
      [200, 0],
    ]),
  ]);
  expect(ends).toEqual([
    [true, false],
    [false, true],
  ]);
});

test("a section cut at the tile's edge runs on into the neighbour", () => {
  const [ends] = openEnds(
    [
      line([
        [50, 50],
        [100, 50],
      ]),
    ],
    [0, 0, 100, 100]
  );
  expect(ends).toEqual([true, false]);
});

test("the lane against the line takes its section's ends the other way round", () => {
  const [along, against] = trafficLanes(
    line([
      [0, 0],
      [100, 0],
    ]),
    [true, false]
  );
  expect(along.open).toEqual([true, false]);
  expect(against.open).toEqual([false, true]);
});
