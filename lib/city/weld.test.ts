import { expect, test } from "bun:test";
import { packed, welded } from "./weld";

test("a quad's two triangles weld to four vertices", () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1,
  ]);
  const normals = new Int8Array(18).map((_, i) => (i % 3 === 1 ? 127 : 0));
  const w = welded(
    [
      [positions, 3],
      [normals, 3],
    ],
    6
  );
  expect(w.unique).toBe(4);
  expect([...w.indices]).toEqual([0, 1, 2, 0, 2, 3]);
  expect([...packed(positions, 3, w)]).toEqual([
    0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1,
  ]);
  expect(packed(normals, 3, w)).toBeInstanceOf(Int8Array);
});

test("vertices that differ in any attribute stay apart", () => {
  const positions = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const normals = new Int8Array([0, 127, 0, 127, 0, 0, 0, 127, 0]);
  const w = welded(
    [
      [positions, 3],
      [normals, 3],
    ],
    3
  );
  expect(w.unique).toBe(2);
  expect([...w.indices]).toEqual([0, 1, 0]);
});

test("the soup read through the index is the soup", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed % 5;
  };
  const count = 3000;
  const positions = Float32Array.from({ length: 3 * count }, random);
  const w = welded([[positions, 3]], count);
  const out = packed(positions, 3, w);
  expect(w.unique).toBeLessThan(count);
  for (let v = 0; v < count; v += 1) {
    for (let c = 0; c < 3; c += 1) {
      expect(out[3 * w.indices[v] + c]).toBe(positions[3 * v + c]);
    }
  }
});
