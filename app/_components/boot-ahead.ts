/**
 * The boot's head start: the tileset and the first contents of the tile
 * the boot waits for (its far buildings and coarse terrain), asked for as
 * soon as the tileset's name is known — beside the scene's chunk, the
 * renderer's start and the scene's setup, none of which they depend on.
 * The stream then finds them here instead of asking in its first frame
 * (tile-content-fetch.ts takes each once). The same requests the stream
 * would make, through the same fetch; one that fails is the stream's to
 * ask again. No THREE.
 */
import { firstContents, startOf } from "@/lib/city/boot-start";
import type { BootStart } from "@/lib/city/boot-start";
import { BOOT_NET_WAIT_MS, TILE_FETCH_BUDGET_MS } from "@/lib/city/fetch-retry";
import { parseTilesetExtras } from "@/lib/city/tileset";
import type { TilesetExtras } from "@/lib/city/tileset";
import { eitherSignal, fetchBytes } from "./fetch-optional";
import type { FetchedBytes } from "./fetch-optional";

/** A request under way, and what stops it. */
export interface AheadRequest {
  abort: () => void;
  got: Promise<FetchedBytes>;
}

/** The tileset as the boot reads it. */
export interface AheadTileset {
  extras: TilesetExtras;
  json: unknown;
  start: BootStart<TilesetExtras["tiles"][number]>;
}

export interface BootAhead {
  /** stops and forgets what the stream has not taken (the boot is over) */
  release: () => void;
  /** the request for `url` under way, handed over once */
  take: (url: string) => AheadRequest | undefined;
  /** the tileset parsed, or why there is none (a status no retry fixes, a body that is not the tileset; a network
   *  failure once the boot's wait is spent, its message "network: …") */
  tileset: Promise<AheadTileset>;
  /** the tileset this is the head start of (an absolute URL) */
  url: string;
}

const quiet = () => {
  // an unread failure is not an unhandled one: its reader reports it
};

/**
 * Starts the boot's first requests for the tileset at `url` (absolute).
 * `given` is where the boot starts (boot-start.ts `startOf`); `signal`
 * ends everything with the boot.
 */
export function bootAhead(
  url: string,
  given: Parameters<typeof startOf>[0],
  signal?: AbortSignal
): BootAhead {
  const held = new Map<string, AheadRequest>();
  const ask = (href: string, budgetMs: number): AheadRequest => {
    const own = new AbortController();
    const either = eitherSignal(signal, own.signal);
    const got = fetchBytes(href, {
      signal: either.signal,
      budgetMs,
      gunzip: href.endsWith(".gz"),
    }).finally(either.release);
    got.catch(quiet);
    const request = { abort: () => own.abort(), got };
    held.set(href, request);
    return request;
  };
  let released = false;
  const tileset = ask(url, BOOT_NET_WAIT_MS).got.then((got) => {
    if (!got.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${got.status}`);
    }
    const json: unknown = JSON.parse(new TextDecoder().decode(got.bytes));
    const extras = parseTilesetExtras(json);
    const start = startOf(given, extras.tiles);
    if (!released) {
      for (const uri of firstContents(
        json,
        extras.tiles.indexOf(start.spawn)
      )) {
        ask(new URL(uri, url).href, TILE_FETCH_BUDGET_MS);
      }
    }
    return { extras, json, start };
  });
  tileset.catch(quiet);
  return {
    release: () => {
      released = true;
      for (const request of held.values()) {
        request.abort();
      }
      held.clear();
    },
    take: (href) => {
      const request = held.get(href);
      held.delete(href);
      return request;
    },
    tileset,
    url,
  };
}
