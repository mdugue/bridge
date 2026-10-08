import { expect, test } from "bun:test";
import type { CityJsonDocument } from "../lib/city/types";
import {
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_GROUNDED,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_SHOPFRONT,
} from "../lib/city/city-mesh";
import type {
  DormerFeature,
  ShopfrontWall,
  StructureFeature,
} from "../lib/city/features";
import { SMALL_BUILDING_SINK } from "../lib/city/small-buildings";
import { bakeCityMesh, PANE_ROUGH, scanStructureId } from "./bake-city-mesh";
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
  // Without an OSM LUT only what stands on the ground is flagged (the shop
  // Building is drawn by its part; the fixture's boxes have flat roofs).
  expect(baked.objects.map((o) => o.flags)).toEqual([
    0,
    OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
    OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
  ]);
});

test("the OSM LUT flags objects by id: shop 1, heritage 2", () => {
  const baked = bakeCityMesh("t", fixture(), undefined, null, {
    "shop-part": { shop: 1 },
    house: { heritage: 1, shop: 1 },
  });
  expect(baked.objects.map((o) => o.flags)).toEqual([
    0,
    1 + OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
    3 + OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
  ]);
  // ...and the glTF property table carries them as a UINT16 column.
  const flags = cityMesh(baked).input.table?.properties.flags;
  expect(flags).toMatchObject({ type: "SCALAR", componentType: "UINT16" });
  expect([...(flags?.values ?? [])]).toEqual([
    0,
    1 + OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
    3 + OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
  ]);
});

test("every object carries its identity and semantics as fact columns", () => {
  const fx = fixture();
  fx.CityObjects.house.attributes = {
    ...fx.CityObjects.house.attributes,
    creationDate: "2025-07-04T00:00:00Z",
    Dachneigung: 0,
    roofType: "1000",
  };
  const baked = bakeCityMesh("t", fx, undefined, null, {
    shop: { name: "Kaufhaus", addr: "Prager Straße 1", levels: 4 },
    house: { addr: "Hauptstraße 5" },
  });
  const [shop, part, house] = baked.objects.map((o) => o.facts);
  // The part answers with its Building's id, use and OSM facts, and its
  // own measured height and roof.
  expect(part).toMatchObject({
    buildingId: "shop",
    function: "31001_2000",
    roofType: "1000",
    name: "Kaufhaus",
    addr: "Prager Straße 1",
    levels: 4,
    height: 9,
    area: 100,
  });
  // Footprints are read before the loader rewrites the document: a Solid
  // part keeps its GroundSurface (the minimap once lost every part's).
  expect(baked.objects[1].footprints).toHaveLength(1);
  expect(baked.objects[2].footprints).toHaveLength(1);
  // The geometry-less Building answers for its tree (its one part):
  // the part's ground, base to top.
  expect(shop).toMatchObject({ buildingId: "shop", height: 9, area: 100 });
  // A flat roof's pitch 0 is a value, not "unknown"; dates lose the clock.
  expect(house).toMatchObject({
    buildingId: "house",
    function: "31001_1000",
    created: "2025-07-04",
    roofPitch: 0,
    height: 12,
    addr: "Hauptstraße 5",
    name: "",
    levels: -1,
  });
  const table = cityMesh(baked).input.table?.properties;
  // A part answers with its Building's id: the key other datasets know.
  expect(table?.buildingId).toEqual({
    type: "STRING",
    values: ["shop", "shop", "house"],
  });
  expect(table?.function).toEqual({
    type: "ENUM",
    values: ["31001_2000", "31001_2000", "31001_1000"],
  });
  expect(table?.height).toMatchObject({ componentType: "FLOAT32", noData: -1 });
  expect([...(table?.height.values ?? [])]).toEqual([9, 9, 12]);
});

