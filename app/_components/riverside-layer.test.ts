import { expect, test } from "bun:test";
import type { InstancedMesh, Mesh } from "three";
import type { RiversideFeature } from "@/lib/city/features";
import { buildRiverside, type RiversideContext } from "./riverside-layer";

/** A bank at 108 m north of y = 0, the flat river at 104 m south of it. */
const ctx: RiversideContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: (_x, y) => (y >= 0 ? 108 : 104),
};

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ] as [number, number][],
];

const byName = (group: ReturnType<typeof buildRiverside>, name: string) =>
  group.children.filter((c) => c.name === name) as Mesh[];

const topY = (mesh: Mesh): number => {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox?.max.y ?? Number.NaN;
};

test("nothing on the river, an empty group", () => {
  const group = buildRiverside([], ctx);
  expect(group.name).toBe("riverside");
  expect(group.children).toHaveLength(0);
});

test("a pier stands its deck on piles over the water, not on the bank", () => {
  const pier: RiversideFeature = {
    geometry: { type: "Polygon", coordinates: rect(0, -20, 3, 2) },
    properties: { k: "pier", deck: 108.4 },
  };
  const group = buildRiverside([pier], ctx);
  const [deck] = byName(group, "riverside-pier");
  expect(topY(deck)).toBeCloseTo(108.4, 4);
  const [piles] = byName(group, "riverside-piles") as InstancedMesh[];
  expect(piles.count).toBeGreaterThan(4);
  expect(byName(group, "riverside-railing")).toHaveLength(1);
});

test("a pontoon floats on the drawn water, with a hut and a gangway", () => {
  const pontoon: RiversideFeature = {
    geometry: { type: "Polygon", coordinates: rect(0, -30, 4, -10) },
    properties: { k: "pontoon", len: 20, bank: [2, 1] },
  };
  const group = buildRiverside([pontoon], ctx);
  const [hull, deck] = byName(group, "riverside-pontoon");
  expect(topY(hull)).toBeCloseTo(104.35, 4);
  expect(topY(deck)).toBeCloseTo(104.5, 4);
  expect(byName(group, "riverside-hut")).toHaveLength(2); // walls + roof
  expect(byName(group, "riverside-gangway")).toHaveLength(1);
});

test("a ferry line is a faint wake that never casts; a groyne a stone ridge", () => {
  const ferry: RiversideFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, -50],
        [100, -60],
      ],
    },
    properties: { k: "ferry", name: "Johannstadt Fähre" },
  };
  const groyne: RiversideFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 5],
        [0, -40],
      ],
    },
    properties: { k: "groyne" },
  };
  const group = buildRiverside([ferry, groyne], ctx);
  const [wake] = byName(group, "riverside-ferry");
  expect(wake.castShadow).toBe(false);
  expect(topY(wake)).toBeCloseTo(104.06, 4);
  const [ridge] = byName(group, "riverside-groyne");
  expect(topY(ridge)).toBeCloseTo(108.5, 4);
});
