import { expect, test } from "bun:test";
import {
  atmosphereAt,
  fogRangeFor,
  lerpHexColor,
  PHONE_STREAM_FAR_M,
  streamFarFor,
} from "./atmosphere";

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
  const rgb = (hex: string) =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const keys = ["fog", "hemiSky", "hemiGround"] as const;
  // -1.5 lies between the blue-hour stop (-2) and the sunrise one (1)
  const lo = atmosphereAt(-2);
  const hi = atmosphereAt(1);
  const dusk = atmosphereAt(-1.5);
  for (const key of keys) {
    expect(dusk[key]).toMatch(/^#[0-9a-f]{6}$/);
    expect(dusk[key]).not.toBe(lo[key]);
    expect(dusk[key]).not.toBe(hi[key]);
    // each channel on its way from one stop's to the other's
    for (const [i, v] of rgb(dusk[key]).entries()) {
      const [a, b] = [rgb(lo[key])[i], rgb(hi[key])[i]];
      expect(v).toBeGreaterThanOrEqual(Math.min(a, b));
      expect(v).toBeLessThanOrEqual(Math.max(a, b));
    }
  }
  // no jump at a stop: either side of it within a step of each channel
  for (const at of [-4, -2, 1, 6, 12]) {
    for (const key of keys) {
      const [below, above] = [at - 1e-6, at + 1e-6].map((x) =>
        rgb(atmosphereAt(x)[key])
      );
      for (const [i, v] of rgb(atmosphereAt(at)[key]).entries()) {
        expect(Math.abs(below[i] - v)).toBeLessThanOrEqual(1);
        expect(Math.abs(above[i] - v)).toBeLessThanOrEqual(1);
      }
    }
  }
});

test("day fog is brighter than night fog", () => {
  const day = Number.parseInt(atmosphereAt(45).fog.slice(1, 3), 16);
  const night = Number.parseInt(atmosphereAt(-18).fog.slice(1, 3), 16);
  expect(day).toBeGreaterThan(night);
});

test("fogRangeFor: more atmosphere pulls the fog closer, clamped to [0,1]", () => {
  const clear = fogRangeFor(0);
  const mid = fogRangeFor(0.5);
  const dense = fogRangeFor(1);
  expect(mid.near).toBeLessThan(clear.near);
  expect(dense.near).toBeLessThan(mid.near);
  expect(mid.far).toBeLessThan(clear.far);
  expect(dense.far).toBeLessThan(mid.far);
  // Always a valid range.
  for (const r of [clear, mid, dense]) {
    expect(r.far).toBeGreaterThan(r.near);
  }
  expect(fogRangeFor(-5)).toEqual(clear);
  expect(fogRangeFor(5)).toEqual(dense);
});

test("streamFarFor: the fog's end plus a margin, never past the camera's far", () => {
  const fogFar = fogRangeFor(0.2).far;
  expect(streamFarFor(fogFar, 6000)).toBeGreaterThan(fogFar);
  expect(streamFarFor(fogFar, 6000)).toBeLessThan(fogFar * 1.25);
  // the clearest fog's end with its margin stays inside the camera
  expect(streamFarFor(fogRangeFor(0).far, 4200)).toBe(4200);
});

test("streamFarFor: a phone's stream ends at the fine level's reach, inside a thicker fog's", () => {
  const fogFar = fogRangeFor(0.2).far;
  expect(streamFarFor(fogFar, 6000, "mobile")).toBe(PHONE_STREAM_FAR_M);
  expect(streamFarFor(fogRangeFor(0).far, 6000, "mobile")).toBe(
    PHONE_STREAM_FAR_M
  );
  // where the fog ends sooner, it is the fog's end that counts
  const dense = fogRangeFor(0.6).far;
  expect(streamFarFor(dense, 6000, "mobile")).toBe(
    streamFarFor(dense, 6000, "desktop")
  );
  expect(streamFarFor(dense, 6000, "mobile")).toBeLessThan(PHONE_STREAM_FAR_M);
  // a desktop streams as far as the fog
  expect(streamFarFor(fogFar, 6000, "desktop")).toBeGreaterThan(fogFar);
});

test("streamFarFor: Modell's dolly zoom streams as far on a phone as on a desktop", () => {
  // mid-dolly: the camera kilometres back, the fog opened past it
  const opened = 20_000;
  const cameraFar = 30_000;
  const phone = streamFarFor(opened, cameraFar, "mobile", true);
  expect(phone).toBe(streamFarFor(opened, cameraFar, "desktop", true));
  expect(phone).toBe(22_000);
  // walking or flying, the same fog would still be capped
  expect(streamFarFor(opened, cameraFar, "mobile")).toBe(PHONE_STREAM_FAR_M);
});