test("a part carries its root Building's flags as well as its own", () => {
  // osm_buildings.py marks the root of a part it finds: a listing on the
  // Building reaches the part that draws it; the part's own shop stays.
  const baked = bakeCityMesh("t", fixture(), undefined, null, {
    shop: { heritage: 1 },
    "shop-part": { shop: 1 },
  });
  expect(baked.objects.map((o) => o.flags)).toEqual([
    2,
    3 + OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
    OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
  ]);
  // A flag on the root alone still reaches the part.
  const rootOnly = bakeCityMesh("t", fixture(), undefined, null, {
    shop: { shop: 1 },
  });
  expect(rootOnly.objects.map((o) => o.flags)).toEqual([
    1,
    1 + OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
    OBJECT_FLAG_GROUNDED + OBJECT_FLAG_FLAT_ROOF,
  ]);
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
  expect(shed.flags).toBe(OBJECT_FLAG_GROUNDED);
  expect(shed.glow).toBe(0);
  expect(shed.footprints[0].length).toBe(4);
  expect(shed.facts).toMatchObject({ height: 2.5, area: 12, function: "" });
  expect(shed.facts?.buildingId).toMatch(/^scan:t:/);
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

test("gap structures: a chimney is its own object, a relief slab joins its landmark", () => {
  const gaps: StructureFeature[] = [
    {
      geometry: { type: "Point", coordinates: [412_030, 5_656_030] },
      properties: { h: 40, kind: "chimney", r: 2, rt: 1.2, z: 100 },
    },
    {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [412_042, 5_656_002],
            [412_048, 5_656_002],
            [412_048, 5_656_008],
            [412_042, 5_656_008],
            [412_042, 5_656_002],
          ],
        ],
      },
      properties: {
        h: 2,
        kind: "relief",
        of: "house",
        z: 112,
        grid: {
          x: 412_042,
          y: 5_656_008,
          res: 1,
          cols: 2,
          rows: 2,
          z: [2, 2, 2, 2],
        },
      },
    },
    // a slab whose host is not in this tile is dropped
    {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [412_000, 5_656_000],
            [412_002, 5_656_000],
            [412_002, 5_656_002],
            [412_000, 5_656_000],
          ],
        ],
      },
      properties: { h: 2, kind: "relief", of: "elsewhere", z: 112 },
    },
  ];
  const baked = bakeCityMesh(
    "t",
    fixture(),
    undefined,
    null,
    undefined,
    undefined,
    "render",
    gaps
  );
  expect(baked.objects.length).toBe(5);
  const [chimney, slab] = baked.objects.slice(3);
  expect(chimney.root).toBe(3);
  expect(chimney.building).toBe(false);
  expect(chimney.source).toBe(OBJECT_SOURCE_GAP);
  const house = baked.objects[2];
  expect(slab.root).toBe(house.root);
  expect(slab.tint).toEqual(house.tint);
  expect(slab.roof).toEqual(house.roof);
  expect(slab.building).toBe(false);
  expect(slab.footprints).toEqual([]);
  expect(slab.source).toBe(OBJECT_SOURCE_GAP);
});

test("a measured roof replaces its object's LoD2 triangles, same row", () => {
  const part = (x0: number, z: number) => ({
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [412_040 + x0, 5_656_000],
          [412_045 + x0, 5_656_000],
          [412_045 + x0, 5_656_010],
          [412_040 + x0, 5_656_010],
          [412_040 + x0, 5_656_000],
        ] as [number, number][],
      ],
    },
    properties: { id: "house", z },
  });
  const lod2 = bakeCityMesh("t", fixture(), undefined, null);
  const baked = bakeCityMesh(
    "t",
    fixture(),
    undefined,
    null,
    undefined,
    undefined,
    "render",
    undefined,
    // two steps over the house's 10 × 10 m: 4 m and 7 m above its base
    [part(0, 104), part(5, 107)]
  );
  const v = baked.vertices;
  const zOf = (id: number) =>
    [...v.objectIds.keys()]
      .filter((i) => v.objectIds[i] === id)
      .map((i) => v.positions[i * 3 + 2]);
  // the shop's part keeps its LoD2 triangles, the house is the two blocks
  expect(zOf(1)).toEqual(
    [...lod2.vertices.objectIds.keys()]
      .filter((i) => lod2.vertices.objectIds[i] === 1)
      .map((i) => lod2.vertices.positions[i * 3 + 2])
  );
  const house = zOf(2);
  // the house's LoD2 base (the CityJSON's 100 m), up to each step
  expect(Math.min(...house)).toBeCloseTo(100, 5);
  expect(new Set(house.map((z) => Math.round(z)))).toEqual(
    new Set([100, 104, 107])
  );
  // the row follows the new shape: the eave is the lower block's roof
  expect(baked.objects[2].eaveH).toBeCloseTo(4, 2);
  expect(baked.objects).toHaveLength(lod2.objects.length);
  // flat blocks and the kept LoD2 shade flat: the stream's normals run
  // alongside its positions, all of them NaN
  expect(v.normals).toHaveLength(v.positions.length);
  expect([...(v.normals ?? [])].every(Number.isNaN)).toBe(true);
});

