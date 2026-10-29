import { describe, expect, test } from "bun:test";
import {
  markFlatRoofs,
  markGrounded,
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_GROUNDED,
  type CityObjectRow,
  countBuildings,
  doomedObjects,
  footprintPolys,
  hasObjectFlag,
  isTrafficStructure,
  liveTriangles,
  takeTriangles,
  wholeTrees,
  appendTriangles,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_SHOP,
  OBJECT_TEXTURE_WIDTH,
  objectBandRows,
  inheritedFlags,
  isFloodlit,
  OBJECT_FLAG_ASKED,
  OBJECT_FLAG_FLOODLIT,
  OBJECT_FLAG_LANDMARK,
  objectFlags,
  shaderFlags,
  objectTable,
  packObjectTexels,
  withoutTrafficStructures,
} from "./city-mesh";
import type { CityJsonDocument } from "./types";

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
  row({
    root: 0,
    building: false,
    glow: 1,
    baseZ: 101,
    flags: 3,
    windows: { axis: 3.2, h: 1.7, style: 2_097_155, w: 1.15 },
  }),
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

test("packObjectTexels lays four bands over the object index", () => {
  const t = objectTable(rows);
  const bandRows = objectBandRows(t.count);
  expect(bandRows).toBe(1);
  expect(objectBandRows(OBJECT_TEXTURE_WIDTH + 1)).toBe(2);
  const texels = packObjectTexels(t);
  const band = OBJECT_TEXTURE_WIDTH * bandRows * 4;
  expect(texels.length).toBe(band * 4);
  // object 1: (tint, baseZ) (roof, eaveH) (storeyH, glow, rough, 0)
  expect(texels[4 + 3]).toBe(101);
  expect(texels[band + 4 + 3]).toBe(9);
  expect(texels[2 * band + 4 + 1]).toBe(1);
  expect(texels[2 * band + 4 + 2]).toBeCloseTo(0.3, 6);
  // band 2's last float carries the OSM flags
  expect(texels[2 * band + 4 + 3]).toBe(3);
  expect(texels[2 * band + 3]).toBe(0);
  // band 3: the windows (axis, width, height, style), the style word exact
  expect(texels[3 * band + 4]).toBeCloseTo(3.2, 6);
  expect(texels[3 * band + 4 + 1]).toBeCloseTo(1.15, 6);
  expect(texels[3 * band + 4 + 2]).toBeCloseTo(1.7, 6);
  expect(texels[3 * band + 4 + 3]).toBe(2_097_155);
  expect(texels[3 * band]).toBe(0);
});

