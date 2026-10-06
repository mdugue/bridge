import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { NetworkError } from "@/lib/city/fetch-retry";
import type { CrashTrail } from "./crash-trail";
import { createNetworkWatch, type HealableTiles } from "./tile-retry";

/** 3d-tiles-renderer's loading states (FAILED, UNLOADED, LOADING). */
const FAILED = -1;
const UNLOADED = 0;
const LOADING = 2;

interface FakeTile {
  id: string;
  internal: { loadingState: number };
}

/** A tile as the renderer leaves it after a load that gave up: FAILED. */
const failedTile = (id: string): FakeTile => ({
  id,
  internal: { loadingState: FAILED },
});

/** The renderer as the healer sees it: what it was asked to do, in order.
 *  Its cache's `remove` unloads a tile, as the renderer's does. */
function fakeTiles() {
  const calls: string[] = [];
  const tiles: HealableTiles = {
    lruCache: {
      remove: (item) => {
        const tile = item as FakeTile;
        calls.push(`remove ${tile.id}`);
        tile.internal.loadingState = UNLOADED;
        return true;
      },
    },
    resetFailedTiles: () => calls.push("reset"),
  };
  return { tiles, calls };
}

function fakeTrail() {
  const notes: string[] = [];
  const trail = {
    note: (kind: string) => notes.push(kind),
  } as unknown as CrashTrail;
  return { trail, notes };
}

const lost = () => new NetworkError("network: Load failed (5 attempts)", 5);

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test("a tile that gave up on the network leaves the cache before the failed tiles are reset, five seconds on", () => {
  const { tiles, calls } = fakeTiles();
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => true,
    onBootGiveUp: () => undefined,
  });
  const a = failedTile("a");
  const b = failedTile("b");
  expect(watch.failed(a, lost(), "/a.glb.gz", false)).toBe(true);
  expect(watch.failed(b, new TypeError("Load failed"), "/b", false)).toBe(true);
  jest.advanceTimersByTime(4999);
  expect(calls).toEqual([]);
  jest.advanceTimersByTime(1);
  // (resetFailedTiles alone never asks for a tile the cache still holds)
  expect(calls).toEqual(["remove a", "remove b", "reset"]);
  expect(watch.landed(a)).toBe(true);
  expect(watch.landed(a)).toBe(false);
  watch.dispose();
});

test("the tileset itself is reset without a cache entry; a failure that is not the network's is left to the caller", () => {
  const { tiles, calls } = fakeTiles();
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => true,
    onBootGiveUp: () => undefined,
  });
  const http = new Error("Failed to load model with error code 404");
  expect(watch.failed({ id: "x" }, http, "/x", false)).toBe(false);
  expect(watch.failed(null, lost(), "/tileset.json", false)).toBe(true);
  jest.advanceTimersByTime(5000);
  expect(calls).toEqual(["reset"]);
  expect(watch.landed({ id: "x" })).toBe(false);
  watch.dispose();
});

test("a tile the cache let go of before the heal is left alone: in view again, it comes back by itself", () => {
  const { tiles, calls } = fakeTiles();
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => true,
    onBootGiveUp: () => undefined,
  });
  const landed = failedTile("landed");
  const loading = failedTile("loading");
  const away = failedTile("away");
  for (const tile of [landed, loading, away]) {
    watch.failed(tile, lost(), tile.id, false);
  }
  // all three evicted while FAILED (UNLOADED again), two of them asked for
  // again through the renderer's own path, one back already
  landed.internal.loadingState = LOADING;
  expect(watch.landed(landed)).toBe(true);
  loading.internal.loadingState = LOADING;
  away.internal.loadingState = UNLOADED;
  jest.advanceTimersByTime(5000);
  // nothing unloaded, nothing aborted
  expect(calls).toEqual(["reset"]);
  watch.dispose();
});

test("a tile failing again waits longer before the next try", () => {
  const { tiles, calls } = fakeTiles();
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => true,
    onBootGiveUp: () => undefined,
  });
  const a = failedTile("a");
  watch.failed(a, lost(), "/a", false);
  jest.advanceTimersByTime(5000);
  a.internal.loadingState = FAILED;
  watch.failed(a, lost(), "/a", false);
  jest.advanceTimersByTime(14_999);
  expect(calls).toEqual(["remove a", "reset"]);
  jest.advanceTimersByTime(1);
  expect(calls).toEqual(["remove a", "reset", "remove a", "reset"]);
  watch.dispose();
});

test("a disposed watch asks for nothing more", () => {
  const { tiles, calls } = fakeTiles();
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => true,
    onBootGiveUp: () => undefined,
  });
  watch.failed(failedTile("a"), lost(), "/a", false);
  watch.dispose();
  jest.advanceTimersByTime(200_000);
  expect(calls).toEqual([]);
});

test("a network give-up is noted with the page's state, and one at the boot as a wait", () => {
  const { tiles } = fakeTiles();
  const { trail, notes } = fakeTrail();
  const watch = createNetworkWatch({
    tiles,
    trail,
    bootOver: () => false,
    onBootGiveUp: () => undefined,
  });
  watch.failed(failedTile("a"), lost(), "/a", false);
  watch.failed(failedTile("s"), lost(), "/spawn", true);
  expect(notes).toEqual(["load-error", "load-error", "net-wait"]);
  watch.dispose();
});

test("the boot gives up on the network after a minute of a usable page without its tiles, and not before", () => {
  const { tiles } = fakeTiles();
  const given: Error[] = [];
  let booted = false;
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => booted,
    onBootGiveUp: (error) => given.push(error),
  });
  watch.failed(failedTile("s"), lost(), "/spawn", true);
  jest.advanceTimersByTime(58_000);
  expect(given).toEqual([]);
  jest.advanceTimersByTime(3000);
  expect(given.length).toBe(1);
  expect(given[0]?.message).toStartWith("network: ");
  watch.dispose();
  // a first frame ends the wait
  const second = createNetworkWatch({
    tiles,
    bootOver: () => booted,
    onBootGiveUp: (error) => given.push(error),
  });
  second.failed(failedTile("s"), lost(), "/spawn", true);
  booted = true;
  jest.advanceTimersByTime(120_000);
  expect(given.length).toBe(1);
  second.dispose();
});
