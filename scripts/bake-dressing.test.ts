import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { DRESDEN } from "../sites/dresden";
import { drawnCoarse } from "../lib/city/coarse-crowns";
import { orchardTrees } from "../lib/city/cultivated";
import { SECTION_NAMES, unpackDressing } from "../lib/city/dressing-pack";
import type { DressingPack } from "../lib/city/dressing-pack";
import { decodeGreyPng } from "../lib/city/png-raster";
import { maxWindowSampler } from "../lib/city/raster-sampler";
import { treesOffRoofs } from "../lib/city/roof-trees";
import { tileExtentOf } from "../lib/city/site";
import { treesOffStructures } from "../lib/city/small-buildings";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { tileIds } from "../lib/city/tile";
import { inventoryCovers, inventoryTrees } from "../lib/city/tree-inventory";
import type { InventoryTree } from "../lib/city/tree-inventory";
import {
  canopyPlacements,
  offMonuments,
  plantedRows,
  rowPlacements,
} from "../lib/city/tree-placement";
import type { Placement } from "../lib/city/tree-placement";
import { checkJoins } from "../lib/city/ground-join";
import {
  placedTrees,
  registerFacts,
  registerTree,
  TREE_STEP_Y_M,
  treeJoins,
} from "../lib/city/tree-table";
import { BAKE_ENTRIES, KEY_STOPS } from "./bake-entries";
import { bakeDressing, packTrees } from "./bake-dressing";
import { moduleGraph } from "./bake-sources";
import {
  readCanopy,
  readCultivated,
  readMonuments,
  readRoofs,
  readScanCrowns,
  readSheds,
  readTrees,
  readVegRows,
  treeSourcePaths,
} from "./dressing-sources";

const ROOT = nodePath.join(import.meta.dir, "..");
/** Dresden's spawn tile: the committed files every figure below is of. */
const TILE = "33412_5656_2_sn";
const YEAR = 2026;
const offset = { cx: 413_000.25, cy: 5_657_000.5 };
const [minX, minY] = tileExtentOf(
  DRESDEN.tiles[tileIds(DRESDEN).indexOf(TILE)]
);
const bounds: TerrainBounds = [minX, minY, minX + 2000, minY + 2000];

/** A ground of sums and products only (a bake's bytes must not depend on
 *  the machine's libm): a tilted plane with a fold across it, null off the
 *  tile. */
function heightAt(x: number, y: number): number | null {
  if (x < minX || y < minY || x > minX + 2000 || y > minY + 2000) {
    return null;
  }
  const u = (x - minX) / 2000;
  const v = (y - minY) / 2000;
  return 108 + 14 * u + 9 * v + 6 * Math.abs(u - v) + 3 * u * v;
}
const ground = { bounds, heightAt, offset, origin: [minX, minY] as const };

/** A tile's trees as the viewer placed them before the build did: the
 *  canopy thinned and packed as float32 offsets, the surveyed trees'
 *  veto, each placed by the layer's own arithmetic on `heightAt`. */
async function runtimeTrees(): Promise<{
  placements: Placement[];
  register: InventoryTree[];
}> {
  const paths = treeSourcePaths(DRESDEN, TILE, ROOT);
  const sheds = readSheds(paths.sheds);
  const roofs = readRoofs(paths.city, paths.structures);
  const monuments = readMonuments(paths.monuments);
  const canopy = readCanopy(paths.canopy);
  const surveyed = [
    ...readTrees(paths.trees),
    ...orchardTrees(readCultivated(paths.cultivated)),
  ];
  const covers = inventoryCovers(surveyed);
  const keepTree = (x: number, y: number, h?: number) => !covers(x, y, h);
  const ndviAt = maxWindowSampler(
    await decodeGreyPng(new Uint8Array(readFileSync(paths.ndvi))),
    bounds
  );
  const ctx = { heightAt, offset };
  const packed = <F extends (typeof canopy.features)[number]>(list: F[]): F[] =>
    offMonuments(
      treesOffRoofs(treesOffStructures(list, sheds), roofs).map((f) => ({
        ...f,
        geometry: {
          type: "Point" as const,
          coordinates: [
            minX + Math.fround(f.geometry.coordinates[0] - minX),
            minY + Math.fround(f.geometry.coordinates[1] - minY),
          ] as [number, number],
        },
      })),
      monuments
    );
  return {
    placements: [
      ...canopyPlacements(packed(canopy.features), ctx, ndviAt, keepTree),
      ...canopyPlacements(
        packed(readScanCrowns(paths.canopyx)),
        ctx,
        ndviAt,
        keepTree
      ),
      ...rowPlacements(
        plantedRows(readVegRows(paths.vegrows), canopy.rowsMeasured),
        ctx,
        ndviAt,
        keepTree
      ).trees,
    ],
    register: inventoryTrees(surveyed, ctx, ndviAt, YEAR),
  };
}

