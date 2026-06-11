import { expect, test } from "bun:test";
import { atmosphereAt, lerpHexColor } from "./atmosphere";

test("lerpHexColor blends channel-wise and clamps t", () => {
  expect(lerpHexColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  expect(lerpHexColor("#102030", "#102030", 0.7)).toBe("#102030");
  expect(lerpHexColor("#000000", "#ffffff", -1)).toBe("#000000");
  expect(lerpHexColor("#000000", "#ffffff", 2)).toBe("#ffffff");
});

test("atmosphereAt clamps to the night palette below the lowest stop", () => {
  expect(atmosphereAt(-90)).toEqual(atmosphereAt(-18));
});

test("atmosphereAt clamps to the day palette above the highest stop", () => {
  expect(atmosphereAt(89)).toEqual(atmosphereAt(60));
});

test("atmosphereAt blends smoothly between stops", () => {
  const dusk = atmosphereAt(-1.5); // between -4 and 1
  const night = atmosphereAt(-18);
  const day = atmosphereAt(60);
  expect(dusk).not.toEqual(night);
  expect(dusk).not.toEqual(day);
  // Valid hex output.
  expect(dusk.fog).toMatch(/^#[0-9a-f]{6}$/);
  expect(dusk.hemiSky).toMatch(/^#[0-9a-f]{6}$/);
  expect(dusk.hemiGround).toMatch(/^#[0-9a-f]{6}$/);
});

test("day fog is brighter than night fog", () => {
  const day = Number.parseInt(atmosphereAt(45).fog.slice(1, 3), 16);
  const night = Number.parseInt(atmosphereAt(-18).fog.slice(1, 3), 16);
  expect(day).toBeGreaterThan(night);
});
