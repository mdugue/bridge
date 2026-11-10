import { expect, test } from "bun:test";
import { halton, JITTER_COUNT, jitterOffset } from "./temporal-aa";

test("halton coordinates", () => {
  expect(halton(1, 2)).toBe(0.5);
  expect(halton(2, 2)).toBe(0.25);
  expect(halton(3, 2)).toBe(0.75);
  expect(halton(1, 3)).toBeCloseTo(1 / 3);
  expect(halton(2, 3)).toBeCloseTo(2 / 3);
});

test("the jitter stays within the pixel, cycles, and averages near its middle", () => {
  let sx = 0;
  let sy = 0;
  for (let f = 0; f < JITTER_COUNT; f += 1) {
    const [x, y] = jitterOffset(f);
    expect(Math.abs(x)).toBeLessThan(0.5);
    expect(Math.abs(y)).toBeLessThan(0.5);
    expect(jitterOffset(f + JITTER_COUNT)).toEqual([x, y]);
    sx += x;
    sy += y;
  }
  expect(Math.abs(sx / JITTER_COUNT)).toBeLessThan(0.1);
  expect(Math.abs(sy / JITTER_COUNT)).toBeLessThan(0.1);
});
