import { expect, test } from "bun:test";
import { signedDistanceField } from "./sdf";

/** A 32 × 32 coverage map with a filled square from 8 to 24. */
function square(): Uint8Array {
  const a = new Uint8Array(32 * 32);
  for (let y = 8; y < 24; y++) {
    for (let x = 8; x < 24; x++) {
      a[y * 32 + x] = 255;
    }
  }
  return a;
}

test("the field is high inside, low outside, mid at the edge", () => {
  const f = signedDistanceField(square(), 32, 32, 4);
  expect(f[16 * 32 + 16]).toBe(255);
  expect(f[0]).toBe(0);
  // the edge lies halfway between pixels 7 and 8
  expect((f[16 * 32 + 8] + f[16 * 32 + 7]) / 2).toBeCloseTo(127.5, 0);
  expect(f[16 * 32 + 8]).toBeGreaterThan(f[16 * 32 + 7]);
});

test("the field falls evenly with distance outside", () => {
  const f = signedDistanceField(square(), 32, 32, 8);
  const row = 16 * 32;
  const steps = [7, 6, 5, 4].map((x) => f[row + x] - f[row + x - 1]);
  for (const s of steps) {
    expect(s).toBeGreaterThan(10);
    expect(s).toBeLessThan(22);
  }
});

test("antialiased coverage moves the edge", () => {
  const a = square();
  const b = square();
  for (let y = 8; y < 24; y++) {
    b[y * 32 + 7] = 128;
  }
  const fa = signedDistanceField(a, 32, 32, 4);
  const fb = signedDistanceField(b, 32, 32, 4);
  expect(fb[16 * 32 + 6]).toBeGreaterThan(fa[16 * 32 + 6]);
});
