import { expect, test } from "bun:test";
import {
  COLONY_AXIS_STEPS,
  colonyAxis,
  colonyCropUv,
  colonyEdgeMetres,
  orchardTrees,
  vineRows,
} from "./cultivated";
import type { CultivatedFeature } from "./features";
import { TREE_ARCHETYPES } from "./tree-inventory";

test("the colony bytes decode to the edge distance and the axis", () => {
  expect(colonyEdgeMetres(0)).toBeNull();
  expect(colonyEdgeMetres(128)).toBe(0);
  expect(colonyEdgeMetres(178)).toBe(2.5);
  expect(colonyEdgeMetres(98)).toBe(-1.5);
  expect(colonyAxis(0)).toBeNull();
  expect(colonyAxis(1)).toBe(0);
  expect(colonyAxis(1 + COLONY_AXIS_STEPS / 2)).toBeCloseTo(Math.PI / 2, 9);
});

test("a cropped colony raster maps to its part of the tile", () => {
  expect(colonyCropUv()).toEqual([0, 0, 1, 1]);
  expect(colonyCropUv([512, 1024, 256, 128, 2048])).toEqual([
    0.25, 0.5, 0.125, 0.0625,
  ]);
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
