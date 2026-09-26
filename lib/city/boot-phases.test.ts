import { expect, test } from "bun:test";
import { type BootInputs, createBootPhases } from "./boot-phases";

const at = (over: Partial<BootInputs> = {}): BootInputs => ({
  siteTiles: 15,
  tilesIdle: false,
  loadProgress: 0.4,
  dressingsBuilt: 0,
  dressingsQueued: 3,
  spawnDressed: false,
  ...over,
});

const fraction = (
  step: ReturnType<ReturnType<typeof createBootPhases>["update"]>,
  id: string
) => step.stages.filter((s) => s.id === id).at(-1)?.fraction;

test("before the gate only the surroundings move, and never back", () => {
  const boot = createBootPhases();
  expect(fraction(boot.update(at({ loadProgress: 0.5 })), "surroundings")).toBe(
    0.5
  );
  const step = boot.update(at({ loadProgress: 0.3 }));
  expect(fraction(step, "surroundings")).toBe(0.5);
  expect(fraction(step, "details")).toBeUndefined();
  // idle and dressed, but the gate is shut: not loaded
  expect(
    boot.update(at({ tilesIdle: true, dressingsQueued: 0, spawnDressed: true }))
      .loaded
  ).toBe(false);
});

test("the lite profile's single tile skips the surroundings", () => {
  const step = createBootPhases().update(at({ siteTiles: 1 }));
  expect(step.stages[0]).toEqual({
    id: "surroundings",
    fraction: 1,
    skipped: true,
  });
});

test("the progress bars stop short of full until the stream is really idle", () => {
  const boot = createBootPhases();
  expect(boot.startStreaming()).toBe(true);
  expect(boot.startStreaming()).toBe(false);
  const step = boot.update(
    at({ loadProgress: 1, dressingsBuilt: 9, dressingsQueued: 0 })
  );
  expect(fraction(step, "surroundings")).toBe(0.99);
  expect(fraction(step, "details")).toBe(0.99); // spawn not tried yet
  expect(step.loaded).toBe(false);
});

test("loaded fires once, then only busy flips are reported", () => {
  const boot = createBootPhases();
  boot.startStreaming();
  const idle = at({ tilesIdle: true, dressingsQueued: 0, spawnDressed: true });
  const first = boot.update(idle);
  expect(first.loaded).toBe(true);
  expect(fraction(first, "details")).toBe(1);
  expect(boot.isLoaded).toBe(true);
  expect(boot.update(idle)).toEqual({ stages: [], loaded: false });
  expect(boot.update(at({ spawnDressed: true })).busy).toBe(true);
  expect(boot.update(at({ spawnDressed: true })).busy).toBeUndefined();
  expect(boot.update(idle).busy).toBe(false);
});
