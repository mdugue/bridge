import { expect, test } from "bun:test";
import { type Mesh, type MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import type { TrafficFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { flowHeight } from "@/lib/city/traffic";
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

const bodies = (group: ReturnType<typeof buildTraffic>) =>
  group.children[0] as Mesh<Mesh["geometry"], MeshBasicNodeMaterial> | null;

test("no counted road, an empty group", () => {
  const group = buildTraffic([], [], ctx);
  expect(group.name).toBe("traffic");
  expect(group.children).toHaveLength(0);
});

test("a two-way street is two glass bodies on the ground, apart, as tall as their traffic", () => {
  const mesh = bodies(
    buildTraffic([street({ t: 9000, f: 6000, b: 3000 })], [], ctx)
  );
  expect(mesh).not.toBeNull();
  const geo = mesh?.geometry;
  for (const name of [
    "normal",
    "trafficAcross",
    "trafficAlong",
    "trafficRise",
    "trafficLoad",
    "trafficHeavy",
    "trafficFlow",
  ]) {
    expect(geo?.getAttribute(name)).toBeDefined();
  }
  // 51 cross-sections of 11 profile points, two lanes
  expect(geo?.getAttribute("position").count).toBe(2 * 51 * 11);
  geo?.computeBoundingBox();
  // feet 0.2 m under the ground, the busier lane's crown at its height
  expect(geo?.boundingBox?.min.y).toBeCloseTo(109.8, 4);
  expect(geo?.boundingBox?.max.y).toBeCloseTo(109.8 + flowHeight(6000), 3);
  // north and south of the line (world z = −y): the lanes do not overlap
  expect(geo?.boundingBox?.min.z).toBeLessThan(-1);
  expect(geo?.boundingBox?.max.z).toBeGreaterThan(1);
  const material = mesh?.material;
  expect(material?.positionNode).not.toBeNull();
  expect(material?.colorNode).not.toBeNull();
  expect(material?.transparent).toBe(true);
  expect(mesh?.castShadow).toBe(false);
});

test("the outside faces out: the crown's normals point up", () => {
  const mesh = bodies(buildTraffic([street({ t: 3000, f: 3000 })], [], ctx));
  const geo = mesh?.geometry;
  const rise = geo?.getAttribute("trafficRise");
  const normal = geo?.getAttribute("normal");
  const n = new Vector3();
  let crowns = 0;
  for (let i = 0; i < (rise?.count ?? 0); i++) {
    if ((rise?.getX(i) ?? 0) === 1) {
      n.fromBufferAttribute(normal as never, i);
      expect(n.y).toBeGreaterThan(0.5);
      crowns++;
    }
  }
  expect(crowns).toBeGreaterThan(10);
});

test("a body tapers to a point at both ends of its section", () => {
  const mesh = bodies(buildTraffic([street({ t: 3000, f: 3000 })], [], ctx));
  const pos = mesh?.geometry.getAttribute("position");
  // the first cross-section has collapsed onto the line, at its foot
  for (let k = 0; k < 11; k++) {
    expect(pos?.getY(k)).toBeCloseTo(109.8, 4);
    expect(pos?.getZ(k)).toBeCloseTo(0, 4);
  }
});

test("the material is one for the whole site", () => {
  const a = bodies(buildTraffic([street({ t: 500, f: 500 })], [], ctx));
  const b = bodies(buildTraffic([street({ t: 900, b: 900 })], [], ctx));
  expect(a?.material === b?.material).toBe(true);
});

test("off the loaded ground the body breaks rather than drops to zero", () => {
  const mesh = bodies(
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
  expect(mesh?.geometry.boundingBox?.min.y).toBeCloseTo(109.8, 4);
  expect(mesh?.geometry.boundingBox?.max.x).toBeLessThanOrEqual(200.5);
});
