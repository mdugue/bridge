/**
 * The ledger's browser read (plan 087) — NOT a smoke test, and ignored
 * unless `LEDGER_OUT` names a folder (playwright.config.ts): `bun run
 * ledger -- --browser` runs it against the NEXT_PUBLIC_POC_DEBUG=1
 * production build, and the spec leaves what it read there
 * (`reading.json`, lib/city/ledger.ts `BrowserReading`). Both pages run
 * `/dresden?scene=lite` on SwiftShader, as the specs do.
 *
 * - The first load's JavaScript: every `/_next/static/*.js` the page or
 *   one of `FIRST_LOAD_WORKERS` fetched itself (each one's resource
 *   timing), cut at: ready, those workers running, then 5 s without a new
 *   script; a second read 5 s later must name the same files.
 * - A phone's tile cache: `getGpuDebug().tileCache.tiles` in a context
 *   with `isMobile` and `hasTouch`, the scene's own tier asserted mobile,
 *   read until two reads 4 s apart (more than a late part's 3 s compile
 *   wait) agree with no compile queued.
 *
 * Never retried: a first read that differs is the finding.
 */
import { writeFileSync } from "node:fs";
import nodePath from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, Worker } from "@playwright/test";
import { FIRST_LOAD_WORKERS } from "../lib/city/ledger";
import type { BrowserReading } from "../lib/city/ledger";
import { SWIFTSHADER_WEBGPU } from "./swiftshader-webgpu";

const LITE = "/dresden?scene=lite";
const READY_MS = 600_000;
const QUIET_MS = 5000;
const CACHE_GAP_MS = 4000;
const CACHE_SETTLE_MS = 120_000;

test.use({ launchOptions: SWIFTSHADER_WEBGPU });
test.describe.configure({ mode: "serial", retries: 0, timeout: 2 * READY_MS });

const reading: Partial<BrowserReading> = {};

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
    timeout: READY_MS,
  });
}

/** In the page or a worker: the paths its resource timing names. */
const resourcePaths = () =>
  performance
    .getEntriesByType("resource")
    .map((entry) => new URL(entry.name).pathname);
/** Its resource timing kept past the first 250 entries. */
const widenBuffer = () => performance.setResourceTimingBufferSize(10_000);

test("the first load's JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  });
  const page = await context.newPage();
  await page.addInitScript(widenBuffer);
  // the named workers, reached as early as a worker can be
  const workers = new Map<string, Worker>();
  page.on("worker", async (worker) => {
    try {
      await worker.evaluate(widenBuffer);
      workers.set(await worker.evaluate(() => self.name), worker);
    } catch {
      // a worker that ended before it answered has no name to give
    }
  });
  // every script fetched, its body kept
  const bodies = new Map<string, Promise<Buffer>>();
  let last = Date.now();
  context.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/_next/static/") && pathname.endsWith(".js")) {
      last = Date.now();
      bodies.set(pathname, response.body());
    }
  });
  /** the fetched scripts the page or a counted worker fetched itself:
   *  path → whether only a worker did */
  const firstLoad = async () => {
    const own = new Set(await page.evaluate(resourcePaths));
    const theirs = new Set<string>();
    for (const name of FIRST_LOAD_WORKERS) {
      const paths = (await workers.get(name)?.evaluate(resourcePaths)) ?? [];
      for (const path of paths) {
        theirs.add(path);
      }
    }
    return new Map(
      [...bodies.keys()]
        .filter((url) => own.has(url) || theirs.has(url))
        .toSorted()
        .map((url) => [url, !own.has(url)])
    );
  };
  await page.goto(LITE);
  await ready(page);
  await expect
    .poll(() => [...workers.keys()], { timeout: READY_MS })
    .toEqual(expect.arrayContaining([...FIRST_LOAD_WORKERS]));
  await expect
    .poll(() => Date.now() - last >= QUIET_MS, { timeout: READY_MS })
    .toBe(true);
  const first = await firstLoad();
  await page.waitForTimeout(QUIET_MS);
  const second = await firstLoad();
  expect([...second.keys()]).toEqual([...first.keys()]);
  expect([...first.values()]).toContain(true);
  reading.firstLoad = await Promise.all(
    [...first].map(async ([url, worker]) => ({
      url,
      worker,
      body: ((await bodies.get(url)) ?? Buffer.alloc(0)).toString("base64"),
    }))
  );
  reading.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter
      ? `${adapter.info.vendor} / ${adapter.info.architecture}`
      : "none";
  });
  reading.browser = `${browser.browserType().name()} ${browser.version()}`;
  await context.close();
});

test("a phone's tile cache", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(LITE);
  await ready(page);
  const read = async () =>
    await page.evaluate(async () => {
      const handle = window.__poc?.handle;
      const gpu = await handle?.getGpuDebug();
      const info = await handle?.getRenderInfo();
      return {
        tier: gpu?.tier,
        tiles: gpu?.tileCache.tiles ?? [],
        compiling: info?.compilesQueued ?? 0,
      };
    });
  let now = await read();
  // the scene's own tier, not only the media query: a desktop's rasters
  // must not be recorded as a phone's
  expect(now.tier).toBe("mobile");
  const settleBy = Date.now() + CACHE_SETTLE_MS;
  for (let was = ""; ;) {
    const loaded = JSON.stringify(now.tiles.filter((t) => t.loaded));
    if (loaded === was && now.compiling === 0) {
      break;
    }
    expect(
      Date.now(),
      "the phone's tile cache never read the same twice"
    ).toBeLessThan(settleBy);
    was = loaded;
    await page.waitForTimeout(CACHE_GAP_MS);
    now = await read();
  }
  expect(now.tiles.some((t) => t.loaded)).toBe(true);
  reading.phone = now.tiles;
  await context.close();
});

test.afterAll(() => {
  if (process.env.LEDGER_OUT && reading.firstLoad && reading.phone) {
    writeFileSync(
      nodePath.join(process.env.LEDGER_OUT, "reading.json"),
      JSON.stringify(reading)
    );
  }
});
