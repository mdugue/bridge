/**
 * The ledger's browser figures (plan 087, phase 2): what `e2e/ledger.spec.ts`
 * read in a browser, turned into `qa/ledger.json`'s `browser` section (gated,
 * exactly) and its `timings` section (recorded, never compared). Pure: the
 * spec hands over what it read — each script's raw body, the phone's tile
 * cache, the timings — and scripts/ledger-browser.ts gzips the bodies with
 * the pinned Bun and calls `browserLedger`.
 */
import { gzipSync } from "node:zlib";

/** One timing category as the scene's `getTimings` counts it
 *  (app/_components/stream-timing.ts `TimingStat`). */
export interface TimingFigure {
  count: number;
  maxMs: number;
  totalMs: number;
}

/** A tile cache entry as `getGpuDebug().tileCache.tiles` lists it. */
export interface CacheEntry {
  bytes: number;
  loaded: boolean;
  uri: string;
}

/** What `e2e/ledger.spec.ts` read, as it read it. */
export interface BrowserReading {
  /** the adapter the scene drew with (`adapter.info`) */
  adapter: string;
  /** the browser's name and version */
  browser: string;
  /** every `/_next/static/*.js` of the first load (`FIRST_LOAD_NOTE`):
   *  its path, its body's file in the reading's folder, and `worker` when
   *  only a worker fetched it */
  firstLoad: { url: string; body: string; worker: boolean }[];
  /** the named workers whose own fetches the first load counts */
  workers: string[];
  /** the scripts another worker alone fetched (the BVH worker's, when it
   *  started), left out of the first load */
  elsewhere: string[];
  /** the phone: the scene's tier, its settled tile cache, three's
   *  `info.memory` */
  phone: {
    held: Record<string, number>;
    tier: string;
    tiles: CacheEntry[];
  };
  /** `getTimings()` at `ready`, on the desktop and on the phone */
  timings: {
    desktop: Record<string, TimingFigure>;
    phone: Record<string, TimingFigure>;
  };
}

/** The named workers the first load waits for and counts: the scene's
 *  (ADR 0061) and the two its boot starts. The BVH worker is not among
 *  them: it starts on a pose tick only when a building tile near the
 *  camera has no BVH yet, which at the spawn depends on whether the placing
 *  built it (one read in four, 2026-11-16) — its own scripts are recorded
 *  (`timings.elsewhere`), not counted. */
export const FIRST_LOAD_WORKERS = ["ground", "niches", "scene"] as const;

/** How long no new script may arrive before the first load's set is cut,
 *  and again after it before the second read that must equal it (ms). */
export const FIRST_LOAD_QUIET_MS = 5000;

export const FIRST_LOAD_NOTE = `Every /_next/static/*.js the page or the workers ${FIRST_LOAD_WORKERS.join(", ")} fetched themselves (each one's resource timing) at /dresden?scene=lite (a NEXT_PUBLIC_POC_DEBUG=1 production build), cut at: ready, those workers running, then ${FIRST_LOAD_QUIET_MS / 1000} s without a new script; a second read ${FIRST_LOAD_QUIET_MS / 1000} s later must equal it. The BVH worker's own scripts are left out: it starts only if the spawn's buildings have no BVH yet. Each raw body gzipped at level 9 by the pinned Bun, exact. workerOnly: the files those workers fetched and the page did not — not the scene's JavaScript, which the page shares.`;

export const PHONE_NOTE =
  "The tile cache's own accounting (calculateBytesUsed, as its budget counts it) on an emulated phone (isMobile, hasTouch; the scene's tier asserted mobile) at /dresden?scene=lite once ready and two reads 2 s apart agree, loaded contents only: the spawn tile alone, one of fifteen, under the lite profile. It is not the phone's memory: what a tile holds on the GPU that never reaches calculateBytesUsed moves nothing here, and three's info.memory is recorded only (timings.phoneHeld), since two reads of one build differ.";

/** The first load's JavaScript: files and their gzip -9 bytes. */
export interface JsWeight {
  files: number;
  gzip: number;
}

/** The ledger's gated browser figures. */
export interface BrowserFigures {
  firstLoad: JsWeight & {
    note: string;
    /** the files only a worker fetched */
    workerOnly: JsWeight;
  };
  /** the phone's tile cache at the spawn, lite profile */
  phoneLiteSpawnCache: {
    /** the loaded contents' bytes, summed */
    bytes: number;
    /** each loaded content by its logical name, its bytes */
    contents: Record<string, number>;
    note: string;
  };
  /** the browser and adapter they were read with: beside the figures,
   *  never compared (`readWith` is in the ledger's UNCOMPARED) */
  readWith: string;
}

