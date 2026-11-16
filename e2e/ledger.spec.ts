/**
 * The ledger's browser figures (plan 087, phase 2) — NOT a smoke test, and
 * ignored unless `LEDGER=1` (playwright.config.ts). `bun run ledger --
 * --browser` runs it against the NEXT_PUBLIC_POC_DEBUG=1 production build
 * and hands it a folder (`LEDGER_OUT`): the spec writes what it read there
 * (`reading.json`) with each script's raw body beside it, and
 * scripts/ledger-browser.ts weighs the bodies with the pinned Bun and turns
 * the rest into the ledger's figures (lib/city/ledger-browser.ts).
 *
 * - the first load's JavaScript: every `/_next/static/*.js` the page and
 *   its workers fetch until `ready`, the named workers running and the
 *   network quiet (`FIRST_LOAD_NOTE`), and which only a worker fetched;
 * - a phone's tile cache: `getGpuDebug().tileCache.tiles` in a context
 *   with `isMobile` and `hasTouch`, the scene's own tier asserted mobile,
 *   read until two reads further apart than a late part's compile wait
 *   agree, no compile queued;
 * - the timings: `getTimings()` at `ready`, on both.
 *
 * Never retried: a first read that differs is the finding. Both pages run
 * `/dresden?scene=lite` on SwiftShader, as the specs do.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page, Response, Worker } from "@playwright/test";
import {
  CACHE_SETTLE_GAP_MS,
  FIRST_LOAD_QUIET_MS,
  FIRST_LOAD_WORKERS,
  RESOURCE_BUFFER_DEFAULT,
} from "../lib/city/ledger-browser";
import type {
  BrowserReading,
  CacheEntry,
  TimingFigure,
} from "../lib/city/ledger-browser";
import { SWIFTSHADER_WEBGPU } from "./swiftshader-webgpu";

const LITE = "/dresden?scene=lite";
const READY_MS = 600_000;
/** How long the phone's cache may take to read the same twice (ms). */
const CACHE_SETTLE_MS = 120_000;
const OUT = process.env.LEDGER_OUT;

test.use({ launchOptions: SWIFTSHADER_WEBGPU });
test.describe.configure({ mode: "serial", retries: 0, timeout: 2 * READY_MS });

const reading: Partial<BrowserReading> = {};
const timings: Partial<BrowserReading["timings"]> = {};

/** Waits for the scene's `ready`. */
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
    timeout: READY_MS,
  });
}

/** The scene's timings so far. */
async function timingsOf(page: Page): Promise<Record<string, TimingFigure>> {
  return await page.evaluate(
    async () => (await window.__poc?.handle?.getTimings()) ?? {}
  );
}

/** The adapter the page draws with, by its vendor and architecture. */
async function adapterOf(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) {
      return "none";
    }
    const { vendor, architecture, description } = adapter.info;
    return [vendor, architecture, description].filter(Boolean).join(" / ");
  });
}

/** In the page or a worker: the paths its resource timing names. */
const resourcePaths = () =>
  performance
    .getEntriesByType("resource")
    .map((entry) => new URL(entry.name).pathname);

/** In a worker: its resource timing kept past the first 250 entries. */
const widenBuffer = () => {
  performance.setResourceTimingBufferSize(10_000);
};

/** The scripts a page or worker fetched itself, by path: its own
 *  resource timing (a worker's `importScripts` are in the worker's). A
 *  worker whose buffer is full has dropped entries: that fails the read,
 *  not the count. */
async function ownScripts(
  at: Page | Worker,
  name = "the page"
): Promise<Set<string>> {
  const paths =
    "mainFrame" in at
      ? await at.evaluate(resourcePaths)
      : await at.evaluate(resourcePaths);
  if (!("mainFrame" in at)) {
    expect(
      paths.length,
      `${name}'s resource timing is full: entries were dropped`
    ).toBeLessThan(RESOURCE_BUFFER_DEFAULT);
  }
  return new Set(paths);
}

/** The named workers the page runs, by their `name` (ADR 0061's scene
 *  among them); an unnamed one (a decoder's blob) is left out. */
function watchWorkers(page: Page): () => Map<string, Worker> {
  const named = new Map<string, Worker>();
  const see = async (worker: Worker) => {
    try {
      // as early as a worker can be reached: no entry dropped at 250
      await worker.evaluate(widenBuffer);
      const name = await worker.evaluate(
        () => (self as { name?: string }).name ?? ""
      );
      if (name) {
        named.set(name, worker);
      }
    } catch {
      // a worker that ended before it answered has no name to give
    }
  };
  page.on("worker", see);
  return () => new Map(named);
}

/** A script fetched, its body kept. */
interface Fetched {
  body: Buffer;
  url: string;
}

/** A script's body; one that cannot be read fails the read. */
async function weigh(response: Response, url: string): Promise<Fetched> {
  try {
    return { url, body: await response.body() };
  } catch (error) {
    throw new Error(`ledger: no body for ${url}`, { cause: error });
  }
}

/** Every script fetched in `context`, its body read (a body that cannot be
 *  read fails the read); `last` is when the latest arrived. */
function watchScripts(context: BrowserContext): {
  settled: () => Promise<Fetched[]>;
  last: () => number;
} {
  const pending: Promise<Fetched>[] = [];
  let last = Date.now();
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (
      !url.pathname.startsWith("/_next/static/") ||
      !url.pathname.endsWith(".js")
    ) {
      return;
    }
    last = Date.now();
    pending.push(weigh(response, url.pathname));
  });
  return { settled: async () => await Promise.all(pending), last: () => last };
}

