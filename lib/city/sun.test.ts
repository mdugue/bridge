import { expect, test } from "bun:test";
import SunCalc from "suncalc";
import { enuToWorld, sunDirectionEnu, sunDirectionWorld } from "./sun";

// Dresden city center.
const LAT = 51.05;
const LNG = 13.74;

test("enuToWorld maps East=+X, Up=+Y, North=-Z", () => {
  expect(enuToWorld({ east: 1, north: 0, up: 0 })).toEqual({
    x: 1,
    y: 0,
    z: -0,
  });
  expect(enuToWorld({ east: 0, north: 1, up: 0 })).toEqual({
    x: 0,
    y: 0,
    z: -1,
  });
  expect(enuToWorld({ east: 0, north: 0, up: 1 })).toEqual({
    x: 0,
    y: 1,
    z: -0,
  });
});

test("sunDirectionEnu yields a unit vector", () => {
  const { east, north, up } = sunDirectionEnu(
    new Date("2026-06-21T12:00:00Z"),
    LAT,
    LNG
  );
  expect(Math.hypot(east, north, up)).toBeCloseTo(1, 6);
});

test("at local solar noon the sun is due south and above the horizon", () => {
  const noon = SunCalc.getTimes(
    new Date("2026-06-21T12:00:00Z"),
    LAT,
    LNG
  ).solarNoon;
  const dir = sunDirectionWorld(noon, LAT, LNG);
  // Above the horizon, well up in June.
  expect(dir.y).toBeGreaterThan(0.5);
  // Due south: in world coords North=-Z, so "toward the sun" has z > 0 ...
  expect(dir.z).toBeGreaterThan(0);
  // ... and essentially no east-west component.
  expect(Math.abs(dir.x)).toBeLessThan(0.02);
});

test("at midnight the sun is below the horizon", () => {
  const nadir = SunCalc.getTimes(
    new Date("2026-06-21T12:00:00Z"),
    LAT,
    LNG
  ).nadir;
  expect(sunDirectionWorld(nadir, LAT, LNG).y).toBeLessThan(0);
});

test("in the morning the sun stands to the east (+X)", () => {
  const { sunrise, solarNoon } = SunCalc.getTimes(
    new Date("2026-06-21T12:00:00Z"),
    LAT,
    LNG
  );
  const midMorning = new Date((sunrise.getTime() + solarNoon.getTime()) / 2);
  expect(sunDirectionWorld(midMorning, LAT, LNG).x).toBeGreaterThan(0.3);
});
