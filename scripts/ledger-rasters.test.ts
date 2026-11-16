import { expect, test } from "bun:test";
import sharp from "sharp";
import { buildTileset } from "../lib/city/tileset";
import type { TerrainFiles } from "../lib/city/tileset";
import { measureRasters, tileLevels } from "./ledger-rasters";
import type { RasterSource } from "./ledger-rasters";

/** A greyscale PNG `width` bytes wide (channels interleaved, as the bakes
 *  write them), `set` texel bytes non-zero. */
async function greyPng(
  width: number,
  height: number,
  set: readonly number[] = []
): Promise<Uint8Array> {
  const data = new Uint8Array(width * height);
  for (const i of set) {
    data[i] = 9;
  }
  return new Uint8Array(
    await sharp(data, { raw: { width, height, channels: 1 } })
      .toColourspace("b-w")
      .png()
      .toBuffer()
  );
}

const T = "t1";

/** The fine level names the class raster, its phone twin, the paving and
 *  its far twin, the sports grounds without grounds in their table, and a
 *  sky view; the coarse level its own class raster and the sky view. */
const FINE: TerrainFiles = {
  landcover: `landcover_${T}.png`,
  landcoverLow: `landcover_${T}.r2048.png`,
  surface: `surface_${T}.png`,
  surfaceFar: `surface_${T}.r1024.png`,
  sport: `sport_${T}.png`,
  sportTable: `sport_${T}.json`,
  svf: `svf_${T}.png`,
};
const COARSE: TerrainFiles = {
  landcover: `landcover_${T}.r1024.png`,
  landcoverLow: `landcover_${T}.r1024.png`,
  svf: `svf_${T}.png`,
};

function tilesetWith(fine: TerrainFiles) {
  return buildTileset(
    [
      {
        id: T,
        bounds: [0, 0, 2000, 2000],
        zRange: [100, 150],
        city: `city_${T}.glb.gz`,
        cityFar: `city_${T}_far.glb.gz`,
        terrain: { 0: `terrain_${T}_l0.glb.gz`, 1: `terrain_${T}_l1.glb.gz` },
        files: { city: {}, terrain: { 0: fine, 1: COARSE } },
      },
    ],
    {
      epsg: 25_833,
      offset: { cx: 0, cy: 0 },
      site: "test",
      tiles: [
        { id: T, bounds: [0, 0, 2000, 2000], footprints: "footprints.fpr.gz" },
      ],
    }
  );
}

async function source(fine: TerrainFiles = FINE): Promise<RasterSource> {
  const bytes: Record<string, Uint8Array> = {
    [`landcover_${T}.png`]: await greyPng(8, 8),
    [`landcover_${T}.r2048.png`]: await greyPng(4, 4),
    [`landcover_${T}.r1024.png`]: await greyPng(2, 2),
    // 4×4 RGBA: two texels with paving
    [`surface_${T}.png`]: await greyPng(16, 4, [0, 21]),
    [`surface_${T}.r1024.png`]: await greyPng(8, 2),
    [`sport_${T}.png`]: await greyPng(16, 4, [4]),
    [`sport_${T}.json`]: new TextEncoder().encode('{"grounds":[]}'),
    [`svf_${T}.png`]: await greyPng(2, 2),
  };
  return {
    // logical and served names alike
    files: Object.fromEntries(Object.keys(bytes).map((n) => [n, n])),
    read: (served) => {
      const found = bytes[served];
      if (!found) {
        throw new Error(`no ${served}`);
      }
      return found;
    },
    tileset: tilesetWith(fine),
  };
}

test("a site's rasters by the viewer's rules: tiers, reaches, gates, cover", async () => {
  const files = await source();
  const site = await measureRasters(files);
  // desktop fine: class 8² (1 B), paving 4² RGBA, sky view 2² with mips;
  // the sports raster is gated off by its table's empty grounds
  expect(site.gpu.class.desktop.fine.spawn).toBe(64);
  expect(site.gpu.surface.desktop.fine.spawn).toBe(64);
  expect(site.gpu.svf.desktop.fine.spawn).toBe(5);
  expect(site.gpu.sport.desktop.fine.spawn).toBe(0);
  // the class raster's splat: RGBA with mips at the class raster's size
  expect(site.gpu.splat.desktop.fine.spawn).toBe(341);
  // beyond the ground detail's reach: the paving's far twin
  expect(site.gpu.surface.desktop.fineFar.spawn).toBe(16);
  // a phone's own class raster; the coarse level's on every tier
  expect(site.gpu.class.phone.fine.spawn).toBe(16);
  expect(site.gpu.class.phone.coarse.spawn).toBe(4);
  expect(site.fine.desktop.spawn).toMatchObject({ exact: 128, soft: 5 });
  expect(site.fineFar.desktop.spawn.exact).toBe(64 + 16);
  // cover: 2 of 16 paving texels in a box of 2 × 2; no sports raster held
  expect(site.cover.surface).toEqual({
    tiles: 1,
    share: { mean: 0.125, max: 0.125 },
    box: { mean: 0.25, max: 0.25 },
  });
  expect(site.cover.sport.tiles).toBe(0);
  expect(site.variants.keys.desktop).toEqual([
    "|surface|||||svf||2000|2000",
    "||||||svf||2000|2000",
  ]);
  expect(site.artifacts.surface).toEqual({
    files: 1,
    wire: files.read(`surface_${T}.png`).length,
    shapes: ["4×4×4"],
  });
});

test("an extras name the site did not publish fails the ledger", async () => {
  const broken = await source({ ...FINE, edges: `edges_${T}.png` });
  await expect(measureRasters(broken)).rejects.toThrow("not published");
});

test("a tileset of another shape fails the ledger", () => {
  expect(() =>
    tileLevels({ extras: { tiles: [{ id: T }] }, root: {} })
  ).toThrow("ledger");
});
