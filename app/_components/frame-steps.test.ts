import { expect, test } from "bun:test";
import { FRAME_STEPS, frameOf } from "./frame-steps";
import type { FrameStep } from "./frame-steps";

test("a frame's steps and their order", () => {
  // changing this list changes what every frame does first: the reasons
  // for the order stand in frame-steps.ts
  expect([...FRAME_STEPS]).toEqual([
    "clock",
    "move",
    "stream",
    "follow",
    "view",
    "tick",
    "overlay",
    "render",
    "after",
  ]);
});

/** Steps that note their name, named in an order that is not the list's. */
function noting(ran: string[], failing?: FrameStep) {
  const names = [...FRAME_STEPS].reverse();
  return Object.fromEntries(
    names.map((name) => [
      name,
      (frame: { time: number }) => {
        if (name === failing) {
          throw new Error(name);
        }
        ran.push(`${name}@${frame.time}`);
      },
    ])
  ) as Record<FrameStep, (frame: { time: number }) => void>;
}

test("a frame runs every step once, in the list's order, on one state", () => {
  const ran: string[] = [];
  const frame = frameOf((time) => ({ time }), noting(ran));
  frame(7);
  expect(ran).toEqual(FRAME_STEPS.map((name) => `${name}@7`));
  frame(8);
  expect(ran.length).toBe(2 * FRAME_STEPS.length);
});

test("a step that throws ends the frame there", () => {
  const ran: string[] = [];
  const frame = frameOf((time) => ({ time }), noting(ran, "tick"));
  expect(() => frame(1)).toThrow("tick");
  expect(ran).toEqual(["clock@1", "move@1", "stream@1", "follow@1", "view@1"]);
});
