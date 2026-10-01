import { expect, test } from "bun:test";
import type { Mesh, MeshBasicNodeMaterial } from "three/webgpu";
import type { TrafficFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { buildTraffic } from "./traffic-layer";

const ctx: GroundContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: (x) => (x <= 200 ? 110 : null),
};

const street = (
  props: NonNullable<TrafficFeature["properties"]>,
  coords: [number, number][] = [
    [0, 0],
    [100, 0],
  ]
): TrafficFeature => ({
  geometry: { type: "LineString", coordinates: coords },
  properties: props,
});

const bands = (group: ReturnType<typeof buildTraffic>) =>
  group.children[0] as Mesh<Mesh["geometry"], MeshBasicNodeMaterial> | null;

test("no counted road, an empty group", () => {
  const group = buildTraffic([], [], ctx);
  expect(group.name).toBe("traffic");
  expect(group.children).toHaveLength(0);
});

test("a two-way street is two bands over the ground, flowing and widening", () => {
  const mesh = bands(
    buildTraffic([street({ t: 9000, f: 6000, b: 3000 })], [], ctx)
  );
  expect(mesh).not.toBeNull();
  const geo = mesh?.geometry;
  for (const name of [
    "trafficAcross",
    "trafficAlong",
    "trafficLoad",
    "trafficHeavy",
    "trafficFlow",
  ]) {
    expect(geo?.getAttribute(name)).toBeDefined();
  }
  // 51 cross-sections of two vertices per lane, two lanes
  expect(geo?.getAttribute("position").count).toBe(2 * 2 * 51);
  geo?.computeBoundingBox();
  expect(geo?.boundingBox?.min.y).toBeCloseTo(110.15, 4);
  // north and south of the line (world z = −y): the lanes do not overlap
  expect(geo?.boundingBox?.min.z).toBeLessThan(-1);
  expect(geo?.boundingBox?.max.z).toBeGreaterThan(1);
  const material = mesh?.material;
  expect(material?.positionNode).not.toBeNull();
  expect(material?.opacityNode).not.toBeNull();
  expect(mesh?.castShadow).toBe(false);
});

test("the material is one for the whole site", () => {
  const a = bands(buildTraffic([street({ t: 500, f: 500 })], [], ctx));
  const b = bands(buildTraffic([street({ t: 900, b: 900 })], [], ctx));
  expect(a?.material === b?.material).toBe(true);
});

test("off the loaded ground the band breaks rather than drops to zero", () => {
  const mesh = bands(
    buildTraffic(
      [
        street({ t: 500, f: 500 }, [
          [150, 0],
          [260, 0],
        ]),
      ],
      [],
      ctx
    )
  );
  mesh?.geometry.computeBoundingBox();
  expect(mesh?.geometry.boundingBox?.min.y).toBeCloseTo(110.15, 4);
  expect(mesh?.geometry.boundingBox?.max.x).toBeLessThanOrEqual(200);
});
