import { expect, test } from "bun:test";
import {
  COLONY_AXIS_STEPS,
  colonyTexel,
  orchardTrees,
  PARCEL_BASE,
  vineRows,
} from "./cultivated";
import type { CultivatedFeature } from "./features";
import { TREE_ARCHETYPES } from "./tree-inventory";

test("the colony byte decodes to its axis and whether it is a parcel", () => {
  expect(colonyTexel(0)).toBeNull();
  expect(colonyTexel(1)).toEqual({ axis: 0, parcel: false });
  const across = colonyTexel(1 + COLONY_AXIS_STEPS / 2);
  expect(across?.axis).toBeCloseTo(Math.PI / 2, 9);
  expect(across?.parcel).toBe(false);
  expect(colonyTexel(PARCEL_BASE + COLONY_AXIS_STEPS)).toEqual({
    axis: Math.PI,
    parcel: true,
  });
});

const features: CultivatedFeature[] = [
  {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ],
    },
    properties: { k: "orchard" },
  },
  {
    geometry: { type: "Point", coordinates: [4, 5] },
    properties: { k: "tree", h: 5, d: 3.5, src: "grid" },
  },
  {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [20, 0],
      ],
    },
    properties: { k: "row" },
  },
  { geometry: null, properties: null },
];

test("orchard trees become small deciduous cadastre trees", () => {
  const trees = orchardTrees(features);
  expect(trees).toHaveLength(1);
  expect(trees[0].geometry.coordinates).toEqual([4, 5]);
  expect(trees[0].properties).toEqual({
    a: TREE_ARCHETYPES.indexOf("small"),
    h: 5,
    d: 3.5,
    l: "d",
  });
});

test("vine rows are the row lines only", () => {
  expect(vineRows(features)).toEqual([
    [
      [0, 0],
      [20, 0],
    ],
  ]);
});