test("a city floodlights some of its landmarks, each building whole", () => {
  // two parts of each of 200 landmark outlines, then a plain building
  const n = 401;
  const t = {
    ensemble: new Uint32Array(n),
    flags: new Uint16Array(n).fill(OBJECT_FLAG_LANDMARK),
    group: new Uint32Array(n),
    rough: new Float32Array(n),
  };
  for (let i = 0; i < 400; i++) {
    t.group[i] = 1_000_003 + Math.floor(i / 2) * 7919;
  }
  t.flags[400] = OBJECT_FLAG_SHOP;
  let lit = 0;
  for (let i = 0; i < 400; i += 2) {
    expect(isFloodlit(t, i + 1)).toBe(isFloodlit(t, i));
    lit += isFloodlit(t, i) ? 1 : 0;
  }
  expect(lit / 200).toBeGreaterThan(0.45);
  expect(lit / 200).toBeLessThan(0.75);
  expect(isFloodlit(t, 400)).toBe(false);
  // the runtime bits ride beside the column, above the readings' bits
  const one = [...Array(400).keys()].find((i) => isFloodlit(t, i)) ?? 0;
  expect(shaderFlags(t, one, true)).toBe(
    OBJECT_FLAG_LANDMARK + OBJECT_FLAG_FLOODLIT + OBJECT_FLAG_ASKED
  );
  expect(shaderFlags(t, 400)).toBe(OBJECT_FLAG_SHOP);
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

test("inheritedFlags is the object's own facts or its root's", () => {
  expect(inheritedFlags(undefined, undefined)).toBe(0);
  expect(inheritedFlags({ shop: 1 }, undefined)).toBe(OBJECT_FLAG_SHOP);
  expect(inheritedFlags(undefined, { heritage: 1 })).toBe(OBJECT_FLAG_HERITAGE);
  expect(inheritedFlags({ shop: 1 }, { shop: 1, heritage: 1 })).toBe(3);
});

test("doomedObjects takes the whole building tree", () => {
  const { root } = objectTable(rows);
  expect([...doomedObjects(root, 1)].sort((a, b) => a - b)).toEqual([0, 1]);
  expect([...doomedObjects(root, 2)]).toEqual([2]);
  expect(doomedObjects(root, 7).size).toBe(0);
});

test("doomedObjects over the ensembles takes every tree of one", () => {
  const { ensemble } = objectTable(rows.map((r) => ({ ...r, ensemble: 0 })));
  expect(doomedObjects(ensemble, 2).size).toBe(rows.length);
  // a row without an ensemble is its tree's own
  expect([...objectTable(rows).ensemble]).toEqual(rows.map((r) => r.root));
});

test("a design's objects leave the index and come back whole", () => {
  // three triangles: objects 0, 1, 0
  const featureIds = [0, 0, 0, 1, 1, 1, 0, 0, 0];
  const index = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const { kept, taken } = takeTriangles(index, featureIds, (i) => i === 0);
  expect([...kept]).toEqual([3, 4, 5]);
  expect([...(taken.get(0) ?? [])]).toEqual([0, 1, 2, 6, 7, 8]);
  const back = appendTriangles(kept, [...taken.values()]);
  expect([...back].sort((a, b) => a - b)).toEqual(index);
});

test("a covered house is hidden with what hangs on it", () => {
  // 0: a Building, 1: its part, 2: its plinth, 3: a neighbour, 4: its door
  const root = [0, 0, 0, 3, 3];
  expect([...wholeTrees(root, new Set([1]))]).toEqual([0, 1, 2]);
  expect([...wholeTrees(root, new Set([3, 9]))]).toEqual([3, 4]);
  expect(wholeTrees(root, new Set()).size).toBe(0);
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

test("LoD2 traffic structures (ALKIS 53001, bridges) leave the building mesh", () => {
  expect(isTrafficStructure({ function: "53001_1800" })).toBe(true);
  expect(isTrafficStructure({ function: "31001_2000" })).toBe(false);
  expect(isTrafficStructure({ function: "51009_1700" })).toBe(false);
  expect(isTrafficStructure(undefined)).toBe(false);
  const doc: CityJsonDocument = {
    type: "CityJSON",
    version: "2.0",
    vertices: [
      [0, 0, 0],
      [9, 9, 9],
    ],
    CityObjects: {
      house: { type: "Building", attributes: { function: "31001_1000" } },
      bridge: {
        type: "Building",
        attributes: { function: "53001_1800" },
        children: ["deck"],
      },
      deck: { type: "BuildingPart", parents: ["bridge"] },
    },
  };
  const kept = withoutTrafficStructures(doc);
  expect(Object.keys(kept.CityObjects)).toEqual(["house"]);
  // the recenter matrix is computed over every vertex: they stay
  expect(kept.vertices).toBe(doc.vertices);
  const plain = { ...doc, CityObjects: { house: doc.CityObjects.house } };
  expect(withoutTrafficStructures(plain)).toBe(plain);
});

describe("markGrounded", () => {
  test("flags the parts near their tree's lowest base, not one on a roof", () => {
    const objects = [
      { baseZ: 0, eaveH: 0, flags: 0, root: 0 },
      { baseZ: 110, eaveH: 9, flags: 0, root: 0 },
      { baseZ: 112.5, eaveH: 9, flags: 1, root: 0 },
      { baseZ: 124, eaveH: 9, flags: 0, root: 0 },
      { baseZ: 140, eaveH: 9, flags: 0, root: 4 },
    ];
    markGrounded(objects);
    // the Building drawn by its parts takes no flag, nor sets the lowest base
    expect(objects.map((o) => o.flags)).toEqual([
      0,
      OBJECT_FLAG_GROUNDED,
      1 + OBJECT_FLAG_GROUNDED,
      0,
      OBJECT_FLAG_GROUNDED,
    ]);
    markGrounded(objects);
    expect(objects[1].flags).toBe(OBJECT_FLAG_GROUNDED);
  });

  test("judges a part lifted to its street on its base as LoD2 built it", () => {
    // the street lift moved the front part 0.5 m up, the courtyard part
    // (the tree's lowest, 3.2 m under the street) stayed
    const objects = [
      { baseZ: 100, eaveH: 6, flags: 0, root: 0 },
      { baseZ: 103.2, eaveH: 11.5, flags: 0, root: 0 },
    ];
    const asBuilt = new Map([[1, { baseZ: 102.7, eaveH: 12 }]]);
    markGrounded(objects, asBuilt);
    expect(objects[1].flags).toBe(OBJECT_FLAG_GROUNDED);
    // read on the lifted base, it would stand over the slack
    const lifted = objects.map((o) => ({ ...o, flags: 0 }));
    markGrounded(lifted);
    expect(lifted[1].flags).toBe(0);
  });
});

test("markFlatRoofs: a roof mostly level is flat, a pitched one not", () => {
  const objects = [{ flags: 0 }, { flags: 0 }, { flags: 128 }];
  // object 0: one level roof triangle; object 1: one at 45°; object 2: a
  // level triangle that is a wall (not roof), so it has no roof at all
  const positions = [
    0, 0, 10, 4, 0, 10, 0, 4, 10, 0, 0, 10, 4, 0, 10, 0, 4, 14, 0, 0, 0, 4, 0,
    0, 0, 4, 0,
  ];
  markFlatRoofs(objects, {
    positions,
    objectIds: [0, 0, 0, 1, 1, 1, 2, 2, 2],
    isRoof: [1, 1, 1, 1, 1, 1, 0, 0, 0],
  });
  expect(objects.map((o) => o.flags)).toEqual([OBJECT_FLAG_FLAT_ROOF, 0, 128]);
});

test("markFlatRoofs: a step between roof levels clad as roof leaves it flat", () => {
  const objects = [{ flags: 0 }];
  // a level roof triangle and an upright one as large (a step's wall the
  // bake flags as roof): half the roof-flagged area, yet a flat roof
  const positions = [
    0, 0, 10, 4, 0, 10, 0, 4, 10, 0, 0, 10, 4, 0, 10, 0, 0, 14,
  ];
  markFlatRoofs(objects, {
    positions,
    objectIds: [0, 0, 0, 0, 0, 0],
    isRoof: [1, 1, 1, 1, 1, 1],
  });
  expect(objects[0].flags).toBe(OBJECT_FLAG_FLAT_ROOF);
});
