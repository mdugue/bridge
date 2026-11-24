/**
 * The tree baker (bake-trees.ts) and its file (lib/city/tree-table.ts), by
 * what they are for: a tree stands where the viewer's own placement put it
 * before the build placed it, on its ground; a steep bank keeps its side;
 * a tree a record cannot hold fails the build; a file that is not one is
 * none.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { DRESDEN } from "../sites/dresden";
import {
  canopyPlacements,
  inventoryTrees,
} from "../lib/city/__fixtures__/place-trees";
import { parseBakeFile } from "../lib/city/bake-file";
import { drawnCoarse } from "../lib/city/coarse-crowns";
import { orchardTrees } from "../lib/city/cultivated";
import type {
  CanopyFeature,
  CultivatedFeature,
  FeatureCollection,
  MonumentFeature,
  TreeFeature,
  VegRowFeature,
} from "../lib/city/features";
import { decodeGreyPng } from "../lib/city/png-raster";
import { maxWindowSampler } from "../lib/city/raster-sampler";
import { gapRoofs, lod2Roofs, treesOffRoofs } from "../lib/city/roof-trees";
import { tileExtentOf } from "../lib/city/site";
import { treesOffStructures } from "../lib/city/small-buildings";
import { SMALL_BUILDINGS_FILE } from "../lib/city/small-buildings-file";
import { STRUCTURES_FILE } from "../lib/city/structures-file";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { tileIds } from "../lib/city/tile";
import { inventoryCovers } from "../lib/city/tree-inventory";
import type { InventoryTree } from "../lib/city/tree-inventory";
import {
  offMonuments,
  plantedRows,
  rowPlacements,
} from "../lib/city/tree-placement";
import type { Placement } from "../lib/city/tree-placement";
import {
  packTreeFile,
  placedTrees,
  registerTrees,
  TREE_STEP_Y_M,
  unpackTreeFile,
} from "../lib/city/tree-table";
import type { TreePack } from "../lib/city/tree-table";
import type { CityJsonDocument } from "../lib/city/types";
import { packTrees, standTrees, treeSources } from "./bake-trees";

const ROOT = nodePath.join(import.meta.dir, "..");
/** Dresden's spawn tile: the committed files. */
const TILE = "33412_5656_2_sn";
const YEAR = 2026;
const offset = { cx: 413_000.25, cy: 5_657_000.5 };
const [minX, minY] = tileExtentOf(
  DRESDEN.tiles[tileIds(DRESDEN).indexOf(TILE)]
);
const bounds: TerrainBounds = [minX, minY, minX + 2000, minY + 2000];

/** A ground of sums and products only: a tilted plane with a fold across
 *  it, null off the tile. */
function heightAt(x: number, y: number): number | null {
  if (x < minX || y < minY || x > minX + 2000 || y > minY + 2000) {
    return null;
  }
  const u = (x - minX) / 2000;
  const v = (y - minY) / 2000;
  return 108 + 14 * u + 9 * v + 6 * Math.abs(u - v) + 3 * u * v;
}
const ground = { bounds, heightAt, offset, origin: [minX, minY] as const };
const sources = treeSources(DRESDEN, TILE, ROOT);

const json = (path: string | undefined): unknown =>
  path && existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : null;
const features = <T>(path: string | undefined): T[] =>
  (json(path) as FeatureCollection<T> | null)?.features ?? [];

/** The tile's trees as the viewer placed them before the build did: the
 *  canopy off the sheds, the roofs and the monuments, at the float32
 *  offsets the packed canopy held, under the surveyed trees' veto. */
async function runtimeTrees(): Promise<{
  placements: Placement[];
  register: InventoryTree[];
}> {
  const sheds = parseBakeFile(
    SMALL_BUILDINGS_FILE,
    json(sources.sheds),
    sources.sheds ?? ""
  ).features;
  const roofs = [
    ...lod2Roofs(json(sources.city) as CityJsonDocument),
    ...gapRoofs(
      parseBakeFile(
        STRUCTURES_FILE,
        json(sources.structures),
        sources.structures ?? ""
      ).features
    ),
  ];
  const surveyed = [
    ...features<TreeFeature>(sources.trees),
    ...orchardTrees(features<CultivatedFeature>(sources.cultivated)),
  ];
  const covers = inventoryCovers(surveyed);
  const keepTree = (x: number, y: number, h?: number) => !covers(x, y, h);
  const ndviAt = maxWindowSampler(
    await decodeGreyPng(new Uint8Array(readFileSync(sources.ndvi ?? ""))),
    bounds
  );
  const ctx = { heightAt, offset };
  const packed = (path: string | undefined): CanopyFeature[] =>
    treesOffRoofs(
      treesOffStructures(features<CanopyFeature>(path), sheds),
      roofs
    ).map((f) => ({
      ...f,
      geometry: {
        type: "Point" as const,
        coordinates: [
          minX + Math.fround(f.geometry.coordinates[0] - minX),
          minY + Math.fround(f.geometry.coordinates[1] - minY),
        ] as [number, number],
      },
    }));
  const canopy = offMonuments(
    [...packed(sources.canopy), ...packed(sources.canopyx)],
    features<MonumentFeature>(sources.monuments)
  );
  const rowsMeasured =
    (json(sources.canopy) as { rows?: unknown } | null)?.rows !== undefined;
  return {
    placements: [
      ...canopyPlacements(canopy, ctx, ndviAt, keepTree),
      ...rowPlacements(
        plantedRows(features<VegRowFeature>(sources.vegrows), rowsMeasured),
        ctx,
        ndviAt,
        keepTree
      ).trees,
    ],
    register: inventoryTrees(surveyed, ctx, ndviAt, YEAR),
  };
}

