import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  LANDCOVER_CLASSES,
  landcoverSrgb,
  linearPalette,
  MEADOW_CLASS,
  srgbToLinear,
  WATER_CLASS,
} from "./landcover";

test("class ids are the table index, 0..8", () => {
  expect(LANDCOVER_CLASSES.map((c) => c.id)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  expect(LANDCOVER_CLASSES[WATER_CLASS].key).toBe("water");
  expect(LANDCOVER_CLASSES[MEADOW_CLASS].key).toBe("farmland");
});

test("every committed legend names the same classes", () => {
  const dir = "data/dlm";
  const legends = readdirSync(dir).filter(
    (f) => f.startsWith("landcover_") && f.endsWith(".json")
  );
  expect(legends.length).toBeGreaterThan(0);
  for (const file of legends) {
    const { classes } = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as {
      classes: Record<string, string>;
    };
    for (const c of LANDCOVER_CLASSES) {
      expect(classes[String(c.id)]).toBe(c.key);
    }
  }
});

test("unknown ids take the background tint", () => {
  expect(landcoverSrgb(200)).toEqual(LANDCOVER_CLASSES[0].srgb);
});

test("the linear palette is the sRGB table through the transfer curve", () => {
  expect(srgbToLinear(0)).toBe(0);
  expect(srgbToLinear(255)).toBeCloseTo(1, 10);
  expect(srgbToLinear(188)).toBeCloseTo(0.5029, 3);
  const flat = linearPalette();
  expect(flat).toHaveLength(LANDCOVER_CLASSES.length * 3);
  expect(flat[WATER_CLASS * 3]).toBeCloseTo(srgbToLinear(164), 10);
});
