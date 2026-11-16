/**
 * The ledger's browser figures (plan 087, phase 2) — NOT a smoke test, and
 * ignored unless `LEDGER=1` (playwright.config.ts). `bun run ledger --
 * --browser` runs it against the NEXT_PUBLIC_POC_DEBUG=1 production build
 * and writes what it read to `LEDGER_OUT`; scripts/ledger.ts turns that
 * into the ledger's figures (lib/city/ledger.ts `browserLedger`).
 *
 * - the first load's JavaScript: every `/_next/static/*.js` the page and
 *   its workers fetch until `ready`, each gzipped at level 9 — plan 074's
 *   method as code — and which only a worker fetched;
 * - a phone's tile bytes: `getGpuDebug()`'s `tileCache` and `held` at
 *   `ready`, in a context with `isMobile` and `hasTouch` (ADR 0047's rule
 *   as a number);
 * - the timings: `getTimings()` at `ready`, on both.
 *
 * Both pages run `/dresden?scene=lite` on SwiftShader, as the specs do.
 */
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import type { BrowserReading, TimingFigure } from "../lib/city/ledger";
import { SWIFTSHADER_WEBGPU } from "./swiftshader-webgpu";

const LITE = "/dresden?scene=lite";
const READY_MS = 600_000;
const OUT = process.env.LEDGER_OUT;

test.use({ launchOptions: SWIFTSHADER_WEBGPU });
test.describe.configure({ mode: "serial", timeout: 2 * READY_MS });

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

/** The scripts the page itself fetched (its resource timing; a worker's
 *  fetches are in the worker's own), by path. */
async function pageScripts(page: Page): Promise<Set<string>> {
  return new Set(
    await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => new URL(entry.name).pathname)
    )
  );
}

/** Every script fetched in `context` until `stop()`, gzipped at level 9;
 *  `worker` when only a worker fetched it (the scene's, ADR 0061, and the
 *  ones it starts). */
function watchScripts(context: BrowserContext): {
  stop: (page: Page) => Promise<BrowserReading["firstLoad"]>;
} {
  const pending: Promise<{ url: string; gzip: number } | null>[] = [];
  let watching = true;
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (
      !watching ||
      !url.pathname.startsWith("/_next/static/") ||
      !url.pathname.endsWith(".js")
    ) {
      return;
    }
    pending.push(
      response
        .body()
        .then((body) => ({
          url: url.pathname,
          gzip: gzipSync(body, { level: 9 }).length,
        }))
        // a redirect or a cached repeat has no body to weigh
        .catch(() => null)
    );
  });
  return {
    stop: async (page) => {
      // set before the first await: nothing after `ready` is counted
      watching = false;
      const own = await pageScripts(page);
      const byUrl = new Map<string, BrowserReading["firstLoad"][number]>();
      for (const f of await Promise.all(pending)) {
        if (f) {
          byUrl.set(f.url, { ...f, worker: !own.has(f.url) });
        }
      }
      return [...byUrl.values()].toSorted((a, b) => a.url.localeCompare(b.url));
    },
  };
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
  const scripts = watchScripts(context);
  await page.goto(LITE);
  await ready(page);
  const files = scripts.stop(page);
  timings.desktop = await timingsOf(page);
  reading.firstLoad = await files;
  reading.adapter = await adapterOf(page);
  reading.browser = `${browser.browserType().name()} ${browser.version()}`;
  expect(reading.firstLoad.length).toBeGreaterThan(0);
  expect(reading.firstLoad.some((f) => f.worker)).toBe(true);
  await context.close();
});

test("a phone's tile bytes, and its timings", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(LITE);
  await ready(page);
  timings.phone = await timingsOf(page);
  const gpu = await page.evaluate(
    async () => await window.__poc?.handle?.getGpuDebug()
  );
  expect(gpu?.tileCache.tiles.length).toBeGreaterThan(0);
  reading.phone = {
    bytes: gpu?.tileCache.bytes ?? 0,
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
  writeFileSync(OUT, `${JSON.stringify(reading, null, 2)}\n`);
});
