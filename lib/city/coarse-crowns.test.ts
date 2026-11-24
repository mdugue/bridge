import { describe, expect, test } from "bun:test";
import {
  COARSE_TREE_SHARE,
  COARSE_TREE_WIDEN,
  coarseCrowns,
  coarseCrownsStandIn,
  coarseForm,
  drawnCoarse,
} from "./coarse-crowns";
import type { InventoryTree } from "./tree-inventory";
import type { Placement } from "./tree-placement";

const at = (x: number, z: number, i = 0): Placement => ({
  x: Math.fround(x),
  z: Math.fround(z),
  y: 0,
  rot: i * 0.1,
  s: 1 + i * 0.01,
});

/** The crowns' positions, sorted: what the tile's listing order must not change. */
const crownKeys = (list: Placement[]) =>
  coarseCrowns(list, [])
    .map((c) => `${c.x},${c.z}`)
    .sort();

/** A register tree of a cone-shaped genus at `x`. */
const registerTree = (x: number): InventoryTree => ({
  colour: 2,
  ext: { crownBase: 3, crownTop: 12, crownWidth: 8, trunkTop: 6 },
  genus: 4,
  ground: 0,
  jitter: -2.5,
  leaf: "d",
  ndvi: 0.4,
  rot: 1,
  shape: "cone",
  x: Math.fround(x),
  z: 5,
});

/** The `i`-th canopy pine of a row. */
const placedPine = (i: number): Placement => ({
  ...at(i * 3.1, i * 1.7, i),
  evergreen: true,
  pine: true,
});

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

  test("register trees join with their crown, colour and season", () => {
    const register = Array.from({ length: 300 }, (_, i) =>
      registerTree(i * 3.7)
    );
    // every tree handed over: the level's file is the selection
    const crowns = coarseCrowns([], register);
    expect(crowns).toHaveLength(register.length);
    expect(crowns[0]).toMatchObject({
      kind: "register",
      colour: "golden",
      cone: true,
      genus: 4,
      jitter: -2.5,
      ext: { crownBase: 3, crownTop: 12, crownWidth: 8 },
    });
  });

  test("a needle tree keeps its form at a distance: a cone or a pine", () => {
    const canopy = { kind: "canopy" as const, x: 0, z: 0, rot: 0, s: 1 };
    expect(coarseForm(canopy)).toBe("broad");
    expect(coarseForm({ ...canopy, evergreen: true })).toBe("cone");
    expect(coarseForm({ ...canopy, evergreen: true, pine: true })).toBe("pine");
    // a pine is an evergreen's form: a broadleaf is never one
    expect(coarseForm({ ...canopy, pine: true })).toBe("broad");
    const register = {
      kind: "register" as const,
      x: 0,
      z: 0,
      rot: 0,
      colour: "evergreen" as const,
      ext: { crownBase: 2, crownTop: 12, crownWidth: 5 },
      genus: 0,
      jitter: 0,
    };
    expect(coarseForm(register)).toBe("broad");
    expect(coarseForm({ ...register, cone: true })).toBe("cone");
    expect(coarseForm({ ...register, pine: true })).toBe("pine");
  });

  test("a register pine and a canopy pine join as pines", () => {
    const pine: InventoryTree = {
      colour: 0,
      ext: { crownBase: 11, crownTop: 20, crownWidth: 9, trunkTop: 14 },
      genus: 0,
      ground: 0,
      jitter: 0,
      leaf: "e",
      rot: 0,
      shape: "pine",
      x: 0,
      z: 0,
    };
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...pine,
      x: Math.fround(i * 3.7),
    }));
    const crowns = coarseCrowns(
      Array.from({ length: 60 }, (_, i) => placedPine(i)),
      many
    );
    expect(crowns.length).toBeGreaterThan(0);
    expect(crowns.every((c) => coarseForm(c) === "pine")).toBe(true);
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
