import { decodeDrawn } from "../lib/city/drawn-facts";
import { expect, test } from "bun:test";
import type { CityJsonDocument } from "../lib/city/types";
import {
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_GROUNDED,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_SOURCE_DOOR,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_PASSAGE,
  OBJECT_SOURCE_SHOPFRONT,
  type OsmBuildingLut,
} from "../lib/city/city-mesh";
import type {
  DoorFeature,
  DormerFeature,
  PassageFeature,
  PlinthFeature,
  ShopfrontWall,
  StructureFeature,
} from "../lib/city/features";
import { ensembleGroup } from "../lib/city/ensembles";
import { paneTop, SHOPFRONT_SINK } from "../lib/city/shopfronts";
import { SMALL_BUILDING_SINK } from "../lib/city/small-buildings";
import {
  FACADE_SCALE_M,
  TYPES,
  unpackStyle,
  WINDOW_ROWS,
  type WindowWall,
} from "../lib/city/windows";
import { storeyHeight } from "../lib/city/building-tint";
import {
  appendedRoofColour,
  assignWindows,
  bakeCityMesh,
  carriesCornices,
  cityFrame,
  cityMesh,
  onBuildings,
  shapedGap,
  joinEnsembles,
  liftToStreet,
  scanStructureId,
  vertexNormals,
  withMeasuredRoofs,
  withOpenRoofs,
  withRoofSteps,
} from "./bake-city-mesh";

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

