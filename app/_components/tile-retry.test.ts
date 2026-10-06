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
 *  Its cache's `remove` unloads a tile, as the renderer's does; `update`
 *  asks for the tiles `wanted` names (QUEUED is above UNLOADED) and ends
 *  with its "update-after". */
function fakeTiles() {
  const calls: string[] = [];
  const listeners = new Set<() => void>();
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
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const update = (...wanted: FakeTile[]) => {
    for (const tile of wanted) {
      tile.internal.loadingState = LOADING;
    }
    for (const listener of listeners) {
      listener();
    }
  };
  return { tiles, calls, update, listeners };
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
  watch.dispose();
});

test("the network's word goes once the last tile it failed lands, not before", () => {
  const { tiles, update } = fakeTiles();
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => true,
    onBootGiveUp: () => undefined,
  });
  const a = failedTile("a");
  const b = failedTile("b");
  watch.failed(a, lost(), "/a", false);
  watch.failed(b, lost(), "/b", false);
  jest.advanceTimersByTime(5000);
  update(a, b);
  expect(watch.landed(a)).toBe(false);
  // a tile that never failed says nothing either
  expect(watch.landed(failedTile("other"))).toBe(false);
  expect(watch.landed(b)).toBe(true);
  expect(watch.landed(b)).toBe(false);
  watch.dispose();
});

test("a tile asked for again that the renderer no longer wants does not hold the network's word up", () => {
  for (const told of [true, false]) {
    const { tiles, update, listeners } = fakeTiles();
    let cleared = 0;
    const watch = createNetworkWatch({
      tiles,
      bootOver: () => true,
      onBootGiveUp: () => undefined,
      onClear: told
        ? () => {
            cleared++;
          }
        : undefined,
    });
    const away = failedTile("away");
    watch.failed(away, lost(), "/away", false);
    jest.advanceTimersByTime(5000);
    // the player moved on: the update after the heal leaves it UNLOADED
    update();
    // said at once where the caller listens, else at the next landing
    expect(cleared).toBe(told ? 1 : 0);
    expect(watch.landed(failedTile("next"))).toBe(!told);
    watch.dispose();
    expect(listeners.size).toBe(0);
  }
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
  // any content landing means the tileset is back
  expect(watch.landed({ id: "y" })).toBe(true);
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
  expect(watch.landed(landed)).toBe(false);
  loading.internal.loadingState = LOADING;
  away.internal.loadingState = UNLOADED;
  jest.advanceTimersByTime(5000);
  // nothing unloaded, nothing aborted
  expect(calls).toEqual(["reset"]);
  // and once the one on its way lands, nothing is out (the third is not
  // wanted now)
  expect(watch.landed(loading)).toBe(true);
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

test("the boot's wait ends when what it waited for lands, and a later give-up waits afresh", () => {
  const { tiles } = fakeTiles();
  const given: Error[] = [];
  const watch = createNetworkWatch({
    tiles,
    bootOver: () => false,
    onBootGiveUp: (error) => given.push(error),
  });
  const spawn = failedTile("spawn");
  watch.failed(null, lost(), "/tileset.json", true);
  watch.failed(spawn, lost(), "/spawn", true);
  // healed at 5 s, back at 30 s (its content: the tileset is back too)
  jest.advanceTimersByTime(30_000);
  watch.landed(spawn);
  // a slow link, the rest of the spawn tile still on its way: no give-up
  jest.advanceTimersByTime(60_000);
  expect(given).toEqual([]);
  // another blip at 90 s: a minute from then
  watch.failed(failedTile("terrain"), lost(), "/spawn-terrain", true);
  jest.advanceTimersByTime(59_000);
  expect(given).toEqual([]);
  jest.advanceTimersByTime(2000);
  expect(given.length).toBe(1);
  watch.dispose();
});
