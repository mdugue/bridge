import { expect, test } from "bun:test";
import {
  BOOT_VEIL,
  distanceToBounds,
  loadFrontier,
  NO_VEIL,
  stepVeil,
  VEIL_DELAY_S,
  VEIL_HORIZON_M,
  type VeilState,
} from "./load-frontier";
import type { TerrainBounds } from "./terrain-geometry";

const SPAWN: TerrainBounds = [412_000, 5_656_000, 414_000, 5_658_000];
const EAST: TerrainBounds = [414_000, 5_656_000, 416_000, 5_658_000];
const BOUNDS = new Map([
  ["spawn", SPAWN],
  ["east", EAST],
]);

test("distance to a tile is 0 inside and the gap outside", () => {
  expect(distanceToBounds(SPAWN, 413_000, 5_657_000)).toBe(0);
  expect(distanceToBounds(EAST, 413_000, 5_657_000)).toBe(1000);
  expect(distanceToBounds(EAST, 413_000, 5_659_000)).toBeCloseTo(
    Math.hypot(1000, 1000)
  );
});

test("the frontier is the nearest pending tile, null when none is", () => {
  const at = [413_500, 5_657_000] as const;
  expect(loadFrontier(BOUNDS, ["east"], ...at)).toBe(500);
  expect(loadFrontier(BOUNDS, ["east", "spawn"], ...at)).toBe(0);
  expect(loadFrontier(BOUNDS, [], ...at)).toBeNull();
  // a tile the site does not know does not hold the frontier
  expect(loadFrontier(BOUNDS, ["elsewhere"], ...at)).toBeNull();
});

function run(state: VeilState, frontier: number | null, seconds: number) {
  let s = state;
  for (let t = 0; t < seconds; t += 1 / 60) {
    s = stepVeil(s, frontier, 1 / 60);
  }
  return s;
}

test("the boot is veiled from the first frame, ring at the feet", () => {
  expect(BOOT_VEIL.strength).toBe(1);
  expect(stepVeil(BOOT_VEIL, 0, 1 / 60).radius).toBe(0);
});

test("the ring eases out to the frontier instead of jumping", () => {
  const first = stepVeil(BOOT_VEIL, 800, 1 / 60);
  expect(first.radius).toBeGreaterThan(0);
  expect(first.radius).toBeLessThan(100);
  expect(run(BOOT_VEIL, 800, 6).radius).toBeCloseTo(800, 0);
});

test("with nothing pending the ring sweeps to the horizon, then lifts", () => {
  const swept = run({ radius: 300, strength: 1, pendingFor: 4 }, null, 3);
  expect(swept.radius).toBe(VEIL_HORIZON_M);
  const lifted = run(swept, null, 3);
  expect(lifted.strength).toBe(0);
  // ...and the sweep is quick: within two seconds from a few hundred metres
  expect(run({ radius: 300, strength: 1, pendingFor: 4 }, null, 2).radius).toBe(
    VEIL_HORIZON_M
  );
});

test("a short top-up never shows; a long one comes in at its frontier", () => {
  const short = run(NO_VEIL, 1500, VEIL_DELAY_S * 0.8);
  expect(short.strength).toBe(0);
  const long = run(NO_VEIL, 1500, VEIL_DELAY_S + 0.1);
  expect(long.strength).toBeGreaterThan(0);
  expect(long.radius).toBeCloseTo(1500, 0);
  expect(run(long, 1500, 2).strength).toBe(1);
  // the next spell waits again
  expect(stepVeil(run(long, null, 10), 1500, 1 / 60).strength).toBe(0);
});