test("every object records how it is drawn and from what, for the card", () => {
  const baked = bakeCityMesh(
    "t",
    fixture(),
    { roofs: { house: [0.2, 0.2, 0.2] } },
    null,
    {
      shop: { material: "glass", levels: 3, wikidata: "Q1" },
      house: { colour: "#c8b89a", roof_colour: "#806040" },
    }
  );
  const [, part, house] = baked.objects.map((o) =>
    decodeDrawn(o.facts?.drawn ?? "")
  );
  // the part takes its Building's OSM look; glass walls carry no windows
  expect(part).toMatchObject({
    wall: "material",
    material: "glass",
    roof: "palette",
    storey: "osm",
    windows: "none",
    noWindows: "facade",
    wikidata: "Q1",
  });
  // the orthophoto's roof colour wins over OSM's
  expect(house).toMatchObject({
    wall: "osm",
    colour: "#c8b89a",
    roof: "dop",
    roofColour: "#806040",
    storey: "height",
  });
  // one ENUM column, read only when someone asks
  expect(cityMesh(baked).input.table?.properties.drawn).toMatchObject({
    type: "ENUM",
  });
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

test("a chimney joins its host with the dormers as a box, all wall", () => {
  const at = (x: number, k?: "chimney"): DormerFeature => ({
    geometry: { type: "Point", coordinates: [412_000 + x, 5_656_005] },
    properties: {
      of: "house",
      ax: 1,
      ay: 0,
      w: k ? 0.6 : 2,
      d: k ? 0.6 : 2,
      z: 110,
      top: 111.5,
      slope: 45,
      ...(k ? { k } : {}),
    },
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
    { dormers: [at(43), at(47, "chimney")] }
  );
  // the host's chimneys one object, its dormers another
  expect(baked.objects.length).toBe(lod2.objects.length + 2);
  const added = baked.vertices.isRoof.length - lod2.vertices.isRoof.length;
  // the dormer's 6 triangles, the chimney's four sides and top
  expect(added).toBe((6 + 5 * 2) * 3);
  const roofs = Array.from(baked.vertices.isRoof.slice(-added));
  expect(roofs.filter((r) => r === 1)).toHaveLength(2 * 3);
  // the dormer's front takes a window, its cheeks and the chimney none
  const [stack, dormer] = baked.objects.slice(-2);
  expect(stack.windows).toBeUndefined();
  expect(dormer.windows?.axis).toBeGreaterThan(0);
  expect(unpackStyle(dormer.windows?.style ?? 0).dormer).toBe(true);
  const facade = baked.vertices.facade;
  const ids = baked.vertices.objectIds;
  const lengths = (object: number) =>
    new Set(
      Array.from(ids.keys())
        .filter((v) => ids[v] === object && baked.vertices.isRoof[v] === 0)
        .map((v) => Math.round(((facade?.[4 * v + 1] ?? 0) / 32_767) * 512))
    );
  // the front 2 m long, the cheeks none
  expect(lengths(baked.objects.length - 1)).toEqual(new Set([2, 0]));
  expect(lengths(baked.objects.length - 2)).toEqual(new Set([0]));
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
      [3.5, 6.5],
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
  // own-colour glass carries its roughness itself, not a jitter in
  // [−1, 1] as every other row: smooth enough to hold a calm reflection
  expect(pane.rough).toBeGreaterThan(0);
  expect(pane.rough).toBeLessThanOrEqual(0.3);
  // muted glass, darker and cooler than its surround — not a black hole
  const lum = (c: readonly number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  expect(lum(pane.tint)).toBeLessThan(0.6 * lum(frame.tint));
  expect(lum(pane.tint)).toBeGreaterThan(0.1);
  expect(pane.tint[2] / pane.tint[0]).toBeGreaterThan(
    frame.tint[2] / frame.tint[0]
  );
  // the glass's eave is its top, over the shopfront's sunk foot
  expect(pane.eaveH).toBeCloseTo(
    paneTop(front(), house.storeyH) + SHOPFRONT_SINK,
    2
  );
  expect(frame.eaveH).toBeGreaterThan(4);
  // the surround and the canopy shaded smooth: their own normals
  const normals = baked.vertices.normals ?? new Float32Array();
  expect(
    normals.some(
      (n) => !Number.isNaN(n) && Math.abs(n) > 0.2 && Math.abs(n) < 0.95
    )
  ).toBe(true);
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

test("windows: a rhythm per house in its row, every wall vertex placed on its wall", () => {
  // the house's south wall, measured: a window every 3 m
  const wall: WindowWall = {
    oid: "house",
    wi: 0,
    a: [412_040, 5_656_000],
    b: [412_050, 5_656_000],
    L: 10,
    n: [0, -1],
    z: [100, 100],
    eave: 12,
    imgs: 6,
    seqs: 2,
    traits: {},
    model: { axis: 3, grid: "regular", w: 1.2, h: 1.6, storey: 3.2 },
  };
  const bake = (osm?: OsmBuildingLut, doc = fixture()) =>
    bakeCityMesh(
      "t",
      doc,
      undefined,
      null,
      osm,
      undefined,
      "render",
      undefined,
      undefined,
      { windows: [wall] }
    );
  const baked = bake();
  const [shop, part, house] = baked.objects;
  // the shop Building is drawn by its part: no wall of its own
  expect(shop.windows).toBeUndefined();
  // the house has its own; the part, 40 m off, beyond NEAR_M, keeps its
  // type's (a block's rhythm three houses on is not its own)
  expect(unpackStyle(house.windows?.style ?? 0).measured).toBe(true);
  // its own 3 m, drawn a little towards a block's
  expect(house.windows?.axis).toBeGreaterThan(TYPES.block.axis);
  expect(house.windows?.axis).toBeLessThan(3);
  expect(unpackStyle(part.windows?.style ?? 0).near).toBe(false);
  // the storey snapped under the eave: 12 m, four storeys
  expect(house.storeyH).toBeCloseTo(3, 2);
  // ...and the glTF property table carries the rhythm
  const table = cityMesh(baked).input.table?.properties;
  expect(table?.winStyle).toMatchObject({ componentType: "UINT32" });
  // a vertex's wall: the house's walls are 10 m long, the roof has none
  const f = baked.vertices.facade ?? new Int16Array();
  expect(f.length).toBe((4 * baked.vertices.positions.length) / 3);
  const { objectIds, positions: p } = baked.vertices;
  const lengths = new Set<number>();
  for (let t = 0; t < objectIds.length; t += 3) {
    // a wall triangle: its three corners not all at one height
    const zs = [2, 5, 8].map((c) => p[3 * t + c]);
    if (objectIds[t] === 2 && Math.max(...zs) - Math.min(...zs) > 1) {
      lengths.add(Math.round((f[4 * t + 1] / 32_767) * FACADE_SCALE_M));
    }
  }
  expect([...lengths]).toEqual([10]);
  // a landmark that is a town house keeps them, a church's walls are
  // its own
  expect(bake({ house: { landmark: 1 } }).objects[2].windows).toBeDefined();
  const church = fixture();
  church.CityObjects.house.attributes = {
    ...church.CityObjects.house.attributes,
    function: "31001_3041",
  };
  expect(bake(undefined, church).objects[2].windows).toBeUndefined();
});

test("windows: the ground floor's keep over the house's plinth", () => {
  const doc = fixture();
  const { objects } = bakeCityMesh("t", doc, undefined, null);
  const house = objects[2];
  // a pitched roof's house carries a plinth; 1.2 m over its base
  house.flags &= ~OBJECT_FLAG_FLAT_ROOF;
  const plinth: PlinthFeature = {
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [412_040, 5_656_000],
          [412_050, 5_656_000],
        ],
      ],
    },
    properties: { of: "house", g: [house.baseZ], top: [house.baseZ + 1.2] },
  };
  assignWindows(objects, Object.keys(doc.CityObjects), [], [], [plinth]);
  const s = unpackStyle(house.windows?.style ?? 0);
  expect(s.noGround).toBe(false);
  expect(s.sill + s.lift).toBeGreaterThanOrEqual(
    1.2 + WINDOW_ROWS.plinthGap - 1e-9
  );
  // without one, where its type has them
  const bare = bakeCityMesh("t", fixture(), undefined, null).objects;
  bare[2].flags &= ~OBJECT_FLAG_FLAT_ROOF;
  assignWindows(bare, Object.keys(doc.CityObjects), [], [], []);
  expect(unpackStyle(bare[2].windows?.style ?? 0).lift).toBe(0);
});

test("windows: without a plinth the ground floor's keep over the ground", () => {
  const doc = fixture();
  const { objects } = bakeCityMesh("t", doc, undefined, null);
  const house = objects[2];
  // a flat roof draws no plinth; the ground rises 1.0 m along one wall
  house.flags |= OBJECT_FLAG_FLAT_ROOF;
  const ground: PlinthFeature = {
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [412_040, 5_656_000],
          [412_050, 5_656_000],
        ],
      ],
    },
    properties: {
      of: "house",
      g: [house.baseZ + 1],
      top: [house.baseZ + 1.6],
    },
  };
  assignWindows(objects, Object.keys(doc.CityObjects), [], [], [ground]);
  const s = unpackStyle(house.windows?.style ?? 0);
  expect(s.noGround).toBe(false);
  expect(s.sill + s.lift).toBeGreaterThanOrEqual(
    1 + WINDOW_ROWS.plinthGap - 1e-9
  );
  expect(s.sill + s.lift).toBeLessThan(1.6 + WINDOW_ROWS.plinthGap);
});

