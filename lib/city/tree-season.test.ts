import { expect, test } from "bun:test";
import {
  dayOfYear,
  PHENOLOGY,
  phenologyOf,
  SEASON_JITTER_DAYS,
  seasonAt,
  seasonJitter,
  TREE_GENERA,
} from "./tree-season";

const LIME = TREE_GENERA.indexOf("Tilia");
const OAK = TREE_GENERA.indexOf("Quercus");
const GINKGO = TREE_GENERA.indexOf("Ginkgo");

test("every genus has a year whose phases are ordered and inside it", () => {
  expect(Object.keys(PHENOLOGY).length).toBe(TREE_GENERA.length);
  for (const g of TREE_GENERA) {
    const p = PHENOLOGY[g];
    for (const [a, b] of [p.leafOut, p.colour, p.fall]) {
      expect(a).toBeLessThan(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(365);
    }
    expect(p.leafOut[1]).toBeLessThanOrEqual(p.fall[0]);
    expect(p.leafOut[1]).toBeLessThanOrEqual(p.colour[0]);
    expect(p.hue.every((v) => v >= 0 && v <= 1)).toBe(true);
  }
});

test("a lime is bare in January, in full summer leaf in July, gone by December", () => {
  expect(seasonAt(10, LIME)).toEqual({ leaf: 0, autumn: 1 });
  expect(seasonAt(190, LIME)).toEqual({ leaf: 1, autumn: 0 });
  const oct15 = seasonAt(287, LIME);
  expect(oct15.autumn).toBe(1);
  expect(oct15.leaf).toBeGreaterThan(0);
  expect(oct15.leaf).toBeLessThan(1);
  expect(seasonAt(340, LIME).leaf).toBe(0);
});

test("leaf is monotone through leaf-out and leaf fall, autumn through colouring", () => {
  for (let g = 0; g < TREE_GENERA.length; g++) {
    const p = phenologyOf(g);
    let prev = -1;
    for (let d = p.leafOut[0]; d <= p.leafOut[1]; d += 0.5) {
      const { leaf } = seasonAt(d, g);
      expect(leaf).toBeGreaterThanOrEqual(prev);
      prev = leaf;
    }
    prev = 2;
    for (let d = p.fall[0]; d <= p.fall[1]; d += 0.5) {
      const { leaf } = seasonAt(d, g);
      expect(leaf).toBeLessThanOrEqual(prev);
      prev = leaf;
    }
    prev = -1;
    for (let d = p.colour[0]; d <= p.colour[1]; d += 0.5) {
      const { autumn } = seasonAt(d, g);
      expect(autumn).toBeGreaterThanOrEqual(prev);
      prev = autumn;
    }
  }
});

test("oaks hold their dead leaves through the winter; a ginkgo drops within days", () => {
  const winter = seasonAt(20, OAK);
  expect(winter.leaf).toBeCloseTo(0.3);
  expect(winter.autumn).toBe(1);
  const g = phenologyOf(GINKGO);
  expect(g.fall[1] - g.fall[0]).toBeLessThanOrEqual(7);
});

test("the year wraps: day 365 is day 0, and a negative day counts back", () => {
  for (const g of [0, LIME, OAK]) {
    expect(seasonAt(365, g)).toEqual(seasonAt(0, g));
    expect(seasonAt(-5, g)).toEqual(seasonAt(360, g));
    // continuous across New Year
    const a = seasonAt(364.9, g);
    const b = seasonAt(0.1, g);
    expect(Math.abs(a.leaf - b.leaf)).toBeLessThan(1e-6);
    expect(Math.abs(a.autumn - b.autumn)).toBeLessThan(1e-6);
  }
});

test("a positive jitter is a late tree; the jitter stays within its bound", () => {
  const p = phenologyOf(LIME);
  const mid = (p.leafOut[0] + p.leafOut[1]) / 2;
  expect(seasonAt(mid, LIME, 4).leaf).toBeLessThan(seasonAt(mid, LIME).leaf);
  expect(seasonJitter(0)).toBe(-SEASON_JITTER_DAYS);
  expect(seasonJitter(0.5)).toBe(0);
  expect(Math.abs(seasonJitter(0.999))).toBeLessThanOrEqual(SEASON_JITTER_DAYS);
});

test("an unknown genus index follows the generic curve", () => {
  expect(seasonAt(200, 999)).toEqual(seasonAt(200, 0));
});

// Dates built from local fields, as the HUD builds them: the assertions
// hold in every timezone the tests run in.
test("day of year is 0 on 1 January and folds 29 February", () => {
  expect(dayOfYear(new Date(2026, 0, 1))).toBe(0);
  expect(dayOfYear(new Date(2026, 9, 1))).toBe(273);
  expect(dayOfYear(new Date(2028, 2, 1))).toBe(59); // leap year
  expect(dayOfYear(new Date(2028, 1, 29, 12))).toBeCloseTo(58.5);
  expect(dayOfYear(new Date(2026, 11, 31, 12))).toBeCloseTo(364.5);
});

test("day of year follows the local calendar through the whole day", () => {
  // The HUD's scene date: local midnight plus the time-of-day slider. Every
  // minute of 1 October is day 273, whatever the UTC date of that instant.
  for (const minutes of [0, 30, 60 * 5, 60 * 12, 60 * 23 + 59]) {
    const date = new Date(2026, 9, 1, 0, minutes);
    expect(Math.floor(dayOfYear(date))).toBe(273);
  }
  expect(dayOfYear(new Date(2026, 9, 1, 6))).toBeCloseTo(273.25);
  // A daylight-saving night (Europe: 29 March, 25 October) is no shorter.
  expect(dayOfYear(new Date(2026, 2, 29, 12))).toBeCloseTo(87.5);
  expect(dayOfYear(new Date(2026, 9, 25, 12))).toBeCloseTo(297.5);
});
