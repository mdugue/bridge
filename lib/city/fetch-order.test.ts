import { expect, test } from "bun:test";
import { fetchRank } from "./fetch-order";

const tile = [412_000, 5_656_000, 414_000, 5_658_000] as const;

test("a tile the eye stands on ranks first", () => {
  expect(fetchRank(tile, { e: 413_000, n: 5_657_000 })).toBe(0);
  expect(fetchRank(tile, { e: 412_000, n: 5_658_000 })).toBe(0);
});

test("a tile farther off ranks behind a nearer one", () => {
  const beside = fetchRank(tile, { e: 414_500, n: 5_657_000 });
  const diagonal = fetchRank(tile, { e: 415_000, n: 5_659_000 });
  expect(beside).toBe(500);
  expect(diagonal).toBeCloseTo(Math.hypot(1000, 1000), 6);
  expect(beside).toBeLessThan(diagonal);
});