test("windows: a wall the ground rises past loses its ground floor alone", () => {
  // the flat-roofed house (no plinth drawn), its south wall 3 m deep in
  // the ground
  const plinths: PlinthFeature[] = [
    {
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [412_040, 5_656_000],
            [412_050, 5_656_000],
          ],
        ],
      },
      properties: { of: "house", g: [103], top: [103.6] },
    },
  ];
  const doc = fixture();
  const { objects, vertices } = bakeCityMesh(
    "t",
    doc,
    undefined,
    null,
    undefined,
    undefined,
    "render",
    undefined,
    undefined,
    { plinths }
  );
  const house = Object.keys(doc.CityObjects).indexOf("house");
  // the other walls keep their ground floor, unlifted
  const s = unpackStyle(objects[house].windows?.style ?? 0);
  expect(s.noGround).toBe(false);
  expect(s.lift).toBe(0);
  const signs = new Set<number>();
  for (let v = 0; v < vertices.objectIds.length; v++) {
    const length = vertices.facade?.[4 * v + 1] ?? 0;
    if (vertices.objectIds[v] === house && length !== 0) {
      signs.add(Math.sign(length));
    }
  }
  // the south wall signed as a shopfront's, the others not, with the
  // ground's height (3 m) its windows keep over
  expect([...signs].sort((a, b) => a - b)).toEqual([-1, 1]);
  for (let v = 0; v < vertices.objectIds.length; v++) {
    const f = vertices.facade;
    if (f && vertices.objectIds[v] === house && f[4 * v + 1] < 0) {
      expect((f[4 * v + 2] / 32_767) * FACADE_SCALE_M).toBeCloseTo(3, 1);
    }
  }
});

test("windows: the ground floor's clear the fine ground, wall by wall", () => {
  // no plinth pieces at all: the ground in front of the south wall 3 m
  // over the base, 1 m in front of the others
  const doc = fixture();
  const { objects, vertices } = bakeCityMesh(
    "t",
    doc,
    undefined,
    null,
    undefined,
    undefined,
    "render",
    undefined,
    undefined,
    { groundAt: (_x, y) => (y < 5_656_000 ? 103 : 101) }
  );
  const house = Object.keys(doc.CityObjects).indexOf("house");
  const s = unpackStyle(objects[house].windows?.style ?? 0);
  // the others keep their ground floor, lifted over the 1 m
  expect(s.noGround).toBe(false);
  expect(s.sill + s.lift).toBeGreaterThanOrEqual(
    1 + WINDOW_ROWS.plinthGap - 1e-9
  );
  const signs = new Set<number>();
  for (let v = 0; v < vertices.objectIds.length; v++) {
    const length = vertices.facade?.[4 * v + 1] ?? 0;
    if (vertices.objectIds[v] === house && length !== 0) {
      signs.add(Math.sign(length));
    }
  }
  // the south wall loses its ground floor alone
  expect([...signs].sort((a, b) => a - b)).toEqual([-1, 1]);
});

test("a building's base moves up to the street its plinths stand on", () => {
  const doc = fixture();
  const keys = Object.keys(doc.CityObjects);
  const piece = (of: string, g: number): PlinthFeature => ({
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [412_040, 5_656_000],
          [412_050, 5_656_000],
        ],
      ],
    },
    properties: { of, g: [g], top: [g + 0.9] },
  });
  const pitched = () => {
    const { objects } = bakeCityMesh("t", doc, undefined, null);
    for (const o of objects) {
      o.flags &= ~OBJECT_FLAG_FLAT_ROOF;
    }
    return objects;
  };
  const objects = pitched();
  const [, part, house] = objects;
  const [base, eave, partBase] = [house.baseZ, house.eaveH, part.baseZ];
  const asBuilt = liftToStreet(objects, keys, [
    piece("house", base + 0.3),
    piece("house", base + 0.5),
  ]);
  // the higher piece's ground, the eave where it was
  expect(house.baseZ).toBeCloseTo(base + 0.5, 2);
  expect(house.baseZ + house.eaveH).toBeCloseTo(base + eave, 2);
  // what it moved, as it was
  expect([...asBuilt]).toEqual([[2, { baseZ: base, eaveH: eave }]]);
  // another building keeps its base
  expect(part.baseZ).toBe(partBase);
  // up a steep street: a metre over its lowest piece at most
  const steep = pitched();
  liftToStreet(steep, keys, [
    piece("house", base + 0.2),
    piece("house", base + 2),
  ]);
  expect(steep[2].baseZ).toBeCloseTo(base + 1.2, 2);
  // a base far under its street stands in a courtyard: it stays
  const deep = pitched();
  liftToStreet(deep, keys, [piece("house", base + 1.8)]);
  expect(deep[2].baseZ).toBe(base);
});

test("cityFrame is the frame the bake recenters a tile in, without the parse", () => {
  // a bridge slab the bake leaves out still spans the box the frame centres
  const withBridge = (): CityJsonDocument => {
    const doc = fixture();
    doc.vertices.push(...boxVertices(300, 200, 6));
    doc.CityObjects.bridge = {
      type: "Building",
      attributes: { function: "53001_1800" },
      geometry: [box(16)],
    };
    return doc;
  };
  const frame = cityFrame("t", withBridge());
  const baked = bakeCityMesh("t", withBridge(), undefined, null);
  expect(frame.offset).toEqual({ cx: 412_155, cy: 5_656_105 });
  expect([...frame.matrix.elements]).toEqual([...baked.matrix.elements]);
  expect(frame.offset).toEqual(baked.offset);
  expect(frame.epsg).toBe(25833);
});

