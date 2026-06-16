import { expect, test } from "bun:test";
import {
  buildingGlows,
  buildingTint,
  roofTint,
  roughJitter,
  storeyHeight,
} from "./building-tint";

const inRange = (rgb: number[]) =>
  rgb.every((c) => c >= 0 && c <= 1) && rgb.length === 3;

test("tint is deterministic for the same id + attributes", () => {
  const a = buildingTint("DESNATPU1000HJx5", { function: "31001_9998" });
  const b = buildingTint("DESNATPU1000HJx5", { function: "31001_9998" });
  expect(a).toEqual(b);
});

test("different ids generally get different tints (hash spread)", () => {
  const seen = new Set(
    Array.from({ length: 200 }, (_, i) =>
      buildingTint(`B${i}`, {})
        .map((c) => c.toFixed(4))
        .join(",")
    )
  );
  // With jitter + 4 swatches the 200 ids should yield many distinct colours.
  expect(seen.size).toBeGreaterThan(150);
});

test("output is always linear RGB in [0,1]", () => {
  for (const id of ["", "a", "kurz", "DESNATPU1000HJx5", "🏠"]) {
    expect(inRange(buildingTint(id, { measuredHeight: 120 }))).toBe(true);
    expect(inRange(buildingTint(id, { measuredHeight: -5 }))).toBe(true);
  }
});

test("missing/garbage attributes fall back to the housing family, never throw", () => {
  expect(inRange(buildingTint("x"))).toBe(true);
  // wrong types must be ignored, not crash
  expect(
    inRange(buildingTint("x", { function: 42, measuredHeight: "tall" }))
  ).toBe(true);
});

test("public/special function reads cooler (more blue) than housing", () => {
  // Same id so only the family differs; civic stone should be bluer-than-red
  // relative to the warm housing swatch.
  const housing = buildingTint("same-id", { function: "31001_9998" });
  const civic = buildingTint("same-id", { function: "31001_3021" });
  const special = buildingTint("same-id", { function: "53001_1800" });
  const blueBias = (c: number[]) => c[2] - c[0];
  expect(blueBias(civic)).toBeGreaterThan(blueBias(housing));
  expect(blueBias(special)).toBeGreaterThan(blueBias(housing));
});

test("taller buildings drift cooler than short ones of the same id/family", () => {
  const short = buildingTint("h", {
    function: "31001_9998",
    measuredHeight: 6,
  });
  const tall = buildingTint("h", {
    function: "31001_9998",
    measuredHeight: 30,
  });
  expect(tall[2] - tall[0]).toBeGreaterThan(short[2] - short[0]);
});

test("roofTint: pitched/tiled roofs are warmer (R>B) than flat/slate roofs", () => {
  const tiled = roofTint("r", { roofType: "3100" }); // Satteldach
  const flat = roofTint("r", { roofType: "1000" }); // Flachdach
  expect(tiled[0]).toBeGreaterThan(tiled[2]); // terracotta: red-biased
  expect(flat[0] - flat[2]).toBeLessThan(tiled[0] - tiled[2]); // slate: ~neutral
  expect(roofTint("r").every((c) => c >= 0 && c <= 1)).toBe(true);
});

test("roofTint: low pitch reads flat, steep pitch reads tiled (unknown roofType)", () => {
  const lowPitch = roofTint("r", { roofType: "9999", Dachneigung: 2 });
  const steep = roofTint("r", { roofType: "9999", Dachneigung: 40 });
  expect(steep[0] - steep[2]).toBeGreaterThan(lowPitch[0] - lowPitch[2]);
});

test("buildingGlows: commerce/public/special glow, housing does not", () => {
  expect(buildingGlows({ function: "31001_2000" })).toBe(true); // commerce
  expect(buildingGlows({ function: "31001_3021" })).toBe(true); // public
  expect(buildingGlows({ function: "53001_1800" })).toBe(true); // special
  expect(buildingGlows({ function: "31001_9998" })).toBe(false); // housing
  expect(buildingGlows({})).toBe(false);
});

test("storeyHeight: snaps near ~3.2 m, clamps, falls back to 3", () => {
  expect(storeyHeight(undefined)).toBe(3);
  expect(storeyHeight(1)).toBe(3); // implausibly short → fallback
  const h = storeyHeight(12);
  expect(h).toBeGreaterThanOrEqual(2.5);
  expect(h).toBeLessThanOrEqual(4.5);
  expect(Math.round(12 / h)).toBe(4); // 12 m → 4 storeys of 3 m
});

test("roughJitter: deterministic, in [-1,1]", () => {
  expect(roughJitter("x")).toBe(roughJitter("x"));
  for (const id of ["a", "b", "kurz", "DESNATPU1000HJx5"]) {
    const v = roughJitter(id);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  }
});
