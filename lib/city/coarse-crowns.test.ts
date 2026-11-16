import { describe, expect, test } from "bun:test";
import {
  COARSE_TREE_SHARE,
  COARSE_TREE_WIDEN,
  coarseCrownsStandIn,
  drawnCoarse,
} from "./coarse-crowns";
import type { Placement } from "./tree-placement";

const at = (x: number, z: number, i = 0): Placement => ({
  x: Math.fround(x),
  z: Math.fround(z),
  y: 0,
  rot: i * 0.1,
  s: 1 + i * 0.01,
});

/** The kept trees' positions, sorted: what the tile's listing order must not change. */
const crownKeys = (list: Placement[]) =>
  list
    .filter((p) => drawnCoarse(p.x, p.z))
    .map((p) => `${p.x},${p.z}`)
    .sort();

describe("which trees the coarse level draws", () => {
  test("a third of them, the crowns as much wider as covers what all covered", () => {
    let kept = 0;
    let n = 0;
    for (let x = -1000; x < 1000; x += 7.3) {
      for (let z = -1000; z < 1000; z += 9.1) {
        n += 1;
        if (drawnCoarse(x, z)) {
          kept += 1;
        }
      }
    }
    expect(kept / n).toBeCloseTo(COARSE_TREE_SHARE, 2);
    expect(COARSE_TREE_SHARE * COARSE_TREE_WIDEN ** 2).toBeCloseTo(1, 12);
  });

  test("a row of trees is thinned tree by tree, never as one", () => {
    // a street's trees every 9 m along a diagonal
    const row = Array.from({ length: 300 }, (_, i) => at(i * 6.4, i * 6.4, i));
    const kept = row.filter((p) => drawnCoarse(p.x, p.z)).length;
    expect(kept / row.length).toBeGreaterThan(0.2);
    expect(kept / row.length).toBeLessThan(0.47);
  });

  test("the same trees, however the tile lists them", () => {
    const trees = Array.from({ length: 200 }, (_, i) =>
      at(10 + i * 3.7, 20 - i * 1.3, i)
    );
    expect(crownKeys([...trees].reverse())).toEqual(crownKeys(trees));
  });
});

const standIn = (coarse: boolean, fine: boolean, fineDressed: boolean) =>
  coarseCrownsStandIn({ coarse, fine, fineDressed });

test("the coarse crowns stand in on a fine level until its own trees hang", () => {
  // the fine level shown bare: the coarse crowns stand in
  expect(standIn(false, true, false)).toBe(true);
  // its dressing hung: its own trees
  expect(standIn(false, true, true)).toBe(false);
  // the coarse level shown: its crowns are on screen with it already
  expect(standIn(true, false, false)).toBe(false);
  expect(standIn(true, true, false)).toBe(false);
  // neither level shown: nothing to stand in for
  expect(standIn(false, false, false)).toBe(false);
});
