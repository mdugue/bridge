import { expect, test } from "bun:test";
import type { ReachBox, ReachView } from "@/lib/city/ground-reach";
import { createGroundReachFollow } from "./ground-reach-follow";
import type { GroundDetail } from "./terrain-layer";

/** A level's detail `x` metres east of the origin, its swaps noted. */
function detailAt(x: number, far: boolean, log: string[], name: string) {
  let now = far;
  let finish: (() => void) | null = null;
  const detail: GroundDetail = {
    box: { min: [x, 0, 0], max: [x + 100, 0, 100] },
    far: () => now,
    setFar: async (next) => {
      log.push(`${name} ${next ? "far" : "near"}`);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      now = next;
      return true;
    },
  };
  return { detail, finish: () => finish?.() };
}

const settle = async () =>
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** 1000 px over a 90° opening: a pixel spans 2 mm a metre of distance. */
const view: ReachView = {
  kind: "perspective",
  eye: [0, 0, 0],
  fovDeg: 90,
  heightPx: 1000,
};

const at = (x: number): ReachBox => ({ min: [x, 0, 0], max: [x, 0, 0] });

test("a level starts on the set its distance asks for", () => {
  const follow = createGroundReachFollow({
    details: () => [],
    onSwap: () => {},
    view: () => view,
  });
  expect(follow.startsFar(at(100))).toBe(false);
  expect(follow.startsFar(at(1000))).toBe(true);
});

test("one swap at a time, the nearest wrong level first; a level inside the hysteresis keeps its set", async () => {
  const log: string[] = [];
  let swaps = 0;
  // 100 m: near; 450 m (0.9 m a pixel): between the thresholds; 2 km: far
  const close = detailAt(100, true, log, "close");
  const between = detailAt(450, false, log, "between");
  const distant = detailAt(2000, false, log, "distant");
  const follow = createGroundReachFollow({
    details: () => [distant.detail, between.detail, close.detail],
    onSwap: () => {
      swaps += 1;
    },
    view: () => view,
  });
  follow.tick();
  follow.tick();
  expect(log).toEqual(["close near"]);
  close.finish();
  await settle();
  expect(swaps).toBe(1);
  follow.tick();
  expect(log).toEqual(["close near", "distant far"]);
  distant.finish();
  await settle();
  follow.tick();
  expect(log).toEqual(["close near", "distant far"]);
});
