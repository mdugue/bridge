import { expect, test } from "bun:test";
import { HORIZON_PX } from "./skyview";
import {
  BARE_LIGHT,
  type Crown,
  DEFAULT_RECIPE,
  germanOffsetHours,
  horizonDeg,
  type HorizonRaster,
  LEAF_ON_LIGHT,
  leafLight,
  MAX_POINTS,
  parseRecipe,
  placePoints,
  placeView,
  rayHitsCrown,
  recipeText,
  recipeTitle,
  shadePlace,
  type SunSample,
  sunSamples,
} from "./sun-study";

const DRESDEN = { lat: 51.05, lng: 13.74 };

/** The sun due south at `el`° in high summer. */
function south(el: number): SunSample {
  return {
    az: 180,
    el,
    ux: 0,
    uy: -1,
    tanEl: Math.tan((el * Math.PI) / 180),
    leafLight: LEAF_ON_LIGHT,
    day: 0,
  };
}

test("a recipe goes into the link and comes back", () => {
  const r = { ...DEFAULT_RECIPE, x: 412345.4, y: 5658765.6 };
  expect(recipeText(r)).toBe("sommer_11-17_spielplatz_1000m_412345_5658766");
  expect(parseRecipe(recipeText(r))).toEqual({
    ...DEFAULT_RECIPE,
    x: 412345,
    y: 5658766,
  });
  expect(parseRecipe("herbst_8-12_bank_500m")).toEqual({
    period: "herbst",
    from: 8,
    to: 12,
    what: "bank",
    radius: 500,
  });
  expect(parseRecipe("1")).toEqual(DEFAULT_RECIPE);
  expect(parseRecipe("sommer_17-11_spielplatz_1000m")).toEqual(DEFAULT_RECIPE);
  expect(parseRecipe(null)).toBeNull();
  expect(recipeTitle(DEFAULT_RECIPE)).toBe(
    "Schattigste Spielplätze im Sommer, 11–17 Uhr"
  );
});

test("the city's clock keeps summer time from March's last Sunday to October's", () => {
  expect(germanOffsetHours(Date.UTC(2026, 6, 1, 12))).toBe(2);
  expect(germanOffsetHours(Date.UTC(2026, 0, 15, 12))).toBe(1);
  // 2026: 29 March and 25 October, 01:00 UTC
  expect(germanOffsetHours(Date.UTC(2026, 2, 29, 0, 59))).toBe(1);
  expect(germanOffsetHours(Date.UTC(2026, 2, 29, 1))).toBe(2);
  expect(germanOffsetHours(Date.UTC(2026, 9, 25, 0, 59))).toBe(2);
  expect(germanOffsetHours(Date.UTC(2026, 9, 25, 1))).toBe(1);
});

test("crowns are bare in winter and in leaf in summer", () => {
  expect(leafLight(15)).toBe(BARE_LIGHT);
  expect(leafLight(190)).toBe(LEAF_ON_LIGHT);
  expect(leafLight(350)).toBe(BARE_LIGHT);
  expect(leafLight(120)).toBeGreaterThan(LEAF_ON_LIGHT);
  expect(leafLight(120)).toBeLessThan(BARE_LIGHT);
});

test("a summer afternoon window samples a high sun every 20 minutes", () => {
  const { samples, days, stepHours } = sunSamples(
    DEFAULT_RECIPE,
    DRESDEN.lat,
    DRESDEN.lng,
    2026
  );
  expect(days).toBe(13);
  expect(stepHours).toBeCloseTo(1 / 3);
  expect(samples.length).toBe(13 * 18);
  expect(Math.min(...samples.map((s) => s.el))).toBeGreaterThan(25);
  // south at solar noon, about 13:15 summer time in Dresden
  const noonish = samples.filter((s) => s.day === 3);
  const highest = noonish.reduce((a, b) => (b.el > a.el ? b : a));
  expect(Math.abs(highest.az - 180)).toBeLessThan(10);
});

