import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLONY_AXIS_STEPS,
  COLONY_EDGE_SCALE,
  COLONY_GARDEN,
  colonyCropUv,
  orchardTrees,
  vineRows,
} from "./cultivated";
import type { CultivatedFeature } from "./features";
import { TREE_ARCHETYPES } from "./tree-inventory";
import { TREE_GENERA } from "./tree-season";

test("the colony bytes' scales are the bake's", () => {
  // the shader decodes the bytes with these constants
  // (cultivated-layer.ts); the bake writes them (cultivated.py)
  const python = readFileSync(
    join(import.meta.dir, "../../pipeline/bake/cultivated.py"),
    "utf8"
  );
  expect(Number(python.match(/^EDGE_SCALE = ([\d.]+)$/mu)?.[1])).toBe(
    COLONY_EDGE_SCALE
  );
  const axis = python.match(/def axis_code[^]*?\* (\d+)\)\) % (\d+)/u);
  expect(Number(axis?.[1])).toBe(COLONY_AXIS_STEPS);
  expect(Number(axis?.[2])).toBe(COLONY_AXIS_STEPS + 1);
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

test("orchard trees become small deciduous cadastre trees, marked as orchard trees", () => {
  const trees = orchardTrees(features);
  expect(trees).toHaveLength(1);
  expect(trees[0].geometry.coordinates).toEqual([4, 5]);
  expect(trees[0].properties).toEqual({
    a: TREE_ARCHETYPES.indexOf("small"),
    h: 5,
    d: 3.5,
    l: "d",
    s: "orchard",
  });
});

test("an orchard tree takes its orchard's genus; a Christmas tree is a cone", () => {
  const at = (properties: NonNullable<CultivatedFeature["properties"]>) => ({
    geometry: {
      type: "Point" as const,
      coordinates: [1, 2] as [number, number],
    },
    properties,
  });
  const [apple, fir, unknown] = orchardTrees([
    at({ k: "tree", h: 6.2, d: 5.3, src: "dom", g: "Malus" }),
    at({ k: "tree", h: 3.1, d: 2.6, src: "dom", l: "e" }),
    at({ k: "tree", h: 4.5, d: 4, src: "grid", g: "Olea" }),
  ]);
  expect(apple.properties).toEqual({
    a: TREE_ARCHETYPES.indexOf("small"),
    h: 6.2,
    d: 5.3,
    l: "d",
    s: "orchard",
    m: 1,
    gn: TREE_GENERA.indexOf("Malus"),
  });
  expect(unknown.properties?.m).toBeUndefined();
  expect(fir.properties?.a).toBe(TREE_ARCHETYPES.indexOf("conifer"));
  expect(fir.properties?.l).toBe("e");
  expect(fir.properties?.gn).toBeUndefined();
  // a genus the season table does not know draws as the generic tree
  expect(unknown.properties?.gn).toBeUndefined();
});

test("a plot stays within a Kleingarten's 400 m² (BKleingG)", () => {
  expect(
    COLONY_GARDEN.plotAlong * COLONY_GARDEN.plotAcross
  ).toBeLessThanOrEqual(400);
});

test("vine rows are the row lines only", () => {
  expect(vineRows(features)).toEqual([
    [
      [0, 0],
      [20, 0],
    ],
  ]);
});
