import { expect, test } from "bun:test";
import { createProblemGate } from "@/lib/city/crash-reports";
import {
  ERROR_REPEAT_S,
  ERROR_REPEATED,
  errorCoalescer,
  trailUrl,
} from "./crash-trail";

test("the trail keeps the path and the QA knobs of the URL, nothing else", () => {
  expect(trailUrl("/dresden", "")).toBe("/dresden");
  expect(trailUrl("/dresden", "?scene=lite&block=1")).toBe(
    "/dresden?scene=lite&block=1"
  );
  expect(trailUrl("/leipzig", "?at=51.339300,12.372600&gpu=webgl2")).toBe(
    "/leipzig?gpu=webgl2"
  );
  // in the knobs' own order, whatever the given one
  expect(trailUrl("/dresden", "?trail=1&scene=lite")).toBe(
    "/dresden?scene=lite&trail=1"
  );
});

test("an error that comes back every frame is noted once, then counted", () => {
  const noted: string[] = [];
  let now = 0;
  const errors = errorCoalescer(
    (kind, text) => noted.push(kind === "error" ? text : `${kind}: ${text}`),
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
  const repeated = `${ERROR_REPEATED}: boom ×5`;
  expect(noted).toEqual(["boom", repeated, "other"]);
  // past the window the same text is noted again
  now += ERROR_REPEAT_S;
  errors.error("other");
  expect(noted).toEqual(["boom", repeated, "other", "other"]);
  errors.error("other");
  errors.noting("end");
  expect(noted).toEqual([
    "boom",
    repeated,
    "other",
    "other",
    `${ERROR_REPEATED}: other ×2`,
  ]);
});

test("the count is a breadcrumb, not a second problem", () => {
  // a detail without " | " keys on its whole text: "boom ×5" would be
  // another problem than "boom" if it were noted as an error
  const reports = createProblemGate();
  const sent: boolean[] = [];
  const errors = errorCoalescer(
    (kind, detail) => sent.push(reports({ t: 0, kind, detail })),
    () => 0
  );
  errors.error("boom");
  errors.error("boom");
  errors.noting("end");
  expect(sent).toEqual([true, false]);
});

test("a page that goes to the background or leaves keeps the count", () => {
  for (const kind of ["hidden", "pagehide", "end"]) {
    const noted: string[] = [];
    const errors = errorCoalescer(
      (k, text) => noted.push(`${k}: ${text}`),
      () => 0
    );
    errors.error("boom");
    errors.error("boom");
    errors.error("boom");
    // an ordinary event does not end the count
    errors.noting("visible");
    expect(noted).toEqual(["error: boom"]);
    errors.noting(kind);
    expect(noted).toEqual(["error: boom", `${ERROR_REPEATED}: boom ×3`]);
    // and only once
    errors.noting(kind);
    expect(noted).toHaveLength(2);
  }
});
