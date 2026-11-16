/** The scene's half of the debug hook: a probe never reaches a build
 *  without it (this test's own: NODE_ENV is "test", no
 *  NEXT_PUBLIC_POC_DEBUG). */
import { expect, test } from "bun:test";
import {
  pocCounts,
  pocEnabled,
  pocFramesHeld,
  pocFrameTime,
  pocPhase,
  setPocProbe,
  STILL_PHASE_S,
} from "./poc-scene";

test("without the debug hook a probe holds nothing", () => {
  expect(pocEnabled).toBe(false);
  setPocProbe({ hold: true, frameMs: 50, still: true });
  expect(pocFramesHeld()).toBe(false);
  expect(pocFrameTime(1234)).toBe(1234);
  expect(pocPhase(12.5)).toBe(12.5);
  expect(pocPhase(12.5)).not.toBe(STILL_PHASE_S);
  expect(pocCounts()).toBeNull();
});
