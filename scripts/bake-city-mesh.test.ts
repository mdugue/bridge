import { expect, test } from "bun:test";
import type { CityJsonDocument } from "../lib/city/types";
import { SMALL_BUILDING_SINK } from "../lib/city/small-buildings";
import { bakeCityMesh, scanStructureId } from "./bake-city-mesh";
import { cityMesh } from "./bake-tiles";

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
  // Without an OSM LUT nothing is flagged.
  expect(baked.objects.map((o) => o.flags)).toEqual([0, 0, 0]);
});

test("the OSM LUT flags objects by id: shop 1, heritage 2", () => {
  const baked = bakeCityMesh("t", fixture(), undefined, null, {
    "shop-part": { shop: 1 },
    house: { heritage: 1, shop: 1 },
  });
  expect(baked.objects.map((o) => o.flags)).toEqual([0, 1, 3]);
  // ...and the glTF property table carries them as a UINT8 column.
  const flags = cityMesh(baked).input.table?.properties.flags;
  expect(flags?.componentType).toBe("UINT8");
  expect([...(flags?.values ?? [])]).toEqual([0, 1, 3]);
});

test("a part carries its root Building's flags as well as its own", () => {
  // osm_buildings.py marks the root of a part it finds: a listing on the
  // Building reaches the part that draws it; the part's own shop stays.
  const baked = bakeCityMesh("t", fixture(), undefined, null, {
    shop: { heritage: 1 },
    "shop-part": { shop: 1 },
  });
  expect(baked.objects.map((o) => o.flags)).toEqual([2, 3, 0]);
  // A flag on the root alone still reaches the part.
  const rootOnly = bakeCityMesh("t", fixture(), undefined, null, {
    shop: { shop: 1 },
  });
  expect(rootOnly.objects.map((o) => o.flags)).toEqual([1, 1, 0]);
});

test("the scan's small structures join as their own buildings, source 1", () => {
  const baked = bakeCityMesh("t", fixture(), undefined, null, undefined, [
    {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [412_020, 5_656_020],
            [412_024, 5_656_020],
            [412_024, 5_656_023],
            [412_020, 5_656_023],
            [412_020, 5_656_020],
          ],
        ],
      },
      properties: { h: 2.5, z: 100 },
    },
  ]);
  expect(baked.objects.length).toBe(4);
  const shed = baked.objects[3];
  expect(shed.root).toBe(3);
  expect(shed.building).toBe(true);
  expect(shed.source).toBe(1);
  expect(shed.eaveH).toBeCloseTo(2.7, 2);
  // no storey band on a shed: the first would stand above its eave
  expect(shed.storeyH).toBeGreaterThan(shed.eaveH);
  expect(shed.flags).toBe(0);
  expect(shed.glow).toBe(0);
  expect(shed.footprints[0].length).toBe(4);
  // the box stands where the ring says, recentred on the spawn tile's offset
  const shedXs: number[] = [];
  const shedYs: number[] = [];
  const shedZs: number[] = [];
  const p = baked.vertices.positions;
  baked.vertices.objectIds.forEach((id, v) => {
    if (id === 3) {
      shedXs.push(p[3 * v]);
      shedYs.push(p[3 * v + 1]);
      shedZs.push(p[3 * v + 2]);
    }
  });
  const { cx, cy } = baked.offset;
  expect(Math.min(...shedXs)).toBeCloseTo(412_020 - cx, 3);
  expect(Math.max(...shedXs)).toBeCloseTo(412_024 - cx, 3);
  expect(Math.min(...shedYs)).toBeCloseTo(5_656_020 - cy, 3);
  expect(Math.max(...shedYs)).toBeCloseTo(5_656_023 - cy, 3);
  expect(Math.min(...shedZs)).toBeCloseTo(100 - SMALL_BUILDING_SINK, 3);
  expect(Math.max(...shedZs)).toBeCloseTo(102.5, 3);
  // 12 triangles tagged with the new id, appended after the LoD2 stream.
  const ids = [...baked.vertices.objectIds];
  expect(ids.filter((i) => i === 3).length).toBe(36);
  expect(ids.slice(-36).every((i) => i === 3)).toBe(true);
  const table = cityMesh(baked).input.table?.properties;
  expect([...(table?.source.values ?? [])]).toEqual([0, 0, 0, 1]);
  expect([...(table?.root.values ?? [])]).toEqual([0, 0, 2, 3]);
});

test("a scan structure's tint key is its first corner, not its index", () => {
  const shed = (x: number) => ({
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [x, 5_656_020],
          [x + 4, 5_656_020],
          [x + 4, 5_656_023],
          [x, 5_656_023],
          [x, 5_656_020],
        ] as [number, number][],
      ],
    },
    properties: { h: 2.5, z: 100 },
  });
  expect(scanStructureId("t", shed(412_020.04))).toBe(
    "scan:t:412020.0:5656020.0"
  );
  expect(scanStructureId("t", shed(412_020.04))).toBe(
    scanStructureId("t", shed(412_020.01))
  );
  expect(scanStructureId("t", shed(412_030))).not.toBe(
    scanStructureId("t", shed(412_020))
  );
});
