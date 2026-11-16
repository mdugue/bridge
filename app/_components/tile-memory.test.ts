import { expect, test } from "bun:test";
import { MEMORY_STEPS } from "@/lib/city/memory-governor";
import { bindTileMemory } from "./tile-memory";
import type { GovernedTiles, TileMemoryContext } from "./tile-memory";

const MB = 1_048_576;

function bound(over: Partial<TileMemoryContext> = {}) {
  const tiles: GovernedTiles = {
    errorTarget: 6,
    lruCache: { minBytesSize: 200 * MB, maxBytesSize: 300 * MB },
  };
  const state = { held: 100 * MB, shedding: false };
  const notes: string[] = [];
  const memory = bindTileMemory({
    tiles,
    tier: "mobile",
    safety: 0,
    held: () => state.held,
    shedding: () => state.shedding,
    note: (detail) => {
      notes.push(detail);
    },
    ...over,
  });
  return { tiles, state, notes, memory };
}

test("a page starts at its safety level's floor, on the bounds the stream came with", () => {
  const plain = bound();
  expect(plain.tiles.errorTarget).toBe(6);
  expect(plain.tiles.lruCache.minBytesSize).toBe(200 * MB);
  plain.memory.dispose();
  const careful = bound({ safety: 2 });
  expect(careful.tiles.errorTarget).toBe(6 * MEMORY_STEPS[2].errorScale);
  expect(careful.tiles.lruCache.minBytesSize).toBe(
    200 * MB * MEMORY_STEPS[2].minScale
  );
  expect(careful.tiles.lruCache.maxBytesSize).toBe(300 * MB);
  careful.memory.dispose();
});

test("what is reserved comes out of both bounds, the upper never under the lower", () => {
  const { tiles, memory } = bound();
  memory.reserve(50 * MB);
  expect(tiles.lruCache.minBytesSize).toBe(150 * MB);
  expect(tiles.lruCache.maxBytesSize).toBe(250 * MB);
  memory.reserve(400 * MB);
  expect(tiles.lruCache.minBytesSize).toBe(0);
  expect(tiles.lruCache.maxBytesSize).toBe(0);
  memory.reserve(0);
  expect(tiles.lruCache.minBytesSize).toBe(200 * MB);
  memory.dispose();
});

test("an emergency takes the lowest step once it is applied, and a shedding page keeps no lower bound", () => {
  const { tiles, state, memory } = bound();
  memory.force(1000);
  // (forced, not yet carried out)
  expect(tiles.errorTarget).toBe(6);
  memory.apply();
  expect(tiles.errorTarget).toBe(6 * MEMORY_STEPS[3].errorScale);
  expect(tiles.lruCache.minBytesSize).toBe(200 * MB * MEMORY_STEPS[3].minScale);
  state.shedding = true;
  memory.apply();
  expect(tiles.lruCache.minBytesSize).toBe(0);
  expect(tiles.lruCache.maxBytesSize).toBe(300 * MB);
  state.shedding = false;
  memory.apply();
  expect(tiles.lruCache.minBytesSize).toBe(200 * MB * MEMORY_STEPS[3].minScale);
  memory.dispose();
});
