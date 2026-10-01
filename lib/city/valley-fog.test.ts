import { expect, test } from "bun:test";
import {
  groundRelief,
  VALLEY_FALLOFF_MAX,
  VALLEY_FALLOFF_MIN,
  valleyFalloff,
} from "./valley-fog";

test("the relief is the river and the typical high ground, not the extremes", () => {
  const heights = [
    -40,
    ...Array.from({ length: 98 }, (_, i) => 100 + i * 0.5),
    900,
  ];
  const [low, high] = groundRelief(heights);
  expect(low).toBeCloseTo(100.5, 5);
  expect(high).toBeCloseTo(144.5, 5);
});

test("a valley keeps the tuned pool, a flat site gets a shallow one", () => {
  // Dresden: the Elbe at 105 m, the Heide's slopes at 195 m
  expect(valleyFalloff([105, 195])).toBe(VALLEY_FALLOFF_MAX);
  // Hamburg: the harbour at 2 m, the Geest at 18 m
  expect(valleyFalloff([2, 18])).toBeCloseTo(9.6, 5);
  expect(valleyFalloff([500, 501])).toBe(VALLEY_FALLOFF_MIN);
  expect(valleyFalloff(undefined)).toBe(VALLEY_FALLOFF_MAX);
});
