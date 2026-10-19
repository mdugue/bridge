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
  expect(look.get().multiTuft).toBe(LOOK_DEFAULTS.multiTuft);
});

test("set notifies once per change with the new values, never for a no-op", () => {
  const look = createLookState();
  const seen: number[] = [];
  const stop = look.subscribe((v) => seen.push(v.fogAmount));
  look.set({ fogAmount: 0.5, multiTuft: false });
  look.set({ fogAmount: 0.5 });
  expect(seen).toEqual([0.5]);
  stop();
  look.set({ fogAmount: 0.1 });
  expect(seen).toEqual([0.5]);
});

test("clampLook keeps percent rows inside [0, 1] and the flags as they are", () => {
  expect(clampLook({ fogAmount: 1.5 })).toEqual({ fogAmount: 1 });
  expect(clampLook({ fogAmount: -1 })).toEqual({ fogAmount: 0 });
  expect(clampLook({ multiTuft: false })).toEqual({ multiTuft: false });
});

test("clampLook keeps the data layers' flags and drops anything else there", () => {
  expect(clampLook({ trafficLayer: true, bikeLayer: false })).toEqual({
    trafficLayer: true,
    bikeLayer: false,
  });
  expect(clampLook({ tramLayer: 1 } as unknown as Partial<LookValues>)).toEqual(
    {}
  );
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
  look.set({ fogAmount: Number.NaN });
  look.set({ fogAmount: Number.POSITIVE_INFINITY });
  look.set({ sparkle: 1 } as unknown as Partial<LookValues>);
  // … a removed control's key too: a QA script written before it went
  look.set({ tint: 0.3, ink: 1 } as unknown as Partial<LookValues>);
  expect(look.get()).toEqual(LOOK_DEFAULTS);
});

test("lookPatch builds a typed one-row patch", () => {
  expect(lookPatch("fogAmount", 0.3)).toEqual({ fogAmount: 0.3 });
});