const unpack = (bytes: Uint8Array): DressingPack => {
  const pack = unpackDressing(new Uint8Array(bytes).buffer);
  if (!pack) {
    throw new Error("not a dressing pack");
  }
  return pack;
};
const sha = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const at = (t: { x: number; z: number }) => `${t.x},${t.z}`;

describe("the spawn tile's tree table", () => {
  let files: { coarse: Uint8Array; fine: Uint8Array };
  let coarse: DressingPack;
  let fine: DressingPack;
  let runtime: Awaited<ReturnType<typeof runtimeTrees>>;

  beforeAll(async () => {
    files = await bakeDressing(DRESDEN, TILE, ROOT, ground);
    coarse = unpack(files.coarse);
    fine = unpack(files.fine);
    runtime = await runtimeTrees();
  });

  test("holds every tree the viewer placed, where and as it placed it", () => {
    const built = new Map(
      placedTrees([coarse, fine], offset).map((t) => [at(t.p), t.p])
    );
    expect(built.size).toBe(runtime.placements.length);
    expect(runtime.placements.length).toBeGreaterThan(5000);
    let worstY = 0;
    for (const want of runtime.placements) {
      const got = built.get(at(want));
      if (!got) {
        throw new Error(`no record of the tree at ${at(want)}`);
      }
      // the turn, the size and the crown to the bit: the record's
      // coordinates seed the same hashes
      expect([got.rot, got.s, got.w, got.evergreen, got.pine]).toEqual([
        want.rot,
        want.s,
        want.w,
        want.evergreen,
        want.pine,
      ]);
      expect(got.base).toBe(want.base);
      // at or under the ground it was stood on
      expect(got.y).toBeLessThanOrEqual(want.y);
      worstY = Math.max(worstY, want.y - got.y);
      if (want.ndvi !== undefined) {
        expect(Math.abs((got.ndvi ?? -1) - want.ndvi)).toBeLessThan(0.02);
      }
    }
    // … by less than a step
    expect(worstY).toBeLessThan(TREE_STEP_Y_M);
  });

  test("holds every surveyed tree, with its row among the tree facts", () => {
    const facts = registerFacts([coarse, fine]);
    const built = new Map(
      facts.map((f) => [f.index, registerTree(f, offset, YEAR)])
    );
    expect(built.size).toBe(runtime.register.length);
    expect(runtime.register.length).toBeGreaterThan(5000);
    // (the committed tile stands every surveyed tree on its ground, so a
    // tree's place among the placed ones is its file's row)
    for (const [index, want] of runtime.register.entries()) {
      const got = built.get(index);
      if (!got) {
        throw new Error(`no record of the surveyed tree ${index}`);
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

  test("every tree's foot meets the ground it was stood on (ADR 0030)", () => {
    const report = checkJoins(treeJoins([coarse, fine]), heightAt);
    expect(report.feet).toBe(
      runtime.placements.length + runtime.register.length
    );
    expect([report.unknown, report.misses.length]).toEqual([0, 0]);
  });

  test("the coarse level's file holds the third it draws, the fine level's the rest", () => {
    const inCoarse = [
      ...placedTrees([coarse], offset).map((t) => t.p),
      ...registerFacts([coarse]).map((f) => registerTree(f, offset, YEAR)),
    ];
    const inFine = [
      ...placedTrees([fine], offset).map((t) => t.p),
      ...registerFacts([fine]).map((f) => registerTree(f, offset, YEAR)),
    ];
    expect(inCoarse.every((t) => drawnCoarse(t.x, t.z))).toBe(true);
    expect(inFine.some((t) => drawnCoarse(t.x, t.z))).toBe(false);
    const share = inCoarse.length / (inCoarse.length + inFine.length);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.37);
  });

  test("every record lies in a run of its chunk, inside the run's box", () => {
    for (const pack of [coarse, fine]) {
      const trees = placedTrees([pack], offset);
      let covered = 0;
      for (const run of pack.sections.trees.runs) {
        covered += run.count;
        for (let i = run.start; i < run.start + run.count; i += 1) {
          const { p } = trees[i];
          expect([Math.floor(p.x / 250), Math.floor(p.z / 250)]).toEqual([
            run.cx,
            run.cz,
          ]);
          expect(p.x).toBeGreaterThanOrEqual(run.box[0]);
          expect(p.x).toBeLessThanOrEqual(run.box[3]);
          expect(p.y + p.s * 6.4).toBeLessThanOrEqual(run.box[4] + 0.05);
        }
      }
      expect(covered).toBe(trees.length);
    }
  });

  // The bytes as committed: a change here is a change of what every tile
  // publishes — say so in the PR, with the ledger's figures.
  test("is the table committed (a digest of both files)", () => {
    expect({ coarse: sha(files.coarse), fine: sha(files.fine) }).toEqual({
      coarse:
        "1e578bd5a02b2ce660acc2807ce109b279cc42f6db45655c2b8b2e293d392343",
      fine: "a0251ac1cfd1a0fa5611fa579ceffb694809a88b6494f9e4cec005fefd4fbbe9",
    });
  });
});

test("a tile without trees still has both files, every section empty", () => {
  const files = packTrees({ trees: [], register: [] }, [minX, minY]);
  for (const bytes of [files.coarse, files.fine]) {
    const pack = unpackDressing(new Uint8Array(bytes).buffer);
    expect(Object.keys(pack?.sections ?? {})).toEqual([...SECTION_NAMES]);
    expect(pack?.origin).toEqual([minX, minY, 0]);
  }
});

test("a tree a record cannot hold fails the build", () => {
  const far = {
    x: 0,
    y: 100,
    z: 0,
    reach: [10, 2] as const,
    fact: { e: minX - 10, n: minY, ground: 100, h: 10, slope: [0, 0] as const },
  };
  expect(() => packTrees({ trees: [far], register: [] }, [minX, minY])).toThrow(
    "do not fit"
  );
});

test("a tree on a bank at the slope's limit keeps the way the ground falls", () => {
  // the steepest slope the ground hands over (groundSlope holds it to ± 1)
  const onBank = (slope: readonly [number, number], dx: number) => ({
    x: dx,
    y: 100,
    z: -5,
    reach: [10, 2] as const,
    fact: { e: minX + 600 + dx, n: minY + 5, ground: 100, h: 10, slope },
  });
  const { fine, coarse, steep } = packTrees(
    {
      trees: [onBank([1, -1], 0), onBank([-1, 1], 7), onBank([0.98, 0], 14)],
      register: [],
    },
    [minX, minY]
  );
  // five slopes past the steepest step, each said to the build's log
  expect(steep).toBe(5);
  const slopes = placedTrees([unpack(coarse), unpack(fine)], offset)
    .toSorted((a, b) => a.p.x - b.p.x)
    .map((t) => t.p.slope);
  expect(slopes).toEqual([
    [120, -120],
    [-120, 120],
    [120, 0],
  ]);
});

// Bake where a thing stands, never how it looks (plan 086, joint 3): the
// dressing's bakers reach no colour, season, age's look or style, so a
// change of any re-bakes nothing.
test("the look stays out of the bake", () => {
  const LOOK = [
    "lib/city/landcover.ts",
    "lib/city/tree-season.ts",
    "lib/city/tree-age.ts",
    "lib/city/tree-family.ts",
    "lib/city/render-style.ts",
    "lib/city/look-controls.ts",
  ];
  const own = BAKE_ENTRIES.dressing.filter((entry) =>
    entry.includes("dressing")
  );
  expect(own).toHaveLength(3);
  const reached = new Set(
    own.flatMap((entry) => moduleGraph(entry, ROOT, KEY_STOPS))
  );
  expect(LOOK.filter((module) => reached.has(module))).toEqual([]);
  expect([...reached].filter((m) => m.startsWith("app/"))).toEqual([]);
});
