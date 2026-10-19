import { expect, test } from "bun:test";
import type { CanopyFeature } from "./features";
import { lod2Roofs, treesOffRoofs } from "./roof-trees";
import type { CityJsonDocument } from "./types";

const point = (x: number, y: number, h: number): CanopyFeature => ({
  geometry: { coordinates: [x, y], type: "Point" },
  properties: { h },
});

/** A 20 m square hall, 15.5 m high, with its ground at 100 m. */
const hall: CityJsonDocument = {
  CityObjects: {
    hall: {
      geometry: [
        {
          boundaries: [[[0, 1, 2, 3]], [[4, 5, 6, 7]]],
          semantics: {
            surfaces: [{ type: "GroundSurface" }, { type: "RoofSurface" }],
            values: [0, 1],
          },
          type: "MultiSurface",
        },
      ],
      type: "Building",
    },
  },
  type: "CityJSON",
  version: "2.0",
  vertices: [
    [0, 0, 100],
    [20, 0, 100],
    [20, 20, 100],
    [0, 20, 100],
    [0, 0, 115.5],
    [20, 0, 115.5],
    [20, 20, 115.5],
    [0, 20, 115.5],
  ],
};

test("lod2Roofs: a building's footprint and its height", () => {
  const [roof] = lod2Roofs(hall);
  expect(roof.height).toBeCloseTo(15.5);
  expect(roof.ring.length).toBeGreaterThanOrEqual(4);
});

test("treesOffRoofs: a tree in a courtyard stays", () => {
  const block: CityJsonDocument = {
    ...hall,
    CityObjects: {
      block: {
        geometry: [
          {
            boundaries: [
              [
                [0, 1, 2, 3],
                [8, 9, 10, 11],
              ],
              [[4, 5, 6, 7]],
            ],
            semantics: {
              surfaces: [{ type: "GroundSurface" }, { type: "RoofSurface" }],
              values: [0, 1],
            },
            type: "MultiSurface",
          },
        ],
        type: "Building",
      },
    },
    // a 10 m courtyard in the middle of the hall
    vertices: [
      ...hall.vertices,
      [5, 5, 100],
      [15, 5, 100],
      [15, 15, 100],
      [5, 15, 100],
    ],
  };
  const kept = treesOffRoofs(
    [point(10, 10, 12), point(2.5, 2.5, 15)],
    lod2Roofs(block)
  );
  expect(kept.map((t) => t.properties?.h)).toEqual([12]);
});

test("treesOffRoofs: a roof's own height goes, a tree over it or beside it stays", () => {
  const trees = [
    point(10, 10, 15.4), // the roof itself
    point(5, 5, 14), // lower than the roof: still the roof
    point(10, 10, 24), // a tree over the hall, 8.5 m above it
    point(0.5, 10, 12), // within 1 m of the wall: a crown beside it
    point(40, 40, 12), // in the open
  ];
  const kept = treesOffRoofs(trees, lod2Roofs(hall));
  expect(kept.map((t) => t.properties?.h)).toEqual([24, 12, 12]);
});
