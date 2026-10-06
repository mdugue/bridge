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
  usableMs,
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
 * `resetFailedTiles()`.
 *
 * When: as soon as the page may have its network back ("online", visible
 * again, back from the bfcache), and otherwise after 5, 15, 45, then every
 * 120 s while any are waiting (lib/city/fetch-retry.ts HEAL_DELAYS_MS).
 */

/** What the healer reads of the renderer. */
export interface HealableTiles {
  lruCache: { remove: (item: object) => boolean };
  resetFailedTiles: () => void;
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
  /** A tile landed: true when it is one that had failed on the network. */
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
}

export function createNetworkWatch(opts: NetworkWatchOptions): NetworkWatch {
  const healer = createHealer(opts.tiles);
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
        bootWait.start(message);
      }
      return true;
    },
    landed: (tile) => healer.landed(tile),
    dispose: () => {
      unwatch();
      healer.dispose();
      bootWait.dispose();
    },
  };
}

/** The tiles that gave up on the network, asked for again when it may be
 *  back. */
function createHealer(tiles: HealableTiles) {
  const failed = new Set<object>();
  let rootFailed = false;
  /** asked for again, not landed yet */
  const retried = new Set<object>();
  let step = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
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
      tiles.lruCache.remove(tile);
      retried.add(tile);
    }
    failed.clear();
    rootFailed = false;
    tiles.resetFailedTiles();
  };
  const stopListening = onUsableAgain(heal);
  return {
    failed: (tile: object | null) => {
      if (tile) {
        failed.add(tile);
      } else {
        rootFailed = true;
      }
      timer ??= setTimeout(heal, healDelayMs(step++));
    },
    landed: (tile: object): boolean => {
      if (!retried.delete(tile)) {
        return false;
      }
      // the network is back: the next failure starts the waits afresh
      if (failed.size === 0) {
        step = 0;
      }
      return true;
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      stopListening();
    },
  };
}

/**
 * The boot's wait for a spawn tile (or the tileset) that gave up on the
 * network: the healer asks for it again, and the boot fails only once the
 * page has been usable for BOOT_NET_WAIT_MS since the stream started
 * without it — a phone in a tunnel waits for daylight, a dead server is
 * said so within a minute or so. A page on its way out decides nothing.
 */
function createBootWait(opts: NetworkWatchOptions) {
  const since = usableMs();
  let last = "";
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
    const waited = usableMs() - since;
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
    start: (message: string) => {
      last = message;
      tick ??= setInterval(check, BOOT_WAIT_TICK_MS);
    },
    dispose: stop,
  };
}
