import { expect, test } from "bun:test";
import { trailUrl } from "./crash-trail";

test("the trail keeps the path and the QA knobs of the URL, nothing else", () => {
  expect(trailUrl("/dresden", "")).toBe("/dresden");
  expect(trailUrl("/dresden", "?scene=lite&block=1")).toBe(
    "/dresden?scene=lite&block=1"
  );
  expect(trailUrl("/leipzig", "?at=51.339300,12.372600&gpu=webgl2")).toBe(
    "/leipzig?gpu=webgl2"
  );
});