/** Waits until no script arrived for `FIRST_LOAD_QUIET_MS`. */
async function quiet(page: Page, last: () => number): Promise<void> {
  await expect
    .poll(() => Date.now() - last() >= FIRST_LOAD_QUIET_MS, {
      timeout: READY_MS,
      intervals: [500],
    })
    .toBe(true);
  // the page's own tasks drain too
  await page.waitForTimeout(0);
}

/** The first load's files, one per path: those the page or one of
 *  `FIRST_LOAD_WORKERS` fetched itself, `worker` where the page did not;
 *  and the paths another worker alone fetched (the BVH worker's, which
 *  starts on a pose tick only if the spawn's buildings have no BVH yet). */
async function firstLoadSet(
  page: Page,
  workers: ReadonlyMap<string, Worker>,
  fetched: readonly Fetched[]
): Promise<{
  files: Map<string, Fetched & { worker: boolean }>;
  elsewhere: string[];
}> {
  const own = await ownScripts(page);
  const theirs = new Set<string>();
  for (const name of FIRST_LOAD_WORKERS) {
    const worker = workers.get(name);
    expect(worker, `the ${name} worker`).toBeDefined();
    for (const path of worker ? await ownScripts(worker, name) : []) {
      theirs.add(path);
    }
  }
  const files = new Map<string, Fetched & { worker: boolean }>();
  const elsewhere = new Set<string>();
  for (const f of fetched) {
    if (own.has(f.url) || theirs.has(f.url)) {
      files.set(f.url, { ...f, worker: !own.has(f.url) });
    } else {
      elsewhere.add(f.url);
    }
  }
  return { files, elsewhere: [...elsewhere].toSorted() };
}

test("the first load's JavaScript, and the desktop's timings", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  });
  const page = await context.newPage();
  // every fetch kept in the page's resource timing, not its first 250
  await page.addInitScript(() =>
    performance.setResourceTimingBufferSize(10_000)
  );
  const workers = watchWorkers(page);
  const scripts = watchScripts(context);
  await page.goto(LITE);
  await ready(page);
  timings.desktop = await timingsOf(page);
  // the set: ready, the named workers running, then the network quiet
  await expect
    .poll(() => [...workers().keys()], { timeout: READY_MS })
    .toEqual(expect.arrayContaining([...FIRST_LOAD_WORKERS]));
  await quiet(page, scripts.last);
  const first = await firstLoadSet(page, workers(), await scripts.settled());
  // ... and a second read, a quiet span later, that equals it
  await page.waitForTimeout(FIRST_LOAD_QUIET_MS);
  const second = await firstLoadSet(page, workers(), await scripts.settled());
  expect([...second.files.keys()].toSorted()).toEqual(
    [...first.files.keys()].toSorted()
  );
  expect([...first.files.values()].some((f) => f.worker)).toBe(true);
  // a script outside the set is the BVH worker's, or the read is wrong
  if (second.elsewhere.length > 0) {
    expect(
      workers().has("bvh"),
      `scripts no counted worker fetched, and no BVH worker: ${second.elsewhere.join(", ")}`
    ).toBe(true);
  }
  reading.workers = [...FIRST_LOAD_WORKERS];
  reading.elsewhere = second.elsewhere;
  reading.firstLoad = [...first.files.values()]
    .toSorted((a, b) => a.url.localeCompare(b.url))
    .map((f, i) => {
      const body = `js-${i}.js`;
      if (OUT) {
        writeFileSync(nodePath.join(OUT, body), f.body);
      }
      return { url: f.url, body, worker: f.worker };
    });
  reading.adapter = await adapterOf(page);
  reading.browser = `${browser.browserType().name()} ${browser.version()}`;
  await context.close();
});

/** The phone's loaded cache entries, by URI. */
const loadedEntries = (tiles: readonly CacheEntry[]) =>
  tiles
    .filter((t) => t.loaded)
    .map((t) => `${t.uri} ${t.bytes}`)
    .toSorted();

test("a phone's tile cache, and its timings", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(LITE);
  await ready(page);
  timings.phone = await timingsOf(page);
  const debug = async () =>
    await page.evaluate(async () => await window.__poc?.handle?.getGpuDebug());
  // the scene's own tier, not only the media query: a desktop's rasters
  // must not be recorded as a phone's
  let gpu = await debug();
  expect(gpu?.tier).toBe("mobile");
  // read until two reads agree, further apart than a late part may wait
  // for its compile, with no compile queued
  const compiling = async () =>
    await page.evaluate(async () => {
      const info = await window.__poc?.handle?.getRenderInfo();
      return info?.compilesQueued ?? 0;
    });
  let was = "";
  const settleBy = Date.now() + CACHE_SETTLE_MS;
  for (;;) {
    const now = JSON.stringify(loadedEntries(gpu?.tileCache.tiles ?? []));
    if (now === was && (await compiling()) === 0) {
      break;
    }
    expect(
      Date.now(),
      "the phone's tile cache never read the same twice"
    ).toBeLessThan(settleBy);
    was = now;
    await page.waitForTimeout(CACHE_SETTLE_GAP_MS);
    gpu = await debug();
  }
  expect(loadedEntries(gpu?.tileCache.tiles ?? []).length).toBeGreaterThan(0);
  reading.phone = {
    tier: gpu?.tier ?? "",
    held: { ...gpu?.held },
    tiles: gpu?.tileCache.tiles ?? [],
  };
  await context.close();
});

test.afterAll(() => {
  if (!OUT) {
    return;
  }
  const { desktop, phone } = timings;
  if (desktop && phone) {
    reading.timings = { desktop, phone };
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    nodePath.join(OUT, "reading.json"),
    `${JSON.stringify(reading, null, 2)}\n`
  );
});