test("dormers join their host as one object, roof-flagged on top, source 4", () => {
  const on = (x: number, of = "house"): DormerFeature => ({
    geometry: { type: "Point", coordinates: [412_000 + x, 5_656_005] },
    properties: { of, ax: 1, ay: 0, w: 2, d: 2, z: 110, top: 111.5, slope: 45 },
  });
  const lod2 = bakeCityMesh("t", fixture(), undefined, null);
  const baked = bakeCityMesh(
    "t",
    fixture(),
    undefined,
    null,
    undefined,
    undefined,
    "render",
    undefined,
    undefined,
    // two on the house, one whose host is elsewhere (dropped)
    { dormers: [on(43), on(47), on(5, "elsewhere")] }
  );
  expect(baked.objects.length).toBe(lod2.objects.length + 1);
  const house = baked.objects[2];
  const dormer = baked.objects.at(-1);
  expect(dormer?.root).toBe(house.root);
  expect(dormer?.tint).toEqual(house.tint);
  expect(dormer?.roof).toEqual(house.roof);
  expect(dormer?.building).toBe(false);
  expect(dormer?.footprints).toEqual([]);
  expect(dormer?.source).toBe(OBJECT_SOURCE_DORMER);
  // high on the roof: no plinth
  expect((dormer?.flags ?? 0) & OBJECT_FLAG_GROUNDED).toBe(0);
  const added = baked.vertices.isRoof.length - lod2.vertices.isRoof.length;
  // per dormer: front 2, cheeks 2, roof 2 triangles
  expect(added).toBe(2 * 6 * 3);
  const roofs = Array.from(baked.vertices.isRoof.slice(-added));
  expect(roofs.filter((r) => r === 1)).toHaveLength(2 * 2 * 3);
});

test("a shopfront joins its host as glass, frame and canopy, source 6", () => {
  // the house's south wall (x 40–50 m, y 0), facing −y
  const front = (oid = "house"): ShopfrontWall => ({
    oid,
    wi: 0,
    a: [412_040, 5_656_000],
    b: [412_050, 5_656_000],
    L: 10,
    n: [0, -1],
    z: [100, 100],
    src: "photo",
    bays: [
      [1, 3],
      [4, 6.5],
    ],
    sign: { at: [[1, 7]], z: [3.3, 3.9] },
  });
  const bake = (walls: ShopfrontWall[], glass = false) =>
    bakeCityMesh(
      "t",
      fixture(),
      undefined,
      null,
      glass ? { house: { material: "glass" } } : undefined,
      undefined,
      "render",
      undefined,
      undefined,
      { shopfronts: walls }
    );
  const lod2 = bakeCityMesh("t", fixture(), undefined, null);
  const baked = bake([front(), front("elsewhere")]);
  expect(baked.objects.length).toBe(lod2.objects.length + 2);
  const house = baked.objects[2];
  const [pane, frame] = baked.objects.slice(-2);
  for (const o of [pane, frame]) {
    expect(o.root).toBe(house.root);
    expect(o.source).toBe(OBJECT_SOURCE_SHOPFRONT);
    expect(o.building).toBe(false);
    expect(o.footprints).toEqual([]);
    expect(o.flags & OBJECT_FLAG_OWN_COLOUR).toBe(OBJECT_FLAG_OWN_COLOUR);
  }
  expect(pane.flags & OBJECT_FLAG_GLASS).toBe(OBJECT_FLAG_GLASS);
  expect(frame.flags & OBJECT_FLAG_GLASS).toBe(0);
  expect(pane.rough).toBe(PANE_ROUGH);
  // dark glass, a frame darker than its wall
  expect(Math.max(...pane.tint)).toBeLessThan(0.1);
  expect(frame.tint[1]).toBeLessThan(house.tint[1]);
  // a glass facade wears its own front
  expect(bake([front()], true).objects.length).toBe(lod2.objects.length);
  // a canopy is a third object, in the host's own clay
  const sheltered = bake([
    { ...front(), canopy: [{ at: [0, 10], d: 3.5, h: 4.2 }] },
  ]);
  expect(sheltered.objects.length).toBe(lod2.objects.length + 3);
  const canopy = sheltered.objects.at(-1);
  expect(canopy?.source).toBe(OBJECT_SOURCE_SHOPFRONT);
  expect(canopy?.tint).toEqual(sheltered.objects[2].tint);
  expect((canopy?.flags ?? 0) & OBJECT_FLAG_GLASS).toBe(0);
  expect((canopy?.flags ?? 0) & OBJECT_FLAG_OWN_COLOUR).toBe(0);
});
