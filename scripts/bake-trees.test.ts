/**
 * The tree baker (bake-trees.ts) and its file (lib/city/tree-table.ts), by
 * what they are for: a tree's foot is on its ground; the coarse level's
 * file is that level's third; a steep bank keeps its side;
 * a tree a record cannot hold fails the build; a file that is not one is
 * none.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import nodePath from "node:path";
import { DRESDEN } from "../sites/dresden";
import { drawnCoarse } from "../lib/city/coarse-crowns";
import { finished } from "../lib/city/build-steps";
import { worldToEpsg } from "../lib/city/ground-clamp";
import { tileExtentOf } from "../lib/city/site";
import type { TerrainBounds } from "../lib/city/terrain-geometry";
import { tileIds } from "../lib/city/tile";
import {
  packTreeFile,
  placedTreeSteps,
  registerFacts,
  registerTree,
  TREE_STEP_Y_M,
  unpackTreeFile,
} from "../lib/city/tree-table";
import type { TreePack } from "../lib/city/tree-table";
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

const unpack = (bytes: Uint8Array): TreePack => {
  const pack = unpackTreeFile(new Uint8Array(bytes).buffer);
  if (!pack) {
    throw new Error("not a tree file");
  }
  return pack;
};

const placedTrees = (packs: TreePack[], at: typeof offset) =>
  finished(placedTreeSteps(packs, at, (tree) => tree));

const registerTrees = (packs: TreePack[], at: typeof offset, year: number) =>
  registerFacts(packs).map((fact) => registerTree(fact, at, year));

/** Every tree of one file, where it stands. */
const inFile = (pack: TreePack) => [
  ...placedTrees([pack], offset).map((t) => t.p),
  ...registerTrees([pack], offset, YEAR),
];

describe("the spawn tile's trees", () => {
  let coarse: TreePack;
  let fine: TreePack;

  beforeAll(async () => {
    const files = packTrees(await standTrees(sources, ground), [minX, minY]);
    coarse = unpack(files.coarse);
    fine = unpack(files.fine);
  });

  test("every tree's foot is at or under the ground it stands on, by less than a step", () => {
    const feet = [
      ...placedTrees([coarse, fine], offset).map((t) => t.p),
      ...registerTrees([coarse, fine], offset, YEAR).map((t) => ({
        ...t,
        y: t.ground,
      })),
    ];
    expect(feet.length).toBeGreaterThan(10_000);
    for (const foot of feet) {
      const { x: e, y: n } = worldToEpsg(foot.x, foot.z, offset);
      const under = (heightAt(e, n) ?? Number.NaN) - foot.y;
      // (a millimetre for the float the scene holds a place in)
      expect(under).toBeGreaterThan(-1e-3);
      expect(under).toBeLessThan(TREE_STEP_Y_M + 1e-3);
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
