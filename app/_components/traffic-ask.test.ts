import { expect, test } from "bun:test";
import type { TrafficFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
// the BVH the set builds on its first question (collision.ts patches it in)
import "./collision";
import { trafficTriangles } from "./selection-shape";
import { trafficAskSet, trafficMesh } from "./traffic-ask";
import { buildTraffic } from "./traffic-layer";

const ctx: GroundContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 110,
};

const section = (
  y: number,
  props: NonNullable<TrafficFeature["properties"]>
): TrafficFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, y],
      [100, y],
    ],
  },
  properties: props,
});

const features = [
  section(0, { t: 9000, f: 6000, b: 3000, n: "Südstraße" }),
  section(50, { t: 4000, n: "Nordstraße" }),
];

/** Straight down onto the data point (x, y). */
const down = (x: number, y: number) =>
  [{ x, y: 300, z: -y }, { x: 0, y: -1, z: 0 }, 1000] as const;

test("a ray onto a body names the counted section it belongs to", () => {
  const group = buildTraffic(features, [], ctx);
  const set = trafficAskSet(group, features, "t");
  const hit = set?.nearest(...down(40, 50));
  expect(hit?.target.kind).toBe("traffic");
  if (hit?.target.kind !== "traffic") {
    return;
  }
  expect(hit.target.index).toBe(1);
  expect(hit.target.properties.n).toBe("Nordstraße");
  // drawn eastward, its middle on the line
  expect(hit.target.bearing).toBeCloseTo(90, 5);
  expect(hit.target.position).toEqual([50, 50]);
  expect(hit.distance).toBeGreaterThan(300 - 110 - 10);
  expect(hit.distance).toBeLessThan(300 - 110);
});

test("a hidden layer answers nothing, and the empty street nothing", () => {
  const group = buildTraffic(features, [], ctx);
  const set = trafficAskSet(group, features, "t");
  expect(set?.nearest(...down(40, 25))).toBeNull();
  group.visible = false;
  expect(set?.nearest(...down(40, 50))).toBeNull();
  expect(trafficAskSet(buildTraffic([], [], ctx), [], "t")).toBeNull();
});

test("the outline takes the asked section's triangles, and only them", () => {
  const flow = trafficMesh(buildTraffic(features, [], ctx));
  expect(flow).not.toBeNull();
  if (!flow) {
    return;
  }
  const sections = flow.userData.trafficSection as Uint32Array;
  expect(sections.length).toBe(flow.geometry.getAttribute("position").count);
  const north = trafficTriangles(flow, 1);
  const south = trafficTriangles(flow, 0);
  expect(north.length).toBeGreaterThan(0);
  expect(north.length % 3).toBe(0);
  expect([...north].every((v) => sections[v] === 1)).toBe(true);
  // the two-way street is two bodies, the one-way total one
  expect(south.length).toBeGreaterThan(north.length);
  expect(north.length + south.length).toBe(
    flow.geometry.getIndex()?.count ?? -1
  );
});
