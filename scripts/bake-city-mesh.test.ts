import { expect, test } from "bun:test";
import type { CityJsonDocument } from "../lib/city/types";
import { bakeCityMesh } from "./bake-city-mesh";

/** A box as a CityJSON LoD2 solid over the eight vertices from `first`. */
function box(first: number) {
  const [a, b, c, d] = [first, first + 1, first + 2, first + 3];
  const [e, f, g, k] = [first + 4, first + 5, first + 6, first + 7];
  return {
    type: "Solid",
    lod: "2",
    boundaries: [
      [
        [[a, d, c, b]],
        [[e, f, g, k]],
        [[a, b, f, e]],
        [[b, c, g, f]],
        [[c, d, k, g]],
        [[d, a, e, k]],
      ],
    ],
    semantics: {
      surfaces: [
        { type: "GroundSurface" },
        { type: "RoofSurface" },
        { type: "WallSurface" },
      ],
      values: [[0, 1, 2, 2, 2, 2]],
    },
  };
}

/** The eight corners of a 10 × 10 m box of height `h` at (x0, y0). */
function boxVertices(x0: number, y0: number, h: number) {
  const ring: [number, number][] = [
    [x0, y0],
    [x0 + 10, y0],
    [x0 + 10, y0 + 10],
    [x0, y0 + 10],
  ];
  return [
    ...ring.map(([x, y]): [number, number, number] => [x, y, 0]),
    ...ring.map(([x, y]): [number, number, number] => [x, y, h]),
  ];
}

/**
 * Three objects: a shop Building without geometry and its BuildingPart
 * (the Saxon LoD2 pattern), and a housing Building with its own solid.
 */
function fixture(): CityJsonDocument {
  const partSolid = box(0);
  const houseSolid = box(8);
  return {
    type: "CityJSON",
    version: "2.0",
    metadata: {
      referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/25833",
    },
    transform: { scale: [1, 1, 1], translate: [412_000, 5_656_000, 100] },
    vertices: [...boxVertices(0, 0, 9), ...boxVertices(40, 0, 12)],
    CityObjects: {
      shop: {
        type: "Building",
        attributes: { function: "31001_2000", roofType: "3100" },
        children: ["shop-part"],
      },
      "shop-part": {
        type: "BuildingPart",
        attributes: { measuredHeight: 9, roofType: "1000" },
        parents: ["shop"],
        geometry: [partSolid],
      },
      house: {
        type: "Building",
        attributes: { function: "31001_1000", measuredHeight: 12 },
        geometry: [houseSolid],
      },
    },
  };
}

test("a BuildingPart inherits its Building's function: glow and tint", () => {
  const baked = bakeCityMesh("t", fixture(), undefined, null);
  const [shop, part, house] = baked.objects;
  expect(part.root).toBe(0);
  expect(house.root).toBe(2);
  // The part carries no function itself; the shop's commerce use reaches it.
  expect(part.glow).toBe(1);
  expect(shop.glow).toBe(1);
  expect(house.glow).toBe(0);
  // Heights stay the part's own: 9 m of box, not the building's.
  expect(part.eaveH).toBeCloseTo(9, 2);
  expect(house.eaveH).toBeCloseTo(12, 2);
});
