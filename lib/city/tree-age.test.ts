import { expect, test } from "bun:test";
import {
  type AgeLook,
  ageLook,
  OLD_YEARS,
  STAKED_YEARS,
  treeAge,
  YOUNG_YEARS,
} from "./tree-age";

test("a tree's age runs from its planting year; unknown stays unknown", () => {
  expect(treeAge(1979, 2026)).toBe(47);
  expect(treeAge(2030, 2026)).toBe(0);
  expect(treeAge(undefined, 2026)).toBeUndefined();
});

test("an unknown or mature tree looks as before", () => {
  const mature: AgeLook = { girth: 1, staked: false, leaf: [0, 0, 0] };
  expect(ageLook(undefined)).toEqual(mature);
  expect(ageLook(Number.NaN)).toEqual(mature);
  expect(ageLook(40)).toEqual(mature);
  expect(ageLook(YOUNG_YEARS)).toEqual(mature);
  expect(ageLook(OLD_YEARS)).toEqual(mature);
});

test("saplings are staked and thin; old trees broad-footed", () => {
  expect(ageLook(1).staked).toBe(true);
  expect(ageLook(STAKED_YEARS).staked).toBe(false);
  expect(ageLook(1).girth).toBeLessThan(ageLook(10).girth);
  expect(ageLook(200).girth).toBeGreaterThan(ageLook(100).girth);
  // continuous at the edges of the mature span
  expect(ageLook(YOUNG_YEARS - 0.01).girth).toBeCloseTo(1, 2);
  expect(ageLook(OLD_YEARS + 0.01).girth).toBeCloseTo(1, 2);
});

test("a young crown is lighter, an old one deeper", () => {
  expect(ageLook(1).leaf[2]).toBeGreaterThan(ageLook(10).leaf[2]);
  expect(ageLook(10).leaf[2]).toBeGreaterThan(0);
  expect(ageLook(200).leaf[2]).toBeLessThan(ageLook(100).leaf[2]);
  expect(ageLook(100).leaf[2]).toBeLessThan(0);
  expect(ageLook(YOUNG_YEARS - 0.01).leaf[2]).toBeCloseTo(0, 2);
});