test("normals round a curve within one object's walls, never into its roof, another object or a measured face", () => {
  // two wall facets 3 m wide turned 20° apart, sharing the edge at x = 0
  const a = (20 * Math.PI) / 180;
  const left = [-3 * Math.cos(a), 3 * Math.sin(a)];
  const right = [3, 0];
  const wall = (p: number[], q: number[]) => [
    p[0],
    p[1],
    0,
    q[0],
    q[1],
    0,
    q[0],
    q[1],
    5,
    p[0],
    p[1],
    0,
    q[0],
    q[1],
    5,
    p[0],
    p[1],
    5,
  ];
  const positions = Float32Array.from([
    ...wall(left, [0, 0]),
    ...wall([0, 0], right),
  ]);
  const at = (n: Float32Array, v: number) => [n[3 * v], n[3 * v + 1]];
  const make = (ids: number[], roof: number[], normals?: number[]) =>
    vertexNormals({
      positions,
      objectIds: Float32Array.from(ids),
      isRoof: Float32Array.from(roof),
      normals: normals ? Float32Array.from(normals) : undefined,
    });
  const one = Array.from({ length: 12 }, () => 0);
  // vertex 1 (left facet, shared edge) and 6 (right facet, same point)
  const rounded = make(one, one);
  expect(at(rounded, 1)[0]).toBeCloseTo(at(rounded, 6)[0], 5);
  expect(at(rounded, 1)[1]).toBeCloseTo(at(rounded, 6)[1], 5);
  const flatLeft = (n: Float32Array) => {
    expect(at(n, 1)[0]).toBeCloseTo(at(n, 0)[0], 5);
    expect(at(n, 1)[1]).toBeCloseTo(at(n, 0)[1], 5);
  };
  // the right facet another object's, then a roof, then measured
  flatLeft(
    make(
      [
        ...Array.from({ length: 6 }, () => 0),
        ...Array.from({ length: 6 }, () => 1),
      ],
      one
    )
  );
  flatLeft(
    make(one, [
      ...Array.from({ length: 6 }, () => 0),
      ...Array.from({ length: 6 }, () => 1),
    ])
  );
  flatLeft(
    make(one, one, [
      ...Array.from({ length: 18 }, () => Number.NaN),
      ...Array.from({ length: 6 }, () => [1, 0, 0]).flat(),
    ])
  );
});

test("joinEnsembles: touching trees of one name share the lowest root, its facts the whole's", () => {
  const sq = (x: number): [number, number][][] => [
    [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
    ],
  ];
  const facts = (name: string, height: number) => ({
    buildingId: `B${height}`,
    drawn: "",
    function: "",
    roofType: "",
    created: "",
    name,
    addr: "",
    height,
    roofPitch: -1,
    area: 100,
    levels: -1,
  });
  // 0: the complex (a Building drawn by its part 1), 2: the tower beside
  // it, 3: an unnamed house touching the tower
  const objects: Parameters<typeof joinEnsembles>[0] = [
    { root: 0, footprints: [], facts: facts("Schloss", 30) },
    { root: 0, footprints: sq(0), facts: facts("Schloss", 30) },
    { root: 2, footprints: sq(10), facts: facts("Schloss", 60) },
    { root: 3, footprints: sq(20), facts: facts("", 12) },
  ];
  const trees = new Map([
    [0, [0, 1]],
    [2, [2]],
    [3, [3]],
  ]);
  const z = [
    [0, 0],
    [100, 130],
    [101, 161],
    [102, 114],
  ];
  const outlines: Record<number, string> = { 0: "r1", 2: "r1", 3: "w2" };
  joinEnsembles(
    objects,
    trees,
    (root) => outlines[root] ?? "",
    (i) =>
      i === 0
        ? undefined
        : { baseZ: z[i][0], topZ: z[i][1], footprints: objects[i].footprints }
  );
  expect(objects.map((o) => o.ensemble)).toEqual([0, 0, 0, 3]);
  // the outline's key, the same in the tile across the edge
  expect(objects[1].group).toBe(ensembleGroup("r1"));
  expect(objects[3].group).toBe(ensembleGroup("w2"));
  expect(objects[0].facts?.height).toBe(61);
  expect(objects[0].facts?.area).toBeCloseTo(200, 0);
  // the tower keeps its own facts (its Kennung on the card)
  expect(objects[2].facts?.height).toBe(60);
});

test("a roof face the orthophoto read apart carries its own colour", () => {
  const baked = bakeCityMesh(
    "t",
    fixture(),
    {
      roofs: { house: [0.2, 0.2, 0.2] },
      // the house's roof: geometry 0, the Solid's second surface
      faces: { house: [[0, 1, 0.5, 0.25, 0.125]] },
    },
    null
  );
  const v = baked.vertices;
  const facade = cityMesh(baked).input.vectors?._FACADE?.array;
  let roofs = 0;
  for (let i = 0; i < v.objectIds.length; i++) {
    const own = v.roofRgb?.slice(3 * i, 3 * i + 3);
    if (v.objectIds[i] === 2 && v.isRoof[i] === 1) {
      roofs++;
      expect([...(own ?? [])]).toEqual([0.5, 0.25, 0.125]);
      expect((facade?.[4 * i] ?? 0) / 32_767).toBeCloseTo(0.5, 4);
      expect((facade?.[4 * i + 3] ?? 0) / 32_767).toBeCloseTo(0.125, 4);
    } else if (i < (v.roofRgb?.length ?? 0) / 3) {
      expect(Number.isNaN(own?.[0])).toBe(true);
    }
  }
  expect(roofs).toBeGreaterThan(0);
  // the house's row keeps its building colour for every other face
  expect(baked.objects[2].roof).toEqual([0.2, 0.2, 0.2]);
});