/** The browser's figures recorded, never compared. */
export interface Timings {
  /** each first-load file and its gzip -9 bytes (a name is its content
   *  hash: it moves with any change) */
  firstLoad: { url: string; gzip: number; worker: boolean }[];
  desktop: Record<string, TimingFigure>;
  machine: string;
  note: string;
  phone: Record<string, TimingFigure>;
  /** the scripts another worker alone fetched, left out of the first load */
  elsewhere: string[];
  /** three's `info.memory` on the phone at `ready` */
  phoneHeld: Record<string, number>;
  read: string;
}

export const TIMINGS_NOTE =
  "Recorded, never compared: the timings depend on the machine drawn (SwiftShader on a CI runner varies by a factor of two), the chunks' names on every change, three's info.memory on the moment it is read. getTimings() at ready, on the desktop and the phone page of the browser figures.";

/** A script's bytes on the wire, as the ledger counts them: gzip -9. */
export const jsGzip = (body: Uint8Array): number =>
  gzipSync(body, { level: 9 }).length;

/** Files and their gzip bytes, summed. */
const jsWeight = (of: readonly { gzip: number }[]): JsWeight => ({
  files: of.length,
  gzip: of.reduce((sum, f) => sum + f.gzip, 0),
});

/** The first load's figures: every file, and those only a worker fetched. */
export function firstLoadFigures(
  files: readonly { gzip: number; worker: boolean }[]
): BrowserFigures["firstLoad"] {
  return {
    note: FIRST_LOAD_NOTE,
    ...jsWeight(files),
    workerOnly: jsWeight(files.filter((f) => f.worker)),
  };
}

/** A content's served name: its URI's last segment, the query left off. */
export const servedName = (uri: string): string =>
  uri.slice(uri.lastIndexOf("/") + 1).split("?")[0] ?? "";

/** The phone's cache figures from its entries, the loaded ones only;
 *  `logical` maps a served name back to the manifest's. A content the
 *  manifest does not name keeps its served name. */
export function phoneCache(
  entries: readonly CacheEntry[],
  logical: (served: string) => string | undefined
): BrowserFigures["phoneLiteSpawnCache"] {
  const contents: Record<string, number> = {};
  for (const e of entries.filter((t) => t.loaded)) {
    const served = servedName(e.uri);
    const name = logical(served) ?? served;
    contents[name] = (contents[name] ?? 0) + e.bytes;
  }
  const sorted = Object.fromEntries(
    Object.entries(contents).toSorted(([a], [b]) => a.localeCompare(b))
  );
  return {
    note: PHONE_NOTE,
    bytes: Object.values(sorted).reduce((sum, b) => sum + b, 0),
    contents: sorted,
  };
}

/** The timing categories the ledger records: the boot's marks, a tile's
 *  dressing and compile, and the long tasks (a row only where the scene
 *  counts them: `?trace=1`). */
export const RECORDED_TIMINGS =
  /^(?:boot:.*|dressing:build|tile:compile|longtask)$/u;

/** A time to 0.1 ms. */
const tenth = (ms: number) => Math.round(ms * 10) / 10;

/** The recorded categories of a `getTimings` summary, to 0.1 ms. */
export function timingRows(
  summary: Readonly<Record<string, TimingFigure>>
): Record<string, TimingFigure> {
  return Object.fromEntries(
    Object.entries(summary)
      .filter(([category]) => RECORDED_TIMINGS.test(category))
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([category, t]) => [
        category,
        { count: t.count, totalMs: tenth(t.totalMs), maxMs: tenth(t.maxMs) },
      ])
  );
}

/** The browser's reading, its scripts weighed (`gzip` by `url`), split
 *  into the gated figures and the record. */
export function browserLedger(
  reading: BrowserReading,
  gzipOf: (url: string) => number,
  logical: (served: string) => string | undefined,
  machine: string,
  today: string
): { browser: BrowserFigures; timings: Timings } {
  const files = reading.firstLoad
    .map((f) => ({ url: f.url, gzip: gzipOf(f.url), worker: f.worker }))
    .toSorted((a, b) => a.url.localeCompare(b.url));
  return {
    browser: {
      readWith: `${reading.browser}, ${reading.adapter}`,
      firstLoad: firstLoadFigures(files),
      phoneLiteSpawnCache: phoneCache(reading.phone.tiles, logical),
    },
    timings: {
      note: TIMINGS_NOTE,
      machine,
      read: today,
      desktop: timingRows(reading.timings.desktop),
      phone: timingRows(reading.timings.phone),
      phoneHeld: reading.phone.held,
      firstLoad: files,
      elsewhere: reading.elsewhere,
    },
  };
}