test("the horizon reads the higher band, between two azimuths", () => {
  const data = new Uint8Array(HORIZON_PX * 4 * HORIZON_PX * 8);
  const raster: HorizonRaster = {
    data,
    minX: 0,
    maxY: 2000,
    size: 2000,
  };
  // azimuth 8 (180°) of the near band (planes 4–7) at the north-west
  // texel: plane 4 + 2, channel 0
  data[(6 * HORIZON_PX + 0) * HORIZON_PX * 4 + 0] = 255;
  // the far band, same texel, azimuth 9: plane 2, channel 1, 30°
  data[(2 * HORIZON_PX + 0) * HORIZON_PX * 4 + 1] = Math.round((30 / 45) * 255);
  expect(horizonDeg(raster, 1, 1999, 180)).toBeCloseTo(90, 5);
  expect(horizonDeg(raster, 1, 1999, 180 + 11.25)).toBeCloseTo(45, 5);
  expect(horizonDeg(raster, 1, 1999, 202.5)).toBeCloseTo(30, 0);
  expect(horizonDeg(raster, 20, 1999, 180)).toBe(0);
});

test("a ray toward the sun passes through a crown in its way, and over one too low", () => {
  const tall: Crown = { x: 0, y: -5, base: 3, top: 9, r: 3, evergreen: false };
  const low: Crown = { x: 0, y: -5, base: 1.5, top: 3, r: 2, evergreen: false };
  const behind: Crown = { x: 0, y: 5, base: 3, top: 9, r: 3, evergreen: false };
  const aside: Crown = { x: 4, y: -5, base: 3, top: 9, r: 3, evergreen: false };
  expect(rayHitsCrown(0, 0, south(45), tall)).toBe(true);
  expect(rayHitsCrown(0, 0, south(45), low)).toBe(false);
  expect(rayHitsCrown(0, 0, south(45), behind)).toBe(false);
  expect(rayHitsCrown(0, 0, south(45), aside)).toBe(false);
  // the low sun reaches under the tall crown's base
  expect(rayHitsCrown(0, 0, south(5), tall)).toBe(false);
});

test("an open place is all sun; one under a wide crown keeps the leaves' light", () => {
  const recipe = DEFAULT_RECIPE;
  const { samples, days, stepHours } = sunSamples(
    recipe,
    DRESDEN.lat,
    DRESDEN.lng,
    2026
  );
  const square = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as [number, number][],
  ];
  const place = { id: 1, rings: square, x: 5, y: 5 };
  const open = shadePlace(place, samples, { days, stepHours }, () => null, []);
  expect(open.shade).toBe(0);
  expect(open.sunHours).toBeCloseTo(6, 5);
  expect(open.area).toBe(100);
  const roof: Crown = { x: 5, y: 5, base: 3, top: 23, r: 40, evergreen: false };
  const under = shadePlace(place, samples, { days, stepHours }, () => null, [
    roof,
  ]);
  expect(under.shade).toBeCloseTo(1 - LEAF_ON_LIGHT, 5);
  expect(under.low).toBeCloseTo(under.high, 5);
});

test("a place is sampled on a grid inside its outline, at most MAX_POINTS", () => {
  const big = [
    [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ] as [number, number][],
  ];
  const points = placePoints(big);
  expect(points.length).toBeLessThanOrEqual(MAX_POINTS);
  expect(points.length).toBeGreaterThan(MAX_POINTS * 0.8);
  expect(points.every(([x, y]) => x > 0 && x < 200 && y > 0 && y < 100)).toBe(
    true
  );
  const tiny = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ] as [number, number][],
  ];
  expect(placePoints(tiny).length).toBe(1);
});

test("a picked place is seen from the air, from the side the camera comes", () => {
  const v = placeView({ x: 1000, y: 2000 }, { x: 1000, y: 1000 });
  expect(v.epsg).toEqual({ x: 1000, y: 1930 });
  expect(v.headingDeg).toBe(0);
  expect(v.pitchDeg).toBeLessThan(-25);
  expect(v.mode).toBe("fly");
  // standing on it: from the south
  expect(placeView({ x: 5, y: 5 }, { x: 5, y: 5 }).epsg).toEqual({
    x: 5,
    y: -65,
  });
});
