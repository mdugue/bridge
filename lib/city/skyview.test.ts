import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DRESDEN } from "../../sites/dresden";
import {
  facadeSkyView,
  farSunVisibility,
  HORIZON_AZIMUTHS,
  HORIZON_FAR_M,
  HORIZON_MAX_DEG,
  HORIZON_NEAR_M,
  HORIZON_PX,
  horizonBracket,
  horizonTexel,
  sunAngles,
} from "./skyview";
import { tileIds } from "./tile";

const DATA = join(import.meta.dir, "..", "..", "data", "dlm");

test("the committed horizon legends match the constants the shader uses", () => {
  let checked = 0;
  for (const tile of tileIds(DRESDEN)) {
    const path = join(DATA, `horizon_${tile}.json`);
    if (!existsSync(path)) {
      continue;
    }
    const legend = JSON.parse(readFileSync(path, "utf8")) as {
      azimuthsDeg: number[];
      degPerUnit: number;
      farM: number;
      nearM: number;
      px: number;
    };
    expect(legend.azimuthsDeg).toEqual(
      Array.from({ length: HORIZON_AZIMUTHS }, (_, k) => k * 22.5)
    );
    expect(legend.degPerUnit).toBeCloseTo(HORIZON_MAX_DEG / 255, 9);
    expect(legend.px).toBe(HORIZON_PX);
    expect(legend.nearM).toBe(HORIZON_NEAR_M);
    expect(legend.farM).toBe(HORIZON_FAR_M);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test("the sun's azimuth runs clockwise from north in the data frame", () => {
  // world −z is data north, world +x east
  expect(sunAngles({ x: 0, y: 0, z: -1 }).azimuthDeg).toBeCloseTo(0, 9);
  expect(sunAngles({ x: 1, y: 0, z: 0 }).azimuthDeg).toBeCloseTo(90, 9);
  expect(sunAngles({ x: 0, y: 0, z: 1 }).azimuthDeg).toBeCloseTo(180, 9);
  expect(sunAngles({ x: -1, y: 0, z: 0 }).azimuthDeg).toBeCloseTo(270, 9);
  const s = Math.SQRT1_2;
  expect(sunAngles({ x: 0, y: s, z: s }).elevationDeg).toBeCloseTo(45, 9);
});

test("a sun azimuth is bracketed by its two neighbouring planes", () => {
  expect(horizonBracket(0)).toEqual({ lower: 0, upper: 1, t: 0 });
  const b = horizonBracket(350);
  expect(b.lower).toBe(15);
  expect(b.upper).toBe(0);
  expect(b.t).toBeCloseTo((350 - 337.5) / 22.5, 9);
  expect(horizonTexel(6)).toEqual({ layer: 1, channel: 2 });
});

test("the sun fades out across the horizon angle, not at it", () => {
  expect(farSunVisibility(10, 20)).toBe(1);
  expect(farSunVisibility(10, 5)).toBe(0);
  expect(farSunVisibility(10, 10)).toBeCloseTo(0.5, 9);
});

test("a facade sees the full sky in an open street and from its eaves", () => {
  expect(facadeSkyView(0.5, 0, 12)).toBe(1);
  expect(facadeSkyView(0.2, 0, 12)).toBeCloseTo(0.4, 9);
  expect(facadeSkyView(0.2, 12, 12)).toBe(1);
  expect(facadeSkyView(0.2, 6, 12)).toBeCloseTo(0.7, 9);
});
