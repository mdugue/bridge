import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { DRESDEN } from "../../sites/dresden";
import {
  BUILTUP_CLASS,
  EDGE_SCALE,
  LANDCOVER_CLASSES,
  landcoverSrgb,
  linearPalette,
  MEADOW_CLASS,
  PARKING_KINDS,
  PATH_CLASS,
  parkingId,
  ROAD_CLASS,
  SURFACE_ALONG_PERIOD,
  SURFACE_KINDS,
  srgbToLinear,
  surfaceHeading,
  surfaceId,
  unpackSurface,
  WATER_CLASS,
} from "./landcover";
import { siteDataDir } from "./tile";

test("class ids are the table index, 0..8", () => {
  expect(LANDCOVER_CLASSES.map((c) => c.id)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  expect(LANDCOVER_CLASSES[WATER_CLASS].key).toBe("water");
  expect(LANDCOVER_CLASSES[MEADOW_CLASS].key).toBe("farmland");
  expect(LANDCOVER_CLASSES[BUILTUP_CLASS].key).toBe("builtup");
  expect(LANDCOVER_CLASSES[PATH_CLASS].key).toBe("path");
  expect(LANDCOVER_CLASSES[ROAD_CLASS].key).toBe("road");
});

test("every committed surface legend names the same paving kinds", () => {
  const dir = `${siteDataDir(DRESDEN)}/dlm`;
  const legends = readdirSync(dir).filter(
    (f) => f.startsWith("surface_") && f.endsWith(".json")
  );
  expect(legends.length).toBeGreaterThan(0);
  for (const file of legends) {
    const { surfaces, parking, alongPeriod } = JSON.parse(
      readFileSync(`${dir}/${file}`, "utf8")
    ) as {
      alongPeriod: number;
      parking: Record<string, string>;
      surfaces: Record<string, string>;
    };
    expect(alongPeriod).toBe(SURFACE_ALONG_PERIOD);
    expect(Object.values(surfaces)).toEqual([...SURFACE_KINDS]);
    expect(Object.values(parking)).toEqual([...PARKING_KINDS]);
  }
  // Both ids of a texel fit their 3 bits.
  expect(SURFACE_KINDS.length).toBeLessThanOrEqual(8);
});

test("every committed edge legend has the viewer's scale", () => {
  const dir = `${siteDataDir(DRESDEN)}/dlm`;
  const legends = readdirSync(dir).filter(
    (f) => f.startsWith("edges_") && f.endsWith(".json")
  );
  expect(legends.length).toBeGreaterThan(0);
  for (const file of legends) {
    const { scale } = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as {
      scale: number;
    };
    expect(scale).toBe(EDGE_SCALE);
  }
});

test("a surface texel unpacks into the road and the walk material", () => {
  const byte =
    parkingId("lot") * 64 + surfaceId("paving") * 8 + surfaceId("sett");
  expect(unpackSurface(byte)).toEqual({ road: 4, walk: 3, park: 3 });
  expect(surfaceHeading(0)).toBeNull();
  expect(surfaceHeading(1)).toBe(0);
  expect(surfaceHeading(128)).toBeCloseTo(Math.PI / 2, 10);
});

test("every committed legend names the same classes", () => {
  // every site folder with baked data (data/_raw is the downloads)
  const legends = readdirSync("data")
    .filter((site) => !site.startsWith("_") && existsSync(`data/${site}/dlm`))
    .flatMap((site) =>
      readdirSync(`data/${site}/dlm`)
        .filter((f) => f.startsWith("landcover_") && f.endsWith(".json"))
        .map((f) => `data/${site}/dlm/${f}`)
    );
  expect(legends.length).toBeGreaterThan(0);
  for (const file of legends) {
    const { classes } = JSON.parse(readFileSync(file, "utf8")) as {
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
