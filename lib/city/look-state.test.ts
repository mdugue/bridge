import { expect, test } from "bun:test";
import { LOOK_DEFAULTS, lookPatch, type LookValues } from "./look-controls";
import { clampLook, createLookState } from "./look-state";

test("boots at the table defaults and keeps the same object until a change", () => {
  const look = createLookState();
  expect(look.get()).toEqual(LOOK_DEFAULTS);
  const before = look.get();
  look.set({ fogAmount: LOOK_DEFAULTS.fogAmount });
  expect(look.get()).toBe(before);
  look.set({ fogAmount: 0.9 });
  expect(look.get()).not.toBe(before);
  expect(look.get().fogAmount).toBe(0.9);
  // Untouched keys survive a partial set.
  expect(look.get().grain).toBe(LOOK_DEFAULTS.grain);
});

test("set notifies once per change with the new values, never for a no-op", () => {
  const look = createLookState();
  const seen: number[] = [];
  const stop = look.subscribe((v) => seen.push(v.grain));
  look.set({ grain: 0.5, contact: 0.7 });
  look.set({ grain: 0.5 });
  expect(seen).toEqual([0.5]);
  stop();
  look.set({ grain: 0.1 });
  expect(seen).toEqual([0.5]);
});

test("clampLook keeps percent rows inside [0, max] and the focus distance at 1 m or more", () => {
  expect(clampLook({ fogAmount: 1.5, transparency: 0.95, grain: -1 })).toEqual({
    fogAmount: 1,
    transparency: 0.9,
    grain: 0,
  });
  expect(clampLook({ focusDistanceM: 0 })).toEqual({ focusDistanceM: 1 });
  expect(
    clampLook({ dof: false, focusMode: "manual", multiTuft: false })
  ).toEqual({ dof: false, focusMode: "manual", multiTuft: false });
});

test("clampLook keeps a known style and drops an unknown one", () => {
  expect(clampLook({ style: "noir" })).toEqual({ style: "noir" });
  expect(
    clampLook({ style: "ghost" } as unknown as Partial<LookValues>)
  ).toEqual({});
  const look = createLookState();
  look.set({ style: "sincity" });
  expect(look.get().style).toBe("sincity");
});

test("non-finite numbers and unknown keys are dropped", () => {
  const look = createLookState();
  look.set({ fogAmount: Number.NaN, focusDistanceM: Number.POSITIVE_INFINITY });
  look.set({ sparkle: 1 } as unknown as Partial<LookValues>);
  expect(look.get()).toEqual(LOOK_DEFAULTS);
});

test("lookPatch builds a typed one-row patch", () => {
  expect(lookPatch("rim", 0.3)).toEqual({ rim: 0.3 });
});
