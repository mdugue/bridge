import {
  BOOT_NET_WAIT_MS,
  createRetryTally,
  healDelayMs,
  isNetworkFailure,
  NETWORK_PREFIX,
  NetworkError,
} from "@/lib/city/fetch-retry";
import type { CrashTrail } from "./crash-trail";
import {
  describeNet,
  onUsableAgain,
  pageLeaving,
  pageVisible,
  visibleMs,
  watchRetries,
} from "./net-gate";

/**
 * Brings back the tiles whose load gave up on the network, and keeps the
 * boot waiting for them (create-app.ts). A tile's fetch retries on its own
 * first (fetch-optional.ts `fetchBytes`); one that outlasts its budget ends
 * FAILED, and 3d-tiles-renderer 0.5.3 never asks for a FAILED tile again:
 * it counts as loaded (a REPLACE parent gives way to it — a hole in the
 * ground), and its public `resetFailedTiles()` alone does not help — the
 * tile stays in the LRU cache, whose `add` refuses an item it holds, so the
 * request is never made. Removing it from the cache first runs the
 * renderer's own unload (UNLOADED, every plugin's `disposeTile`: ours finds
 * nothing dressed on a tile that never landed, or frees a content root
 * whose dressing threw), and the next `update()` asks for it again. The
 * root tileset (a load-error without a tile) comes back through
 * `resetFailedTiles()`. A tile the cache evicted before the heal is
 * UNLOADED again, and the renderer asks for it itself once it wants it:
 * the heal leaves alone whatever is no longer FAILED.
 *
 * When: as soon as the page may have its network back ("online", visible
 * again, back from the bfcache), and otherwise after 5, 15, 45, then every
 * 120 s while any are waiting (lib/city/fetch-retry.ts HEAL_DELAYS_MS).
 *
 * The HUD's word about the network goes once nothing it failed is
 * outstanding: every tile that gave up has landed, or was asked for again
 * and is not wanted any more — the renderer's next update after a heal
 * asks for those in view, and one it left UNLOADED (out of view) or that
 * failed for another reason is no longer the network's to answer for.
 */

/** What the healer reads of the renderer. */
export interface HealableTiles {
  lruCache: { remove: (item: object) => boolean };
  resetFailedTiles: () => void;
  /** "update-after": the renderer has asked for what it wants now */
  addEventListener: (type: "update-after", listener: () => void) => void;
  removeEventListener: (type: "update-after", listener: () => void) => void;
}

/** 3d-tiles-renderer's FAILED and UNLOADED loading states
 *  (core/renderer/constants.js: exported at runtime, missing from its
 *  types); a tile in flight or loaded is above them. */
const TILE_FAILED = -1;
const TILE_UNLOADED = 0;

function loadingState(tile: object): number | undefined {
  return (tile as { internal?: { loadingState?: number } }).internal
    ?.loadingState;
}

/** Whether `tile` is still the FAILED tile it was: one the cache let go of
 *  since (UNLOADED), or that is loading or loaded again, is not. */
function stillFailed(tile: object): boolean {
  return loadingState(tile) === TILE_FAILED;
}

/** Whether the renderer left a tile it was asked for again: not wanted
 *  (UNLOADED), or FAILED for a reason not the network's. */
function leftAlone(tile: object): boolean {
  const state = loadingState(tile);
  return state === TILE_UNLOADED || state === TILE_FAILED;
}

/** One "net-retry" note at most this often (with the count since). */
const RETRY_NOTE_MS = 10_000;
/** How often the boot's wait for the network is checked. */
const BOOT_WAIT_TICK_MS = 1000;

export interface NetworkWatch {
  /**
   * A load-error: true when it was the network's (the tile — null for the
   * tileset — is asked for again later, and a load at the boot waits for
   * that), false when it is not (the caller decides as before). Notes
   * "load-error" with the page's state for a network give-up.
   */
  failed: (
    tile: object | null,
    error: unknown,
    url: string,
    atBoot: boolean
  ) => boolean;
  /**
   * A tile landed (the renderer's load-model): true when nothing the
   * network failed is outstanding any more, the first time since the last
   * failure — the HUD's word about it can go. (An all-clear found after a
   * heal's update, `onClear`, is told there instead where it is given,
   * and here at the next landing where it is not.)
   */
  landed: (tile: object) => boolean;
  dispose: () => void;
}

export interface NetworkWatchOptions {
  tiles: HealableTiles;
  trail?: CrashTrail;
  /** the first frame is up, or the app is gone: the boot waits no more */
  bootOver: () => boolean;
  /** the boot gives up on the network (its error's message starts
   *  "network: ") */
  onBootGiveUp: (error: Error) => void;
  /** nothing the network failed is outstanding any more, found by the
   *  renderer's update after a heal (every tile it asked for again is out
   *  of view): what `landed` would say at the next landing, at once */
  onClear?: () => void;
}

