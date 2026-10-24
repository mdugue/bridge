import { expect, test } from "bun:test";
import type { Level } from "./levels";
import {
  decodeProfile,
  encodeProfile,
  lineProfile,
  PROFILE_RADIUS,
  profileOptions,
} from "./line-profile";

const STEP = 4;
const d = Array.from({ length: 200 }, (_, i) => i * STEP);

/** The worst grade and change of grade (m per step) of a profile. */
function worst(z: (number | null)[]) {
  let grade = 0;
  let bend = 0;
  for (let i = 1; i < z.length; i++) {
    grade = Math.max(grade, Math.abs((z[i] ?? 0) - (z[i - 1] ?? 0)) / STEP);
  }
  for (let i = 1; i + 1 < z.length; i++) {
    bend = Math.max(
      bend,
      Math.abs((z[i + 1] ?? 0) - 2 * (z[i] ?? 0) + (z[i - 1] ?? 0))
    );
  }
  return { grade, bend };
}

test("a bump of the DGM a few metres long barely lifts the profile", () => {
  // a rail on level ground, the DGM rounding a platform's edge into a
  // 0.6 m hump 8 m long
  const levels: Level[] = d.map((x) => ({
    mode: "ground",
    y: x >= 400 && x < 408 ? 100.6 : 100,
  }));
  const z = lineProfile(levels, d, profileOptions("rail"));
  expect(Math.max(...z.map((v) => v ?? 0))).toBeLessThan(100.15);
  expect(z[0]).toBeCloseTo(100, 2);
});

test("the profile keeps its grade and rounds every change of grade", () => {
  // a 6 % ramp the DGM shows beside a bridge's abutment: steeper than a
  // main line climbs, a kink at each end
  const levels: Level[] = d.map((x) => ({
    mode: "ground",
    y: 100 + Math.min(Math.max(x - 300, 0), 50) * 0.06,
  }));
  const z = lineProfile(levels, d, profileOptions("rail"));
  const w = worst(z);
  expect(w.grade).toBeLessThanOrEqual(0.04 * 1.02);
  expect(w.bend).toBeLessThanOrEqual(
    ((STEP * STEP) / PROFILE_RADIUS.rail) * 1.05
  );
});

test("on a deck the profile is the deck's top, the approaches meet it", () => {
  const levels: Level[] = d.map((x) =>
    x >= 300 && x < 400
      ? { mode: "deck", y: 101.5 }
      : { mode: "ground", y: 100 }
  );
  const z = lineProfile(levels, d, profileOptions("rail"));
  for (let i = 0; i < d.length; i++) {
    if (levels[i].mode === "deck") {
      expect(z[i] ?? 0).toBeCloseTo(101.5, 2);
    }
  }
  // the approach climbs to it: a metre short of the deck end it is
  // already well above the ground
  expect(z[74] ?? 0).toBeGreaterThan(101);
});

test("a break in the levels breaks the profile", () => {
  const levels: (Level | null)[] = d.map((_, i) =>
    i === 50 ? null : { mode: "ground", y: 100 }
  );
  const z = lineProfile(levels, d, profileOptions("tram"));
  expect(z[50]).toBeNull();
  expect(z[49]).toBeCloseTo(100, 3);
});

test("a profile round-trips through its centimetre encoding", () => {
  const z = [101.234, 101.25, null, 99.991, 100.004];
  const lz = encodeProfile(z);
  expect(lz).toEqual([10123, 2, null, 9999, 1]);
  expect(decodeProfile(lz)).toEqual([101.23, 101.25, null, 99.99, 100]);
});