test("a short wall standing on the roof is the roof's, a set-back storey is not", () => {
  // walls of one object over a roof at 10 m, each one surface
  const quad = (z0: number, z1: number) => [
    0,
    0,
    z0,
    4,
    0,
    z0,
    4,
    0,
    z1,
    0,
    0,
    z0,
    4,
    0,
    z1,
    0,
    0,
    z1,
  ];
  const roof = [0, 0, 10, 1, 0, 10, 0, 1, 10];
  const gable = [0, 0, 10, 6, 0, 10, 3, 0, 11.2]; // a shallow one, at the eave
  const positions = Float32Array.from([
    ...roof,
    ...quad(10, 11), // a 1 m step on it
    ...quad(10, 13), // a storey set back on it
    ...quad(0, 1), // a 1 m wall on the ground
    ...gable,
  ]);
  // each vertex's surface: the roof's three, then the walls'
  const surface = [3, 6, 6, 6, 3].flatMap((n, s) =>
    Array.from({ length: n }, () => s)
  );
  const isRoof = withRoofSteps(
    {
      isRoof: Float32Array.from(surface, (s) => (s === 0 ? 1 : 0)),
      objectIds: new Float32Array(surface.length),
      positions,
      surfaces: Float32Array.from(surface.flatMap((s) => [0, s])),
    },
    Uint8Array.from(surface, (s) => (s === 0 ? 0 : 1))
  );
  const flags = [...isRoof];
  expect(flags.slice(0, 9)).toEqual(Array.from({ length: 9 }, () => 1)); // roof, step
  // the set-back storey, the wall on the ground and the gable stay walls
  expect(flags.slice(9)).toEqual(Array.from({ length: 15 }, () => 0));
});

test("a roof on posts without an outline stays a block", () => {
  // one object: a wall from the ground to 4 m and its roof at 4 m
  const v = {
    positions: Float32Array.from([
      0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 4, 1, 0, 4, 0, 1, 4,
    ]),
    objectIds: new Float32Array(6),
    isRoof: Float32Array.from([0, 0, 0, 1, 1, 1]),
  };
  const offset = { cx: 0, cy: 0 };
  expect(withOpenRoofs(v, new Set([0]), [[]], offset)).toBe(v);
  // with its outline the wall is cut under the slab and the posts stand
  const ring: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  const opened = withOpenRoofs(v, new Set([0]), [[ring]], offset);
  expect(opened.positions.length).toBeGreaterThan(v.positions.length);
});

test("a rebuilt roof's parts carry their own colour, its walls none", () => {
  // one LoD2 object (a 2 m cube) rebuilt as two flat parts
  const v = {
    positions: Float32Array.from([0, 0, 100, 2, 0, 100, 0, 2, 102]),
    objectIds: Float32Array.from([0, 0, 0]),
    isRoof: Float32Array.from([0, 0, 1]),
  };
  const part = (x: number, z: number) => ({
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [x, 0],
          [x + 4, 0],
          [x + 4, 4],
          [x, 4],
          [x, 0],
        ] as [number, number][],
      ],
    },
    properties: { id: "a", z },
  });
  const out = withMeasuredRoofs(
    v,
    ["a"],
    { cx: 0, cy: 0 },
    [part(0, 110), part(4, 106)],
    {
      parts: {
        a: [
          [1, 106, 0.5, 0.25, 0.125],
          [0, 99, 0.9, 0.9, 0.9],
        ],
      },
    }
  );
  const rgb = out.roofRgb ?? new Float32Array();
  expect(rgb).toHaveLength(out.positions.length);
  let red = 0;
  for (let i = 0; i < out.isRoof.length; i++) {
    const c = Array.from(rgb.subarray(3 * i, 3 * i + 3));
    const z = out.positions[3 * i + 2];
    if (out.isRoof[i] === 1 && z === 106) {
      expect(c).toEqual([0.5, 0.25, 0.125]);
      red++;
    } else {
      // the first part's roof (its colour read at another level) and every
      // wall: the object's colour
      expect(c.every(Number.isNaN)).toBe(true);
    }
  }
  expect(red).toBe(6);
});

test("an Überdachung LoD2 draws as a block stands on posts under its roof", () => {
  const fx = fixture();
  fx.CityObjects.house.attributes = { function: "51009_1610" };
  const block = bakeCityMesh("t", fixture(), undefined, null);
  const baked = bakeCityMesh("t", fx, undefined, null);
  const v = baked.vertices;
  const tris = [...Array(v.objectIds.length / 3).keys()]
    .filter((t) => v.objectIds[t * 3] === 2)
    .map((t) => ({
      roof: v.isRoof[t * 3] === 1,
      p: [...v.positions.subarray(t * 9, t * 9 + 9)],
    }));
  const zs = (p: number[]) => [p[2], p[5], p[8]];
  // 10 × 10 m: a 0.4 m slab under the roof at 112 m (float32 positions)
  const under = 112 - 0.4;
  const roof = tris.filter((t) => t.roof);
  expect(roof.length).toBeGreaterThan(0);
  expect(
    roof.every((t) => zs(t.p).every((z) => Math.abs(z - 112) < 1e-4))
  ).toBe(true);
  // what reaches below the slab is posts: 0.3 m across, from the base up
  const below = tris.filter((t) => Math.min(...zs(t.p)) < under - 1e-4);
  expect(below.length).toBe(8);
  const xs = below.flatMap((t) => [t.p[0], t.p[3], t.p[6]]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.3, 4);
  expect(Math.min(...below.flatMap((t) => zs(t.p)))).toBeCloseTo(100, 4);
  expect(Math.max(...below.flatMap((t) => zs(t.p)))).toBeCloseTo(under, 4);
  // its floor is gone, its underside faces down at the slab
  const flat = tris.filter((t) => !t.roof && new Set(zs(t.p)).size === 1);
  expect(flat.length).toBeGreaterThan(0);
  expect(flat.every((t) => Math.abs(t.p[2] - under) < 1e-4)).toBe(true);
  // the same row: no facade to dress, a flat roof's gate, no windows
  const house = baked.objects[2];
  expect(baked.objects).toHaveLength(block.objects.length);
  expect(house.flags & OBJECT_FLAG_FLAT_ROOF).toBe(OBJECT_FLAG_FLAT_ROOF);
  expect(house.storeyH).toBeGreaterThan(house.eaveH);
  expect(house.windows).toBeUndefined();
  // the shop is untouched
  const shopTris = (m: typeof v) =>
    [...m.objectIds.keys()].filter((i) => m.objectIds[i] === 1).length;
  expect(shopTris(v)).toBe(shopTris(block.vertices));
});

