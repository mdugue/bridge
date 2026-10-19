import { describe, expect, test } from "bun:test";
import {
  bakeLimits,
  bakeMode,
  createSlots,
  PROCESS_PEAK,
  SITE_PEAK,
  TILE_PEAK,
  warmersOn,
  warmSteps,
} from "./warmers";

const TILES = ["a", "b", "c", "d", "e"];

describe("bakeMode", () => {
  test("reads a warmer's tiles, and publishes without one", () => {
    expect(bakeMode([], TILES)).toEqual({ kind: "publish", ifCached: false });
    expect(bakeMode(["--if-cached"], TILES)).toEqual({
      kind: "publish",
      ifCached: true,
    });
    expect(bakeMode(["--warm-ground=a,c"], TILES)).toEqual({
      kind: "ground",
      tiles: ["a", "c"],
    });
    expect(bakeMode(["--warm=e"], TILES)).toEqual({
      kind: "tiles",
      tiles: ["e"],
    });
  });

  test("refuses what it does not know rather than publishing", () => {
    expect(() => bakeMode(["--warm=a,x"], TILES)).toThrow("x");
    expect(() => bakeMode(["--warm=a", "b"], TILES)).toThrow("unknown");
    expect(() => bakeMode(["--warm-grounds=a"], TILES)).toThrow("unknown");
    expect(() => bakeMode(["--if-cached", "--warm=a"], TILES)).toThrow(
      "unknown"
    );
  });
});

test("every ground is cached before a tile is baked on them, then the site publishes", () => {
  const steps = warmSteps(TILES).map((step) =>
    step.map(({ args }) => args.join(" "))
  );
  expect(steps).toEqual([
    ["--warm-ground=a"],
    [
      "--warm-ground=b",
      "--warm-ground=c",
      "--warm-ground=d",
      "--warm-ground=e",
    ],
    ["--warm=a", "--warm=b", "--warm=c", "--warm=d", "--warm=e"],
    [""],
  ]);
  // only a tile warmer bakes buildings, the heavy part
  expect(warmSteps(TILES)[2].every((run) => run.peak === TILE_PEAK)).toBe(true);
  expect(warmSteps(TILES)[1].every((run) => run.peak === PROCESS_PEAK)).toBe(
    true
  );
});

describe("bakeLimits", () => {
  test("on a 4-core, 8 GB builder the bakes' peaks stay under 6.5 GB, two tile warmers or four other bakes at once", () => {
    const { jobs, memory } = bakeLimits({ cores: 4, memory: 8e9 });
    expect(jobs).toBe(4);
    expect(memory).toBeLessThanOrEqual(6.5e9);
    expect(Math.floor(memory / TILE_PEAK)).toBeGreaterThanOrEqual(2);
    expect(Math.floor(memory / PROCESS_PEAK)).toBeGreaterThanOrEqual(4);
  });

  test("on Vercel's 4-core, 8.6 GB builder two whole sites bake at once, as before the warmers", () => {
    const { memory } = bakeLimits({ cores: 4, memory: 8.6e9 });
    expect(Math.floor(memory / SITE_PEAK)).toBe(2);
  });

  test("PREPARE_JOBS and PREPARE_MEMORY_GB override, or fail", () => {
    expect(
      bakeLimits({
        cores: 4,
        memory: 16e9,
        env: { PREPARE_JOBS: "2", PREPARE_MEMORY_GB: "8" },
      })
    ).toEqual(bakeLimits({ cores: 2, memory: 8e9 }));
    expect(
      bakeLimits({ cores: 4, memory: 8e9, env: { PREPARE_JOBS: "" } })
    ).toEqual(bakeLimits({ cores: 4, memory: 8e9 }));
    for (const env of [
      { PREPARE_JOBS: "two" },
      { PREPARE_JOBS: "1.5" },
      { PREPARE_JOBS: "0" },
      { PREPARE_MEMORY_GB: "-8" },
    ]) {
      expect(() => bakeLimits({ cores: 4, memory: 8e9, env })).toThrow(
        "PREPARE_"
      );
    }
  });
});

describe("warmersOn", () => {
  test("off unless PREPARE_WARMERS=1, and a stray value fails", () => {
    expect(warmersOn({})).toBe(false);
    expect(warmersOn({ PREPARE_WARMERS: "" })).toBe(false);
    expect(warmersOn({ PREPARE_WARMERS: "0" })).toBe(false);
    expect(warmersOn({ PREPARE_WARMERS: "1" })).toBe(true);
    expect(() => warmersOn({ PREPARE_WARMERS: "yes" })).toThrow(
      "PREPARE_WARMERS"
    );
  });
});

describe("createSlots", () => {
  /** Tasks that run until released; what started, in order. */
  function harness(limits: { jobs: number; memory: number }) {
    const slots = createSlots(limits);
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const runs: Promise<void>[] = [];
    const task = (name: string, priority: number, peak: number) => {
      runs.push(
        slots.run(priority, peak, async () => {
          started.push(name);
          await new Promise<void>((done) => releases.set(name, done));
        })
      );
    };
    const finish = async (name: string) => {
      releases.get(name)?.();
      await new Promise((settle) => setTimeout(settle, 0));
    };
    return { finish, runs, started, task };
  }

  test("at most `jobs` at once, a lower priority first among the waiting", async () => {
    const { finish, runs, started, task } = harness({ jobs: 2, memory: 10 });
    task("small 1", 1, 1);
    task("small 2", 1, 1);
    task("small 3", 1, 1);
    task("large", 0, 1);
    await finish("none");
    expect(started).toEqual(["small 1", "small 2"]);
    await finish("small 1");
    expect(started).toEqual(["small 1", "small 2", "large"]);
    await finish("small 2");
    await finish("large");
    await finish("small 3");
    await Promise.all(runs);
    expect(started).toEqual(["small 1", "small 2", "large", "small 3"]);
  });

  test("peaks within the memory; a heavy task waits, and is not passed over", async () => {
    const { finish, runs, started, task } = harness({ jobs: 4, memory: 6 });
    task("heavy 1", 0, 3);
    task("heavy 2", 0, 3);
    task("heavy 3", 0, 3);
    task("light", 1, 1);
    await finish("none");
    // 3 + 3 fill the memory: the third heavy waits, the light one behind it
    expect(started).toEqual(["heavy 1", "heavy 2"]);
    await finish("heavy 1");
    expect(started).toEqual(["heavy 1", "heavy 2", "heavy 3"]);
    await finish("heavy 2");
    expect(started).toEqual(["heavy 1", "heavy 2", "heavy 3", "light"]);
    await finish("heavy 3");
    await finish("light");
    await Promise.all(runs);
  });

  test("a task heavier than the memory still runs, alone", async () => {
    const { finish, runs, started, task } = harness({ jobs: 4, memory: 2 });
    task("huge", 0, 5);
    task("light", 0, 1);
    await finish("none");
    expect(started).toEqual(["huge"]);
    await finish("huge");
    expect(started).toEqual(["huge", "light"]);
    await finish("light");
    await Promise.all(runs);
  });
});
