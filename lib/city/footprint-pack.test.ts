import { expect, test } from "bun:test";
import {
  packFootprints,
  readFootprints,
  ringsOf,
  unpackedFootprints,
} from "./footprint-pack";

const footprints: [number, number][][][] = [
  [
    [
      [411_234.56, 5_656_000.01],
      [411_240.5, 5_656_000.01],
      [411_240.5, 5_656_010],
    ],
  ],
  // an object without a footprint (a dormer, a plinth)
  [],
  [
    [
      [409_999.99, 5_654_123.45],
      [410_010, 5_654_123.45],
      [410_010, 5_654_130.07],
      [409_999.99, 5_654_130.07],
    ],
    [
      [410_100, 5_654_200],
      [410_101, 5_654_200],
      [410_101, 5_654_201],
    ],
  ],
];

test("packed footprints read back as the bake wrote them, to the centimetre", () => {
  const pack = readFootprints(packFootprints(footprints));
  expect(pack).not.toBeNull();
  if (!pack) {
    return;
  }
  expect(unpackedFootprints(pack)).toEqual(footprints);
  expect([...pack.objectEnd]).toEqual([1, 1, 3]);
  expect([...pack.ringEnd]).toEqual([3, 7, 10]);
  expect(ringsOf(pack, 1)).toEqual([]);
  expect(ringsOf(pack, 2)[1][0]).toEqual([410_100, 5_654_200]);
});

test("a tile without buildings packs to its header", () => {
  const bytes = packFootprints([]);
  expect(bytes.byteLength).toBe(16);
  expect(readFootprints(bytes)?.xy).toHaveLength(0);
});

test("bytes that are not a footprint file read as none", () => {
  const bytes = packFootprints(footprints);
  expect(readFootprints(bytes.subarray(0, bytes.byteLength - 4))).toBeNull();
  expect(readFootprints(new TextEncoder().encode("[[[[1,2]]]]"))).toBeNull();
  expect(readFootprints(new ArrayBuffer(0))).toBeNull();
  // a view into a larger buffer reads from its own start
  const padded = new Uint8Array(bytes.byteLength + 8);
  padded.set(bytes, 8);
  expect(readFootprints(padded.subarray(8))?.objectEnd).toHaveLength(3);
});
