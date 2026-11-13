import { expect, test } from "bun:test";
import { appended, streamWriter } from "./vertex-stream";
import type { CityVertices } from "./vertex-stream";

/** Two triangles of objects 0 and 1, the first a roof with its colour. */
const stream = (): CityVertices => ({
  positions: Float32Array.from({ length: 18 }, (_, i) => i),
  objectIds: new Float32Array([0, 0, 0, 1, 1, 1]),
  isRoof: new Float32Array([1, 1, 1, 0, 0, 0]),
  // (the roof colours cover the stream's start only)
  roofRgb: new Float32Array(9).fill(0.5),
  surfaces: new Float32Array([0, 4, 0, 4, 0, 4, 0, 7, 0, 7, 0, 7]),
});

const tri = [100, 101, 102, 103, 104, 105, 106, 107, 108];

test("appended parts follow the stream, flat unless one brings normals", () => {
  const flat = appended(stream(), [
    { id: 2, positions: tri },
    { id: [3, 3, 3], isRoof: [1, 1, 1], positions: tri },
  ]);
  expect(Array.from(flat.objectIds)).toEqual([
    0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3,
  ]);
  expect(Array.from(flat.isRoof.subarray(6))).toEqual([0, 0, 0, 1, 1, 1]);
  expect(Array.from(flat.positions.subarray(18, 27))).toEqual(tri);
  expect(flat.normals).toBeUndefined();
  // the roof colours stay the start's; the loader's surfaces are not carried
  expect(flat.roofRgb).toHaveLength(9);
  expect(flat.surfaces).toBeUndefined();

  const up = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  const shaded = appended(stream(), [
    { id: 2, positions: tri },
    { id: 3, normals: up, positions: tri },
  ]);
  expect(shaded.normals).toHaveLength(36);
  expect(Array.from(shaded.normals?.subarray(0, 27) ?? [])).toEqual(
    Array.from({ length: 27 }, () => Number.NaN)
  );
  expect(Array.from(shaded.normals?.subarray(27) ?? [])).toEqual(up);
});

test("a written stream keeps what it copies and leaves the rest unset", () => {
  const v = stream();
  const out = streamWriter(v);
  out.copy(3, 3);
  out.add(tri, 1, { like: 3 });
  out.copy(0, 3);
  out.add(tri, 5, { isRoof: 1 });
  const w = out.done();
  expect(Array.from(w.objectIds)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 5, 5, 5]);
  expect(Array.from(w.isRoof)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  expect(Array.from(w.positions.subarray(0, 9))).toEqual([
    9, 10, 11, 12, 13, 14, 15, 16, 17,
  ]);
  // past the roof colours' end and on new triangles: none
  expect(Array.from(w.roofRgb ?? [])).toEqual([
    ...Array.from({ length: 18 }, () => Number.NaN),
    ...Array.from({ length: 9 }, () => 0.5),
    ...Array.from({ length: 9 }, () => Number.NaN),
  ]);
  // a new triangle lies on the surface of the vertex it is like, or on none
  expect(Array.from(w.surfaces ?? [])).toEqual([
    0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 7, 0, 4, 0, 4, 0, 4, -1, -1, -1, -1, -1,
    -1,
  ]);
  expect(w.normals).toBeUndefined();
});

test("a writer told so carries normals and colours the stream had none of", () => {
  const { roofRgb: _, ...bare } = stream();
  const out = streamWriter(bare, {
    normals: true,
    roofRgb: true,
    surfaces: false,
  });
  out.copy(0, 3);
  out.add(tri, 1, {
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    roofRgb: [1, 0, 0, 1, 0, 0, 1, 0, 0],
  });
  const w = out.done();
  expect(w.surfaces).toBeUndefined();
  expect(Number.isNaN(w.normals?.[0])).toBe(true);
  expect(Array.from(w.normals?.subarray(9) ?? [])).toEqual([
    0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  expect(Number.isNaN(w.roofRgb?.[8])).toBe(true);
  expect(w.roofRgb?.[9]).toBe(1);
});

test("a stream grows past the room it began with", () => {
  const out = streamWriter(stream());
  for (let i = 0; i < 50; i += 1) {
    out.add(tri, i);
  }
  const w = out.done();
  expect(w.objectIds).toHaveLength(150);
  expect(w.objectIds[149]).toBe(49);
  expect(Array.from(w.positions.subarray(441))).toEqual(tri);
});
