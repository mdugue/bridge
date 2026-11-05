import { expect, test } from "bun:test";
import { createDemolitions, replayDemolitions } from "./demolitions";
import type { DemolishedLayer, DemolitionMemory } from "./demolitions";

/** A tile's layer of `groups.length` objects, as the demolish asks it. */
function layerOf(tile: string, groups: number[]): DemolishedLayer {
  const alive = new Uint8Array(groups.length).fill(1);
  return {
    alive,
    demolish: (i: number) => {
      if (!alive[i]) {
        return false;
      }
      // the whole ensemble of a group goes with it, as the layer's own does
      for (let k = 0; k < groups.length; k += 1) {
        if (k === i || (groups[i] && groups[k] === groups[i])) {
          alive[k] = 0;
        }
      }
      return true;
    },
    table: { group: new Uint32Array(groups) },
    tile,
  } as unknown as DemolishedLayer;
}

const memoryOf = (...cities: DemolishedLayer[]): DemolitionMemory => ({
  cities,
  demolished: new Map(),
  demolishedGroups: new Set(),
});

test("a demolish takes the object and remembers it for its tile", () => {
  const near = layerOf("a", [0, 0]);
  const memory = memoryOf(near);
  const demolitions = createDemolitions(memory);
  expect(demolitions.demolish(near, 1)).toBe(true);
  expect([...near.alive]).toEqual([1, 0]);
  expect([...(demolitions.goneOn("a") ?? [])]).toEqual([1]);
  expect(demolitions.goneOn("b")).toBeUndefined();
  // no ensemble: no group kept
  expect(memory.demolishedGroups.size).toBe(0);
});

test("what is gone already stays out of the memory's way", () => {
  const near = layerOf("a", [0, 0]);
  const demolitions = createDemolitions(memoryOf(near));
  demolitions.demolish(near, 0);
  expect(demolitions.demolish(near, 0)).toBe(false);
});

test("the tile's other level loses the same object", () => {
  const near = layerOf("a", [0, 0]);
  const far = layerOf("a", [0, 0]);
  createDemolitions(memoryOf(near, far)).demolish(near, 0);
  expect([...far.alive]).toEqual([0, 1]);
});

test("an ensemble goes across the tile edge, and its group stays for later", () => {
  const here = layerOf("a", [7, 0]);
  const across = layerOf("b", [0, 7]);
  const memory = memoryOf(here, across);
  const demolitions = createDemolitions(memory);
  demolitions.demolish(here, 0);
  expect([...across.alive]).toEqual([1, 0]);
  expect([...(demolitions.goneOn("b") ?? [])]).toEqual([1]);
  expect([...memory.demolishedGroups]).toEqual([7]);
});

test("a tile that loads later takes its own and its ensembles' demolitions back", () => {
  const alive = new Uint8Array(4).fill(1);
  const group = [0, 7, 7, 0];
  expect(replayDemolitions(alive, group, new Set([0]), new Set([7]))).toBe(3);
  expect([...alive]).toEqual([0, 0, 0, 1]);
});

test("an object both remembered and in a group counts once", () => {
  const alive = new Uint8Array(2).fill(1);
  expect(replayDemolitions(alive, [7, 0], new Set([0]), new Set([7]))).toBe(1);
});

test("nothing demolished replays nothing", () => {
  const alive = new Uint8Array(2).fill(1);
  expect(replayDemolitions(alive, [0, 0], new Set(), new Set())).toBe(0);
  expect([...alive]).toEqual([1, 1]);
});
