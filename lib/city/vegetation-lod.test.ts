import { expect, test } from "bun:test";
import {
  type ChunkLodState,
  FAR_IN_M,
  FAR_OUT_M,
  keepInFarTier,
  planCrownTiers,
  RICH_IN_M,
  RICH_OUT_M,
  RICH_TREE_BUDGET,
} from "./vegetation-lod";

const chunk = (
  near: number,
  trees = 100,
  current: ChunkLodState["current"] = "mid",
  allowRich = true
): ChunkLodState => ({ allowRich, current, near, trees });

test("distance picks mid or far, with hysteresis", () => {
  expect(planCrownTiers([chunk(FAR_IN_M - 1)])).toEqual(["mid"]);
  expect(planCrownTiers([chunk(FAR_IN_M + 1)])).toEqual(["far"]);
  // Between the out and in distances a chunk keeps its tier.
  const between = (FAR_IN_M + FAR_OUT_M) / 2;
  expect(planCrownTiers([chunk(between, 100, "far")])).toEqual(["far"]);
  expect(planCrownTiers([chunk(between, 100, "mid")])).toEqual(["mid"]);
});

test("near chunks go rich, with hysteresis", () => {
  expect(planCrownTiers([chunk(RICH_IN_M - 1)])).toEqual(["rich"]);
  const between = (RICH_IN_M + RICH_OUT_M) / 2;
  expect(planCrownTiers([chunk(between, 100, "mid")])).toEqual(["mid"]);
  expect(planCrownTiers([chunk(between, 100, "rich")])).toEqual(["rich"]);
});

test("the rich crown stays off where the look disables it", () => {
  expect(planCrownTiers([chunk(0, 100, "mid", false)])).toEqual(["mid"]);
});

test("rich crowns stay within the budget, nearest chunks first", () => {
  const forest = [
    chunk(150, 1200),
    chunk(0, 1200),
    chunk(50, 1200),
    chunk(100, 1200),
  ];
  const tiers = planCrownTiers(forest);
  expect(tiers).toEqual(["mid", "rich", "rich", "mid"]);
  const rich = forest.filter((_, i) => tiers[i] === "rich");
  expect(rich.reduce((n, c) => n + c.trees, 0)).toBeLessThanOrEqual(
    RICH_TREE_BUDGET
  );
});

test("a chunk that is already rich keeps its place against a slightly nearer one", () => {
  const tiers = planCrownTiers([
    chunk(40, 2000, "mid"),
    chunk(80, 2000, "rich"),
  ]);
  expect(tiers).toEqual(["mid", "rich"]);
});

test("the far tier thins dense chunks only", () => {
  expect([0, 1, 2, 3].map((i) => keepInFarTier(i, 100))).toEqual([
    true,
    true,
    true,
    true,
  ]);
  expect([0, 1, 2, 3].map((i) => keepInFarTier(i, 1000))).toEqual([
    true,
    false,
    true,
    false,
  ]);
});
