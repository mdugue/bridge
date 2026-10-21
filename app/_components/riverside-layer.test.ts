import { expect, test } from "bun:test";
import type {
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import type { RiversideFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import type { Instances } from "./instancing";
import { buildRiverside } from "./riverside-layer";

/** A bank at 108 m north of y = 0, the flat river at 104 m south of it. */
const ctx: GroundContext = {
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
  const [piles] = byName(
    group,
    "riverside-piles"
  ) as unknown as Instances<MeshStandardNodeMaterial>[];
  expect(piles.isInstances).toBe(true);
  expect(piles.drawCount).toBeGreaterThan(4);
  expect(piles.material.positionNode).not.toBeNull();
  expect(byName(group, "riverside-railing")).toHaveLength(1);
});

test("a pontoon floats on the drawn water, with a hut and a gangway", () => {
  const pontoon: RiversideFeature = {
    geometry: { type: "Polygon", coordinates: rect(0, -30, 4, -10) },
    properties: { k: "pontoon", len: 20, bank: [2, 1] },
  };
  const group = buildRiverside([pontoon], ctx);
  const [hull, deck] = byName(group, "riverside-pontoon");
  // no measured freeboard: the bake's fallback, 0.9 m
  expect(topY(hull)).toBeCloseTo(104.75, 4);
  expect(topY(deck)).toBeCloseTo(104.9, 4);
  expect(byName(group, "riverside-hut")).toHaveLength(2); // walls + roof
  expect(byName(group, "riverside-gangway")).toHaveLength(1);
});

test("a pontoon stands its measured freeboard over the water, its hull under it", () => {
  const pontoon: RiversideFeature = {
    geometry: { type: "Polygon", coordinates: rect(0, -30, 4, -10) },
    properties: { k: "pontoon", len: 20, fb: 1.3 },
  };
  const [hull, deck] = byName(
    buildRiverside([pontoon], ctx),
    "riverside-pontoon"
  );
  expect(topY(deck)).toBeCloseTo(105.3, 4);
  expect(topY(hull)).toBeCloseTo(105.15, 4);
  hull.geometry.computeBoundingBox();
  expect(hull.geometry.boundingBox?.min.y).toBeCloseTo(103.7, 4); // its draft
});

test("a finger pier floats with its pontoon: no hut, no gangway", () => {
  const finger: RiversideFeature = {
    geometry: { type: "Polygon", coordinates: rect(4, -22, 20, -20) },
    properties: { k: "pontoon", len: 16, fb: 0.7, finger: 1, bank: [12, 1] },
  };
  const group = buildRiverside([finger], ctx);
  const [, deck] = byName(group, "riverside-pontoon");
  expect(topY(deck)).toBeCloseTo(104.7, 4);
  expect(byName(group, "riverside-hut")).toHaveLength(0);
  expect(byName(group, "riverside-gangway")).toHaveLength(0);
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
  const ink = wake.material as MeshBasicNodeMaterial;
  expect(ink.isNodeMaterial).toBe(true);
  expect(ink.userData.shared).toBe(true);
  expect(ink.transparent).toBe(true);
  expect(ink.depthWrite).toBe(false);
  expect(ink.opacityNode).not.toBeNull();
  expect(wake.geometry.hasAttribute("wakeAlong")).toBe(true);
  expect(topY(wake)).toBeCloseTo(104.06, 4);
  const [ridge] = byName(group, "riverside-groyne");
  expect(topY(ridge)).toBeCloseTo(108.12, 4); // its crest on the DGM
});

test("a groyne's flanks run down under the water beside it", () => {
  const groyne: RiversideFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, -2],
        [0, -40],
      ],
    },
    properties: { k: "groyne", w: 103.6 },
  };
  // the stones stand 0.8 m over the river in the DGM
  const stones: GroundContext = {
    ...ctx,
    heightAt: (x, y) => (Math.abs(x) < 0.5 ? 104.8 : ctx.heightAt(x, y)),
  };
  const [ridge] = byName(buildRiverside([groyne], stones), "riverside-groyne");
  ridge.geometry.computeBoundingBox();
  expect(ridge.geometry.boundingBox?.max.y).toBeCloseTo(104.92, 4);
  expect(ridge.geometry.boundingBox?.min.y).toBeCloseTo(103.3, 4);
});

test("a ferry line past the loaded ground keeps no vertex at sea level", () => {
  const ferry: RiversideFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, -50],
        [200, -50],
      ],
    },
    properties: { k: "ferry" },
  };
  // No terrain east of x = 100: those samples have no ground.
  const partial: GroundContext = {
    ...ctx,
    heightAt: (x, y) => (x > 100 ? null : ctx.heightAt(x, y)),
  };
  const [wake] = byName(buildRiverside([ferry], partial), "riverside-ferry");
  wake.geometry.computeBoundingBox();
  expect(wake.geometry.boundingBox?.min.y).toBeCloseTo(104.06, 4);
});