export function createNetworkWatch(opts: NetworkWatchOptions): NetworkWatch {
  const healer = createHealer(opts.tiles, opts.onClear);
  const bootWait = createBootWait(opts);
  const tally = createRetryTally(RETRY_NOTE_MS);
  const unwatch = watchRetries((note) => {
    if (pageLeaving()) {
      return;
    }
    const detail = tally.add(note, performance.now());
    if (detail) {
      opts.trail?.note("net-retry", `${detail} ${describeNet()}`);
    }
  });
  return {
    failed: (tile, error, url, atBoot) => {
      if (!isNetworkFailure(error)) {
        return false;
      }
      healer.failed(tile);
      // A page on its way out notes and decides nothing (one back from the
      // bfcache still gets the tile again).
      if (pageLeaving()) {
        return true;
      }
      const message = error instanceof Error ? error.message : String(error);
      // a give-up's message says how often and in what state already
      // (lib/city/fetch-retry.ts withRetry)
      const state = error instanceof NetworkError ? "" : ` ${describeNet()}`;
      opts.trail?.note("load-error", `${url} ${message}${state}`);
      if (atBoot) {
        opts.trail?.note("net-wait", url);
        bootWait.start(tile, message);
      }
      return true;
    },
    landed: (tile) => {
      bootWait.landed(tile);
      return healer.landed(tile);
    },
    dispose: () => {
      unwatch();
      healer.dispose();
      bootWait.dispose();
    },
  };
}

/** The tiles that gave up on the network, asked for again when it may be
 *  back. */
function createHealer(tiles: HealableTiles, onClear?: () => void) {
  const failed = new Set<object>();
  let rootFailed = false;
  /** asked for again, not landed yet */
  const retried = new Set<object>();
  /** a failure since the last all-clear was told */
  let owed = false;
  let step = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** true once, when nothing the network failed is outstanding any more */
  const allClear = (): boolean => {
    if (!owed || failed.size > 0 || rootFailed || retried.size > 0) {
      return false;
    }
    owed = false;
    return true;
  };
  // After a heal the renderer's next update asks for the tiles it wants;
  // the others are not waited for.
  const afterUpdate = () => {
    if (!owed) {
      return;
    }
    for (const tile of retried) {
      if (leftAlone(tile)) {
        retried.delete(tile);
      }
    }
    if (onClear && allClear()) {
      onClear();
    }
  };
  tiles.addEventListener("update-after", afterUpdate);
  const heal = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || (failed.size === 0 && !rootFailed)) {
      return;
    }
    // A hidden page streams nothing (its frames stop): it heals once it is
    // visible again (onUsableAgain).
    if (!pageVisible()) {
      return;
    }
    for (const tile of failed) {
      // One the cache evicted meanwhile (a FAILED tile out of view goes
      // first) is no longer the healer's: in view again, the renderer asks
      // for it itself — removing it now would unload what came back, or
      // abort its load.
      if (stillFailed(tile)) {
        tiles.lruCache.remove(tile);
        retried.add(tile);
      }
    }
    failed.clear();
    rootFailed = false;
    tiles.resetFailedTiles();
  };
  const stopListening = onUsableAgain(heal);
  return {
    failed: (tile: object | null) => {
      owed = true;
      if (tile) {
        retried.delete(tile);
        failed.add(tile);
      } else {
        rootFailed = true;
      }
      timer ??= setTimeout(heal, healDelayMs(step++));
    },
    landed: (tile: object): boolean => {
      const healed = retried.delete(tile);
      // evicted and asked for again before the heal: it came back by itself
      const cameBack = failed.delete(tile);
      // the network is back: the next failure starts the waits afresh
      if ((healed || cameBack) && failed.size === 0) {
        step = 0;
      }
      return allClear();
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      stopListening();
      tiles.removeEventListener("update-after", afterUpdate);
    },
  };
}

/**
 * The boot's wait for the spawn tiles (or the tileset) that gave up on the
 * network: the healer asks for them again, and the boot fails only once
 * the page has been visible for BOOT_NET_WAIT_MS since the stream started
 * without them — a dead server, or no network at all, is said so within a
 * minute or so; a phone in a pocket waits until it is looked at. The wait
 * ends when the last of them lands (a boot that got its tiles back and is
 * only slow is not failed for the blip); a give-up after that waits
 * afresh, from its own moment. A page on its way out decides nothing.
 */
function createBootWait(opts: NetworkWatchOptions) {
  /** when the wait started counting (null: between rounds) */
  let since: number | null = visibleMs();
  let last = "";
  /** the boot's give-ups not landed yet (null: the tileset) */
  const waiting = new Set<object | null>();
  let tick: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(tick);
    tick = undefined;
  };
  const check = () => {
    if (opts.bootOver()) {
      stop();
      return;
    }
    if (pageLeaving()) {
      return;
    }
    const waited = visibleMs() - (since ?? visibleMs());
    if (waited >= BOOT_NET_WAIT_MS) {
      stop();
      opts.onBootGiveUp(
        new NetworkError(
          `${NETWORK_PREFIX}the first tiles did not arrive in ${Math.round(waited / 1000)} s (${last.replace(NETWORK_PREFIX, "")})`,
          0
        )
      );
    }
  };
  return {
    start: (tile: object | null, message: string) => {
      last = message;
      since ??= visibleMs();
      waiting.add(tile);
      tick ??= setInterval(check, BOOT_WAIT_TICK_MS);
    },
    landed: (tile: object) => {
      // (any tile's content means the tileset is there)
      const settled = [waiting.delete(tile), waiting.delete(null)];
      if (settled.some(Boolean) && waiting.size === 0) {
        stop();
        since = null;
      }
    },
    dispose: stop,
  };
}
