import { expect, test } from "bun:test";
import {
  type CityObjectRow,
  countBuildings,
  doomedObjects,
  footprintPolys,
  hasObjectFlag,
  liveTriangles,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_SHOP,
  OBJECT_TEXTURE_WIDTH,
  objectBandRows,
  objectFlags,
  objectTable,
  packObjectTexels,
} from "./city-mesh";

function row(partial: Partial<CityObjectRow>): CityObjectRow {
  return {
    baseZ: 100,
    building: true,
    eaveH: 9,
    flags: 0,
    footprints: [],
    glow: 0,
    roof: [0.5, 0.2, 0.1],
    root: 0,
    rough: 0.3,
    storeyH: 3,
    tint: [0.8, 0.8, 0.7],
    ...partial,
  };
}

const square: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
];
const rows: CityObjectRow[] = [
  row({ root: 0, footprints: [square] }),
  row({ root: 0, building: false, glow: 1, baseZ: 101, flags: 3 }),
  row({ root: 2, footprints: [square, square], tint: [0.1, 0.2, 0.3] }),
];

test("objectTable turns rows into typed columns", () => {
  const t = objectTable(rows);
  expect(t.count).toBe(3);
  expect([...t.root]).toEqual([0, 0, 2]);
  expect([...t.building]).toEqual([1, 0, 1]);
  expect([...t.glow]).toEqual([0, 1, 0]);
  expect(Array.from(t.tint.subarray(6, 9))).toEqual(
    [0.1, 0.2, 0.3].map((v) => Math.fround(v))
  );
});

test("packObjectTexels lays three bands over the object index", () => {
  const t = objectTable(rows);
  const bandRows = objectBandRows(t.count);
  expect(bandRows).toBe(1);
  expect(objectBandRows(OBJECT_TEXTURE_WIDTH + 1)).toBe(2);
  const texels = packObjectTexels(t);
  const band = OBJECT_TEXTURE_WIDTH * bandRows * 4;
  expect(texels.length).toBe(band * 3);
  // object 1: (tint, baseZ) (roof, eaveH) (storeyH, glow, rough, 0)
  expect(texels[4 + 3]).toBe(101);
  expect(texels[band + 4 + 3]).toBe(9);
  expect(texels[2 * band + 4 + 1]).toBe(1);
  expect(texels[2 * band + 4 + 2]).toBeCloseTo(0.3, 6);
  // band 2's last float carries the OSM flags
  expect(texels[2 * band + 4 + 3]).toBe(3);
  expect(texels[2 * band + 3]).toBe(0);
});

test("objectFlags sums the OSM facts as bits, hasObjectFlag reads them", () => {
  expect(objectFlags(undefined)).toBe(0);
  expect(objectFlags({ shop: 1 })).toBe(OBJECT_FLAG_SHOP);
  expect(objectFlags({ heritage: 1 })).toBe(OBJECT_FLAG_HERITAGE);
  const both = objectFlags({ shop: 1, heritage: 1 });
  expect(both).toBe(3);
  expect(hasObjectFlag(both, OBJECT_FLAG_SHOP)).toBe(true);
  expect(hasObjectFlag(both, OBJECT_FLAG_HERITAGE)).toBe(true);
  expect(hasObjectFlag(OBJECT_FLAG_HERITAGE, OBJECT_FLAG_SHOP)).toBe(false);
  expect(hasObjectFlag(OBJECT_FLAG_SHOP, OBJECT_FLAG_HERITAGE)).toBe(false);
});

test("doomedObjects takes the whole building tree", () => {
  const { root } = objectTable(rows);
  expect([...doomedObjects(root, 1)].sort((a, b) => a - b)).toEqual([0, 1]);
  expect([...doomedObjects(root, 2)]).toEqual([2]);
  expect(doomedObjects(root, 7).size).toBe(0);
});

test("liveTriangles drops the triangles of dead objects", () => {
  // Two triangles of object 0, one of object 2 (vertex → feature id).
  const featureIds = [0, 0, 0, 0, 2, 2, 2];
  const index = [0, 1, 2, 1, 2, 3, 4, 5, 6];
  expect([...liveTriangles(index, featureIds, (i) => i !== 0)]).toEqual([
    4, 5, 6,
  ]);
  expect([...liveTriangles(index, featureIds, () => true)]).toEqual(index);
});

test("countBuildings and footprintPolys follow the alive set", () => {
  const t = objectTable(rows);
  expect(countBuildings(t.building, () => true)).toBe(2);
  expect(countBuildings(t.building, (i) => i !== 2)).toBe(1);
  const footprints = rows.map((r) => r.footprints);
  expect(footprintPolys(footprints, () => true)).toHaveLength(3);
  expect(footprintPolys(footprints, (i) => i !== 2)).toHaveLength(1);
});
