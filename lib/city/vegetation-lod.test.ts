import { describe, expect, test } from "bun:test";
import {
  type ChunkLodState,
  createCrownPlanScratch,
  createLodSchedule,
  FAR_IN_M,
  FAR_OUT_M,
  keepInFarTier,
  LOD_JUMP_M,
  PHONE_RICH_TREE_BUDGET,
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

test("planCrownTiers spends a phone's smaller budget on the nearest chunks", () => {
  const chunks = [100, 50, 150].map((near) => ({
    allowRich: true,
    current: "mid" as const,
    near,
    trees: 500,
  }));
  expect(planCrownTiers(chunks)).toEqual(["rich", "rich", "rich"]);
  expect(planCrownTiers(chunks, PHONE_RICH_TREE_BUDGET)).toEqual([
    "mid",
    "rich",
    "mid",
  ]);
});

test("a plan in kept arrays answers as a fresh one, for a site that shrank too", () => {
  const scratch = createCrownPlanScratch();
  const site = [
    chunk(150, 1200),
    chunk(0, 1200),
    chunk(50, 1200),
    chunk(100, 1200),
    chunk(FAR_IN_M + 1),
  ];
  expect(planCrownTiers(site, RICH_TREE_BUDGET, scratch)).toEqual(
    planCrownTiers(site)
  );
  // A tile left: the answer is as long as what is left, and the candidates
  // of the pass before have no say.
  const left = [chunk(150, 1200, "rich"), chunk(FAR_IN_M + 1)];
  const tiers = planCrownTiers(left, RICH_TREE_BUDGET, scratch);
  expect(tiers).toBe(scratch.tiers);
  expect(tiers).toEqual(["rich", "far"]);
  expect(tiers).toEqual(planCrownTiers(left));
});

test("a tie in the budget's queue goes to the earlier chunk", () => {
  const tied = [chunk(50, 1500), chunk(50, 1500)];
  expect(planCrownTiers(tied, 2000)).toEqual(["rich", "mid"]);
});

describe("when the tiers are picked", () => {
  const at = (x: number, y = 0, z = 0) => ({ x, y, z });

  test("the first frame picks them, the frames before the next tick do not", () => {
    const schedule = createLodSchedule();
    expect(schedule.due(false, at(0))).toBe(true);
    expect(schedule.due(false, at(1))).toBe(false);
    expect(schedule.due(true, at(1))).toBe(true);
    expect(schedule.due(false, at(1))).toBe(false);
  });

  test("a change of what is in view picks them in the next frame, once", () => {
    const schedule = createLodSchedule();
    schedule.due(true, at(0));
    schedule.force();
    expect(schedule.due(false, at(0))).toBe(true);
    expect(schedule.due(false, at(0))).toBe(false);
  });

  test("a jump picks them at once; walking between ticks does not", () => {
    const schedule = createLodSchedule();
    schedule.due(true, at(0));
    // the fastest flight's tick is 18 m
    expect(schedule.due(false, at(18))).toBe(false);
    expect(schedule.due(false, at(0, 0, LOD_JUMP_M - 1))).toBe(false);
    expect(schedule.due(false, at(0, LOD_JUMP_M + 1))).toBe(true);
    // measured from where the last pass was
    expect(schedule.due(false, at(0, LOD_JUMP_M + 2))).toBe(false);
    expect(schedule.due(false, at(500, 0, 1200))).toBe(true);
  });
});