test("an Überdachung too low to walk under stays a block", () => {
  const fx = fixture();
  fx.CityObjects.house.attributes = { function: "51009_1611" };
  // the house's top at 2 m: 1.6 m under its slab
  fx.vertices = fx.vertices.map((p, i) => (i >= 12 ? [p[0], p[1], 2] : p));
  const plain = fixture();
  plain.vertices = fx.vertices;
  const v = bakeCityMesh("t", fx, undefined, null).vertices;
  const w = bakeCityMesh("t", plain, undefined, null).vertices;
  expect([...v.positions]).toEqual([...w.positions]);
});

test("a gap roof is a roof on posts, a building newer than the model says so, a raised part starts at its floor", () => {
  const square = (x0: number): [number, number][][] => [
    [
      [412_000 + x0, 5_656_020],
      [412_008 + x0, 5_656_020],
      [412_008 + x0, 5_656_028],
      [412_000 + x0, 5_656_028],
      [412_000 + x0, 5_656_020],
    ],
  ];
  const gaps: StructureFeature[] = [
    {
      geometry: { type: "Polygon", coordinates: square(0) },
      properties: { h: 5.8, kind: "roof", name: "Bahnsteig 1", z: 100 },
    },
    {
      geometry: { type: "Polygon", coordinates: square(20) },
      properties: { h: 51.2, kind: "building", src: "osm", z: 100 },
    },
    {
      // a bridge between two buildings, 7 m over the street
      geometry: { type: "Polygon", coordinates: square(40) },
      properties: { base: 7, h: 12, kind: "building", z: 100 },
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
  const [roof, tower, bridge] = baked.objects.slice(3);
  expect(bridge.baseZ).toBe(107);
  expect(bridge.eaveH).toBe(5);
  expect(roof.building).toBe(false);
  expect(roof.source).toBe(OBJECT_SOURCE_GAP);
  expect(roof.flags & OBJECT_FLAG_FLAT_ROOF).toBe(OBJECT_FLAG_FLAT_ROOF);
  expect(roof.facts).toMatchObject({
    function: "51009_1610",
    name: "Bahnsteig 1",
  });
  expect(tower.building).toBe(true);
  expect(decodeDrawn(tower.facts?.drawn ?? "")).toMatchObject({
    height: "osm",
  });
  expect(decodeDrawn(roof.facts?.drawn ?? "").height).toBeUndefined();
});

test("an unmapped house counts its storeys in its neighbours' storey height (G21)", () => {
  const baked = bakeCityMesh("t", fixture(), undefined, null, {
    house: { storey: 4 },
  });
  const house = baked.objects[2];
  // 12 m to the eave in storeys of about 4 m: three, not four of 3 m
  expect(house.storeyH).toBe(4);
  expect(storeyHeight(12)).toBe(3);
  expect(decodeDrawn(house.facts?.drawn ?? "").storey).toBe("neighbours");
  // OSM's own count wins
  const counted = bakeCityMesh("t", fixture(), undefined, null, {
    house: { levels: 4, storey: 4 },
  }).objects[2];
  expect(counted.storeyH).toBe(3);
  expect(decodeDrawn(counted.facts?.drawn ?? "").storey).toBe("osm");
});

test("a flat-roofed house of tall storeys or listed is a town house, a low-storeyed one a block (G10)", () => {
  const town = (osm: Record<string, number>) =>
    bakeCityMesh("t", fixture(), undefined, null, { house: osm }).objects[2]
      .townHouse ?? false;
  // the house's box is flat-roofed, 12 m to the eave
  expect(town({ levels: 3 })).toBe(true);
  expect(town({ levels: 4 })).toBe(false);
  expect(town({ levels: 4, heritage: 1 })).toBe(true);
  // the shop's part (31001_2000, trade) is no town house, however tall
  const shop = bakeCityMesh("t", fixture(), undefined, null, {
    "shop-part": { levels: 2 },
  }).objects[1];
  expect(shop.townHouse ?? false).toBe(false);
});

test("cornices on a town house only, the plinth on every house (G19)", () => {
  const row = { flags: 0, storeyH: 3 };
  expect(carriesCornices(row)).toBe(false);
  expect(carriesCornices({ ...row, storeyH: 3.4 })).toBe(true);
  expect(carriesCornices({ ...row, flags: OBJECT_FLAG_HERITAGE })).toBe(true);
  expect(carriesCornices({ ...row, townHouse: true })).toBe(true);
});

test("a structure carries no door, plinth or shopfront (G17)", () => {
  const keys = ["tank", "house"];
  const hosts = [{ fn: "51003_1000" }, { fn: "31001_1000" }];
  const door = (of: string): DoorFeature => ({
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { h: 2.2, kind: "door", nx: 0, ny: -1, of, w: 1, z: 100 },
  });
  const kept = onBuildings(
    {
      doors: [door("tank"), door("house"), door("elsewhere")],
      shopfronts: [{ oid: "tank" }, { oid: "house" }] as ShopfrontWall[],
    },
    keys,
    hosts
  );
  expect(kept.doors?.map((d) => d.properties?.of)).toEqual([
    "house",
    "elsewhere",
  ]);
  expect(kept.shopfronts?.map((w) => w.oid)).toEqual(["house"]);
  expect(kept.plinths).toBeUndefined();
});

test("a missing building the surface model shapes stands its measured parts, its eave at the lowest roof (G27)", () => {
  // an 8 × 8 m outline: a 4 m wide flat wing at 106 m and a mono-pitch
  // face rising 0.5 m a metre from 108 m
  const ring = (x0: number, x1: number): [number, number][] => [
    [412_000 + x0, 5_656_020],
    [412_000 + x1, 5_656_020],
    [412_000 + x1, 5_656_028],
    [412_000 + x0, 5_656_028],
    [412_000 + x0, 5_656_020],
  ];
  const cols = 8;
  const rows = 12;
  const f: StructureFeature = {
    geometry: { type: "Polygon", coordinates: [ring(0, 8)] },
    properties: {
      h: 9,
      kind: "building",
      z: 100,
      parts: [
        { coordinates: [ring(0, 4)], z: 106 },
        {
          coordinates: [ring(4, 8)],
          z: 109,
          surface: {
            x: 412_002,
            y: 5_656_030,
            res: 1,
            cols,
            rows,
            dz: Array.from({ length: cols * rows }, (_, k) => (k % cols) * 50),
          },
        },
      ],
    },
  };
  const offset = { cx: 412_000, cy: 5_656_000 };
  const shaped = shapedGap(f, offset);
  expect(shaped?.eave).toBeCloseTo(6, 6);
  expect(shaped?.pitched).toBe(true);
  // the box's flat roof stands where it has no parts, or is raised
  const box = { ...f, properties: { h: 9, kind: "building", z: 100 } };
  expect(shapedGap(box as StructureFeature, offset)).toBeNull();
  const raised = { ...f, properties: { ...f.properties, base: 4 } };
  expect(shapedGap(raised as StructureFeature, offset)).toBeNull();
  const baked = bakeCityMesh(
    "t",
    fixture(),
    undefined,
    null,
    undefined,
    undefined,
    "render",
    [f]
  );
  const gap = baked.objects[3];
  expect(gap.building).toBe(true);
  expect(gap.eaveH).toBeCloseTo(6.3, 6);
  expect(gap.storeyH).toBe(storeyHeight(6));
  // the face shades with its own normals; every vertex has one slot
  const v = baked.vertices;
  expect(v.normals?.length).toBe(v.positions.length);
  const roofZ = [...v.positions].filter(
    (_, i) => i % 3 === 2 && v.objectIds[(i - 2) / 3] === 3
  );
  expect(Math.max(...roofZ)).toBeGreaterThan(110);
});

test("a shed's and a gap building's roof take the orthophoto's colour the roof colour bake read (G5)", () => {
  const square = (x0: number): [number, number][][] => [
    [
      [412_000 + x0, 5_656_020],
      [412_004 + x0, 5_656_020],
      [412_004 + x0, 5_656_024],
      [412_000 + x0, 5_656_024],
      [412_000 + x0, 5_656_020],
    ],
  ];
  const scan = [0, 10].map((x0) => ({
    geometry: { type: "Polygon" as const, coordinates: square(x0) },
    properties: { h: 2.5, z: 100 },
  }));
  const gaps: StructureFeature[] = [
    {
      geometry: { type: "Point", coordinates: [412_030, 5_656_030] },
      properties: { h: 40, kind: "chimney", r: 2, rt: 1.2, z: 100 },
    },
    {
      geometry: { type: "Polygon", coordinates: square(20) },
      properties: { h: 9, kind: "building", z: 101 },
    },
  ];
  const roofColours = {
    // the second shed's row was read when it stood 1 m lower: not its own
    scan: [
      [0, 100, 0.3, 0.1, 0.05],
      [1, 99, 0.9, 0.9, 0.9],
    ],
    // a gap's row by its index in the file (the chimney is 0)
    gaps: [[1, 101, 0.05, 0.2, 0.1]],
  };
  const baked = bakeCityMesh(
    "t",
    fixture(),
    roofColours,
    null,
    undefined,
    scan,
    "render",
    gaps
  );
  const [read, stale, , building] = baked.objects.slice(3);
  expect(read.roof).toEqual([0.3, 0.1, 0.05]);
  expect(stale.roof).not.toEqual([0.9, 0.9, 0.9]);
  expect(building.roof).toEqual([0.05, 0.2, 0.1]);
  // the card says where the colour came from
  expect(decodeDrawn(read.facts?.drawn ?? "").roof).toBe("dop");
  expect(decodeDrawn(stale.facts?.drawn ?? "").roof).toBe("palette");
  expect(decodeDrawn(building.facts?.drawn ?? "").roof).toBe("dop");
  expect(appendedRoofColour(undefined, 0, 100)).toBeUndefined();
  expect(appendedRoofColour(roofColours.scan, 0, undefined)).toBeUndefined();
});

test("a passage OSM maps through a house is cut open and lined", () => {
  // a footway north through the 10 × 10 m house (x 40–50) at x 45
  const xy = (x: number, y: number): [number, number] => [
    412_000 + x,
    5_656_000 + y,
  ];
  const passage: PassageFeature = {
    geometry: { type: "LineString", coordinates: [xy(45, -0.6), xy(45, 10.6)] },
    properties: {
      h: null,
      kind: "footway",
      osm: [1],
      w: 2.5,
      wFrom: "kind",
      z: [100, 100],
      of: {
        house: {
          roof: [[xy(43.75, 0), xy(46.25, 0), xy(46.25, 10), xy(43.75, 10)]],
          sides: [
            [xy(46.25, 0), xy(46.25, 10)],
            [xy(43.75, 10), xy(43.75, 0)],
          ],
          portals: [
            [...xy(45, 0), 0, -1],
            [...xy(45, 10), 0, 1],
          ],
        },
      },
    },
  };
  // an entrance mapped where the passage meets the wall
  const door: DoorFeature = {
    geometry: { type: "Point", coordinates: xy(45, 0) },
    properties: {
      h: 2.2,
      kind: "main",
      nx: 0,
      ny: -1,
      of: "house",
      w: 1.2,
      z: 100,
    },
  };
  const plain = bakeCityMesh("t", fixture(), undefined, null);
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
    { doors: [door], passages: [passage] }
  );
  const { cx, cy } = baked.offset;
  const house = 2;
  const lining = baked.objects.findIndex(
    (o) => o.source === OBJECT_SOURCE_PASSAGE
  );
  expect(lining).toBeGreaterThan(house);
  expect(baked.objects[lining].root).toBe(house);
  expect(baked.objects[lining].windows).toBeUndefined();
  // no door is drawn in the opening
  expect(baked.objects.some((o) => o.source === OBJECT_SOURCE_DOOR)).toBe(
    false
  );
  const v = baked.vertices;
  const p = v.positions;
  let walls = 0;
  let lined = 0;
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    const o = v.objectIds[t];
    const x = (p[3 * t] + p[3 * t + 3] + p[3 * t + 6]) / 3 + cx - 412_000;
    const y = (p[3 * t + 1] + p[3 * t + 4] + p[3 * t + 7]) / 3 + cy - 5_656_000;
    const z = (p[3 * t + 2] + p[3 * t + 5] + p[3 * t + 8]) / 3;
    if (o === lining) {
      lined++;
      continue;
    }
    if (o !== house || v.isRoof[t] === 1) {
      continue;
    }
    walls++;
    // nothing of the house left in the opening (3 m up, as a footway)
    expect(Math.abs(x - 45) < 1.25 && z < 103 && (y < 0.01 || y > 9.99)).toBe(
      false
    );
  }
  // the two front walls each cut into pieces around the opening
  const plainWalls = plain.vertices.isRoof.filter((r) => r === 0).length;
  expect(walls * 3).toBeGreaterThan(plainWalls);
  // two walls along it, a quad each, and the ceiling
  expect(lined).toBe(2 * 2 + 2);
  // every cut piece keeps its wall's length in `_FACADE`
  const facade = v.facade;
  expect(facade).toBeDefined();
  const lengths = new Set<number>();
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    const ys = [0, 1, 2].map((k) => p[3 * (t + k) + 1] + cy - 5_656_000);
    if (
      v.objectIds[t] === house &&
      v.isRoof[t] === 0 &&
      ys.every((y) => Math.abs(y) < 0.01)
    ) {
      for (let k = 0; k < 3; k++) {
        lengths.add(facade?.[4 * (t + k) + 1] ?? 0);
      }
    }
  }
  expect([...lengths]).toHaveLength(1);
});

