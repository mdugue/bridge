import { expect, test } from "bun:test";
import { finished } from "@/lib/city/build-steps";
import type { Steps } from "@/lib/city/build-steps";
import {
  beginFigures,
  builderSteps,
  builderSync,
  dressingFigures,
  figuresKey,
  noteDressingBytes,
} from "./dressing-figures";
import { streamTimings } from "./stream-timing";

function* three(): Steps<string> {
  yield;
  yield;
  return "built";
}

test("a builder's steps are counted once they end, under its level", () => {
  const key = figuresKey("t1", "fine");
  beginFigures(key);
  const before = streamTimings.summary()["dressing:trees"]?.count ?? 0;
  const steps = builderSteps(key, "trees", three());
  steps.next();
  expect(dressingFigures()[key].ms.trees).toBeUndefined();
  expect(finished(steps)).toBe("built");
  expect(dressingFigures()[key].ms.trees).toBeGreaterThanOrEqual(0);
  expect(streamTimings.summary()["dressing:trees"].count).toBe(before + 1);
});

test("a plain builder is timed, its parts' bytes noted; a new build starts over", () => {
  const key = figuresKey("t2", "coarse");
  beginFigures(key);
  expect(builderSync(key, "lamps", () => 7)).toBe(7);
  noteDressingBytes(key, { lamps: 64 });
  expect(dressingFigures()[key].bytes).toEqual({ lamps: 64 });
  expect(Object.keys(dressingFigures()[key].ms)).toEqual(["lamps"]);
  beginFigures(key);
  expect(dressingFigures()[key]).toEqual({ bytes: {}, ms: {} });
});
