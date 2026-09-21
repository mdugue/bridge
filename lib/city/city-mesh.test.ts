import { expect, test } from "bun:test";
import {
  buildDetailAttributes,
  type CityMeshMeta,
  type CityMeshObject,
  countBuildings,
  decodeCityMesh,
  doomedObjects,
  encodeCityMesh,
  filterVertices,
  footprintPolys,
  parseCityMeshMeta,
} from "./city-mesh";

function obj(
  partial: Partial<CityMeshObject> & { id: string }
): CityMeshObject {
  return {
    baseZ: 100,
    eaveH: 9,
    footprints: [],
    glow: 0,
    roof: [0.5, 0.2, 0.1],
    root: 0,
    rough: 0.3,
    storeyH: 3,
    tint: [0.8, 0.8, 0.7],
    type: "Building",
    ...partial,
  };
}

const objects: CityMeshObject[] = [
  obj({
    id: "b1",
    root: 0,
    footprints: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ],
  }),
  obj({ id: "b1-part", root: 0, type: "BuildingPart", glow: 1 }),
  obj({
    id: "b2",
    root: 2,
    footprints: [
      [
        [5, 5],
        [6, 5],
        [6, 6],
      ],
    ],
  }),
];

test("encode/decode round-trips positions to the quantisation step", () => {
  const vertices = {
    positions: new Float32Array([0, 0, 100, 10.004, 0, 105.123, 0, 20, 100]),
    objectIds: new Uint16Array([0, 1, 2]),
    isRoof: new Uint8Array([0, 1, 0]),
  };
  const { bytes, quant } = encodeCityMesh(vertices);
  expect(bytes.byteLength).toBe(3 * 9);
  const back = decodeCityMesh(bytes.buffer as ArrayBuffer, {
    quant,
    vertexCount: 3,
  });
  for (let i = 0; i < 9; i++) {
    expect(back.positions[i]).toBeCloseTo(vertices.positions[i], 1);
  }
  expect(Array.from(back.objectIds)).toEqual([0, 1, 2]);
  expect(Array.from(back.isRoof)).toEqual([0, 1, 0]);
});

test("decode rejects a buffer of the wrong length", () => {
  expect(() =>
    decodeCityMesh(new ArrayBuffer(10), {
      quant: { origin: [0, 0, 0], scale: [1, 1, 1] },
      vertexCount: 2,
    })
  ).toThrow(/expected 18 bytes, got 10/);
});

test("buildDetailAttributes expands the object table per vertex", () => {
  const attrs = buildDetailAttributes(
    { objects },
    { objectIds: new Uint16Array([1, 2]), isRoof: new Uint8Array([1, 0]) }
  );
  // roof vertex of the part: roof colour, isRoof = 1, glow = 1
  expect(attrs.tint[0]).toBeCloseTo(0.5);
  expect(attrs.tint[1]).toBeCloseTo(0.2);
  expect(attrs.tint[2]).toBeCloseTo(0.1);
  expect(Array.from(attrs.build.slice(0, 4))).toEqual([1, 3, 9, 1]);
  // wall vertex of b2: wall colour, isRoof = 0
  expect(attrs.tint[3]).toBeCloseTo(0.8);
  expect(attrs.build[4]).toBe(0);
  expect(attrs.baseZ[1]).toBe(100);
  expect(attrs.rough[1]).toBeCloseTo(0.3);
});

test("doomedObjects takes the whole building tree", () => {
  expect(
    Array.from(doomedObjects({ objects }, 1)).sort((a, b) => a - b)
  ).toEqual([0, 1]);
  expect(Array.from(doomedObjects({ objects }, 2))).toEqual([2]);
  expect(doomedObjects({ objects }, 99).size).toBe(0);
});

test("filterVertices drops the doomed objects' vertices", () => {
  const v = {
    positions: new Float32Array([1, 1, 1, 2, 2, 2, 3, 3, 3]),
    objectIds: new Uint16Array([0, 1, 2]),
    isRoof: new Uint8Array([0, 1, 0]),
  };
  const doomed = doomedObjects({ objects }, 1);
  const kept = filterVertices(v, (i) => !doomed.has(i));
  expect(Array.from(kept.objectIds)).toEqual([2]);
  expect(Array.from(kept.positions)).toEqual([3, 3, 3]);
});

test("countBuildings and footprintPolys follow the alive set", () => {
  const all = () => true;
  expect(countBuildings({ objects }, all)).toBe(2);
  expect(footprintPolys({ objects }, all)).toHaveLength(2);
  const doomed = doomedObjects({ objects }, 0);
  const alive = (i: number) => !doomed.has(i);
  expect(countBuildings({ objects }, alive)).toBe(1);
  expect(footprintPolys({ objects }, alive)[0].pts[0]).toEqual([5, 5]);
});

test("parseCityMeshMeta validates the structure", () => {
  const meta: CityMeshMeta = {
    version: 1,
    tile: "t",
    epsg: 25_833,
    offset: { cx: 1, cy: 2 },
    quant: { origin: [0, 0, 0], scale: [1, 1, 1] },
    vertexCount: 0,
    objects: [],
  };
  expect(parseCityMeshMeta(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
  expect(() => parseCityMeshMeta({ ...meta, version: 2 })).toThrow(/version/);
  expect(() => parseCityMeshMeta({ ...meta, offset: {} })).toThrow(/offset/);
  expect(() => parseCityMeshMeta({ ...meta, vertexCount: -1 })).toThrow(
    /vertexCount/
  );
});
