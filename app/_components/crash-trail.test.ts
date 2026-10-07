import { expect, test } from "bun:test";
import { ERROR_REPEAT_S, errorCoalescer, trailUrl } from "./crash-trail";

test("the trail keeps the path and the QA knobs of the URL, nothing else", () => {
  expect(trailUrl("/dresden", "")).toBe("/dresden");
  expect(trailUrl("/dresden", "?scene=lite&block=1")).toBe(
    "/dresden?scene=lite&block=1"
  );
  expect(trailUrl("/leipzig", "?at=51.339300,12.372600&gpu=webgl2")).toBe(
    "/leipzig?gpu=webgl2"
  );
});

test("an error that comes back every frame is noted once, then counted", () => {
  const noted: string[] = [];
  let now = 0;
  const errors = errorCoalescer(
    (text) => noted.push(text),
    () => now
  );
  // a throw in every frame for a few frames
  for (let i = 0; i < 5; i++) {
    errors.error("boom");
    now += 1 / 60;
  }
  expect(noted).toEqual(["boom"]);
  // another error: the repeats' count goes first
  errors.error("other");
  expect(noted).toEqual(["boom", "boom ×5", "other"]);
  // past the window the same text is noted again
  now += ERROR_REPEAT_S;
  errors.error("other");
  expect(noted).toEqual(["boom", "boom ×5", "other", "other"]);
  errors.error("other");
  errors.flush();
  expect(noted).toEqual(["boom", "boom ×5", "other", "other", "other ×2"]);
});
