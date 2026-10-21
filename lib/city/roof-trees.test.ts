import { expect, test } from "bun:test";
import type { CanopyFeature, StructureFeature } from "./features";
import { gapRoofs, lod2Roofs, treesOffRoofs } from "./roof-trees";
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

test("lod2Roofs: a bridge's slab is no roof", () => {
  const bridge: CityJsonDocument = {
    ...hall,
    CityObjects: {
      deck: {
        ...hall.CityObjects.hall,
        attributes: { function: "53001_1800" },
      },
    },
  };
  expect(lod2Roofs(bridge)).toEqual([]);
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

test("gapRoofs: a building LoD2 lacks is a roof; one newer than the flight keeps no crown", () => {
  const square = (x0: number): StructureFeature["geometry"] => ({
    type: "Polygon",
    coordinates: [
      [
        [x0, 0],
        [x0 + 20, 0],
        [x0 + 20, 20],
        [x0, 20],
        [x0, 0],
      ],
    ],
  });
  const gaps: StructureFeature[] = [
    { geometry: square(0), properties: { h: 12, kind: "building", z: 100 } },
    // built since the flight: its lot's old crowns
    {
      geometry: square(100),
      properties: { h: 16, kind: "building", src: "osm", z: 100 },
    },
    { geometry: square(200), properties: { h: 5.8, kind: "roof", z: 100 } },
    // a column is no footprint
    {
      geometry: { type: "Point", coordinates: [300, 10] },
      properties: { h: 40, kind: "chimney", z: 100 },
    },
  ];
  const roofs = gapRoofs(gaps);
  expect(roofs).toHaveLength(3);
  const kept = treesOffRoofs(
    [
      point(10, 10, 12), // the measured building's roof
      point(10, 10, 20), // a tree over it
      point(110, 10, 25), // a crown on the lot before it was built
      point(210, 10, 6), // a platform roof read as a crown
      point(310, 10, 9), // beside the chimney
    ],
    roofs
  );
  expect(kept.map((t) => t.geometry.coordinates[0])).toEqual([10, 310]);
});
