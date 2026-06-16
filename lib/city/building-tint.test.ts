import { expect, test } from "bun:test";
import { buildingTint } from "./building-tint";

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