test("two passages crossing in a house keep their linings out of each other", () => {
  const xy = (x: number, y: number): [number, number] => [
    412_000 + x,
    5_656_000 + y,
  ];
  // a footway north through the house (x 40–50) at x 45, one east at y 5
  const through = (
    id: number,
    axis: [number, number][],
    roof: [number, number][],
    sides: [number, number][][],
    portals: [number, number, number, number][]
  ): PassageFeature => ({
    geometry: { type: "LineString", coordinates: axis },
    properties: {
      h: null,
      kind: "footway",
      osm: [id],
      w: 2.5,
      wFrom: "kind",
      z: [100, 100],
      of: { house: { roof: [roof], sides, portals } },
    },
  });
  const north = through(
    1,
    [xy(45, -0.6), xy(45, 10.6)],
    [xy(43.75, 0), xy(46.25, 0), xy(46.25, 10), xy(43.75, 10)],
    [
      [xy(46.25, 0), xy(46.25, 10)],
      [xy(43.75, 10), xy(43.75, 0)],
    ],
    [
      [...xy(45, 0), 0, -1],
      [...xy(45, 10), 0, 1],
    ]
  );
  const east = through(
    2,
    [xy(39.4, 5), xy(50.6, 5)],
    [xy(40, 3.75), xy(50, 3.75), xy(50, 6.25), xy(40, 6.25)],
    [
      [xy(40, 6.25), xy(50, 6.25)],
      [xy(50, 3.75), xy(40, 3.75)],
    ],
    [
      [...xy(40, 5), -1, 0],
      [...xy(50, 5), 1, 0],
    ]
  );
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
    { doors: [], passages: [north, east] }
  );
  const { cx, cy } = baked.offset;
  const v = baked.vertices;
  const p = v.positions;
  let lined = 0;
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    if (baked.objects[v.objectIds[t]].source !== OBJECT_SOURCE_PASSAGE) {
      continue;
    }
    lined++;
    // no point of a lining stands in either opening, under its ceiling
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; i + j <= 10; j++) {
        const [a, b] = [i / 10, j / 10];
        const at = (c: number) =>
          p[3 * t + c] * (1 - a - b) +
          p[3 * t + 3 + c] * a +
          p[3 * t + 6 + c] * b;
        const x = at(0) + cx - 412_000;
        const y = at(1) + cy - 5_656_000;
        const inNorth = Math.abs(x - 45) < 1.2 && y > 0.1 && y < 9.9;
        const inEast = Math.abs(y - 5) < 1.2 && x > 40.1 && x < 49.9;
        expect((inNorth || inEast) && at(2) < 102.9).toBe(false);
      }
    }
  }
  expect(lined).toBeGreaterThan(0);
});