const unpack = (bytes: Uint8Array): TreePack => {
  const pack = unpackTreeFile(new Uint8Array(bytes).buffer);
  if (!pack) {
    throw new Error("not a tree file");
  }
  return pack;
};
const at = (t: { x: number; z: number }) => `${t.x},${t.z}`;

/** Every tree of one file, where it stands. */
const inFile = (pack: TreePack) => [
  ...placedTrees([pack], offset).map((t) => t.p),
  ...registerTrees([pack], offset, YEAR),
];

describe("the spawn tile's trees", () => {
  let coarse: TreePack;
  let fine: TreePack;
  let runtime: Awaited<ReturnType<typeof runtimeTrees>>;

  beforeAll(async () => {
    const files = packTrees(await standTrees(sources, ground), [minX, minY]);
    coarse = unpack(files.coarse);
    fine = unpack(files.fine);
    runtime = await runtimeTrees();
  });

  test("every tree stands where the viewer's placement put it, on its ground", () => {
    const built = new Map(
      placedTrees([coarse, fine], offset).map((t) => [at(t.p), t.p])
    );
    expect(built.size).toBe(runtime.placements.length);
    expect(runtime.placements.length).toBeGreaterThan(5000);
    for (const want of runtime.placements) {
      const got = built.get(at(want));
      if (!got) {
        throw new Error(`no record of the tree at ${at(want)}`);
      }
      // its turn, its size and its crown: the record's coordinates seed
      // the same hashes
      expect([got.rot, got.s, got.w, got.base]).toEqual([
        want.rot,
        want.s,
        want.w,
        want.base,
      ]);
      // its foot at or under the ground it was stood on, by less than a step
      expect(got.y).toBeLessThanOrEqual(want.y);
      expect(want.y - got.y).toBeLessThan(TREE_STEP_Y_M);
    }
    const surveyed = new Map(
      registerTrees([coarse, fine], offset, YEAR).map((t) => [at(t), t])
    );
    expect(runtime.register.length).toBeGreaterThan(5000);
    for (const want of runtime.register) {
      const got = surveyed.get(at(want));
      if (!got) {
        throw new Error(`no record of the surveyed tree at ${at(want)}`);
      }
      expect({ ...got, ground: 0, ndvi: 0, slope: 0 }).toEqual({
        ...want,
        ground: 0,
        ndvi: 0,
        slope: 0,
      });
      expect(got.ground).toBeLessThanOrEqual(want.ground);
      expect(want.ground - got.ground).toBeLessThan(TREE_STEP_Y_M);
    }
  });

  test("the coarse level's file holds the third it draws, the fine level's the rest", () => {
    const inCoarse = inFile(coarse);
    const inFine = inFile(fine);
    expect(inCoarse.every((t) => drawnCoarse(t.x, t.z))).toBe(true);
    expect(inFine.some((t) => drawnCoarse(t.x, t.z))).toBe(false);
    const share = inCoarse.length / (inCoarse.length + inFine.length);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.37);
  });
});

/** A tree of 10 m at (`dx`, 5) m from the tile's corner, on `slope`. */
const onBank = (slope: readonly [number, number], dx: number) => ({
  x: dx,
  z: -5,
  fact: { e: minX + 600 + dx, n: minY + 5, ground: 100, h: 10, slope },
});

test("a tree on a steep bank keeps the way the ground falls", () => {
  // the steepest slope the ground hands over is ± 1; a byte holds ± 120
  const { fine, coarse } = packTrees(
    {
      trees: [onBank([1, -1], 0), onBank([-1, 1], 7), onBank([0.98, 0], 14)],
      register: [],
    },
    [minX, minY]
  );
  const slopes = placedTrees([unpack(coarse), unpack(fine)], offset)
    .toSorted((a, b) => a.p.x - b.p.x)
    .map((t) => t.p.slope);
  expect(slopes).toEqual([
    [120, -120],
    [-120, 120],
    [120, 0],
  ]);
});

test("a tree a record cannot hold fails the build", () => {
  const outside = {
    ...onBank([0, 0], 0),
    fact: { e: minX - 10, n: minY, ground: 100, h: 10, slope: [0, 0] as const },
  };
  expect(() =>
    packTrees({ trees: [outside], register: [] }, [minX, minY])
  ).toThrow("do not fit");
});

test("a tree file comes back as packed; what is not one is none", () => {
  const pack: TreePack = {
    origin: [412_000, 5_656_000, 104],
    trees: Uint16Array.from({ length: 12 }, (_, i) => i * 4099),
    register: Uint16Array.from({ length: 10 }, (_, i) => 65_535 - i),
  };
  const file = packTreeFile(pack);
  expect(unpackTreeFile(new Uint8Array(file).buffer)).toEqual(pack);
  const wrong = new Uint8Array(file);
  wrong[0] = 0;
  expect(unpackTreeFile(wrong.buffer)).toBeNull();
  expect(
    unpackTreeFile(new Uint8Array(file.subarray(0, -2)).buffer)
  ).toBeNull();
  expect(unpackTreeFile(new ArrayBuffer(8))).toBeNull();
});
