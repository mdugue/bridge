/**
 * SPIKE (plan 020): boots the viewer in each renderer mode on a real GPU,
 * collects console errors, measures frame rate at fixed views and writes a
 * plate per view and mode. Not a test; run with
 *   bun e2e/spike-probe.ts [baseUrl] [outDir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { DRESDEN } from "../sites/dresden";

const BASE = process.argv[2] ?? "http://localhost:3002";
const OUT = process.argv[3] ?? "shots/spike";
const MODES = ["webgl", "webgpu", "webgl2"] as const;
const VIEWS = ["canaletto", "rooftops", "elbe-aerial", "carolabruecke"];
const MEASURE_MS = 8000;

type Poc = {
  frames: number;
  ready: boolean;
  firstFrame: boolean;
  handle: {
    applyCameraState: (s: unknown) => void;
    flyToViewpoint: (v: unknown) => void;
    getCameraState: () => unknown;
    setSun: (d: Date) => unknown;
  };
  stats?: Record<string, unknown>;
};
declare const window: Window & { __poc?: Poc };

async function boot(page: Page, mode: string): Promise<number> {
  const t0 = Date.now();
  const q = mode === "webgl" ? "" : `?gpu=${mode}`;
  await page.goto(`${BASE}/${q}`);
  await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
    timeout: 240_000,
  });
  return Date.now() - t0;
}

async function captureStates(page: Page): Promise<Record<string, unknown>> {
  const states: Record<string, unknown> = {};
  for (const id of VIEWS) {
    const vp = DRESDEN.viewpoints.find((v) => v.id === id);
    await page.evaluate((v) => window.__poc?.handle.flyToViewpoint(v), vp);
    await page.waitForTimeout(7000);
    states[id] = await page.evaluate(() =>
      window.__poc?.handle.getCameraState()
    );
  }
  return states;
}

async function measure(page: Page): Promise<number> {
  const f0 = await page.evaluate(() => window.__poc?.frames ?? 0);
  await page.waitForTimeout(MEASURE_MS);
  const f1 = await page.evaluate(() => window.__poc?.frames ?? 0);
  return ((f1 - f0) * 1000) / MEASURE_MS;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: [
      "--enable-unsafe-webgpu",
      "--disable-gpu-vsync",
      "--disable-frame-rate-limit",
    ],
  });
  const report: Record<string, unknown> = {};
  let states: Record<string, unknown> | null = null;
  for (const mode of MODES) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") {
        errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
      }
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    const entry: Record<string, unknown> = { errors };
    report[mode] = entry;
    try {
      entry.readyMs = await boot(page, mode);
      entry.backend = await page.evaluate(() =>
        document
          .querySelector("canvas[data-engine]")
          ?.getAttribute("data-engine")
      );
      if (!states) {
        states = await captureStates(page);
        writeFileSync(
          join(OUT, "states.json"),
          JSON.stringify(states, null, 2)
        );
      }
      await page.evaluate(() =>
        window.__poc?.handle.setSun(new Date("2026-06-21T15:00:00Z"))
      );
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas[data-engine]");
        const keep = new Set<Element>();
        for (let el: Element | null = canvas; el; el = el.parentElement) {
          keep.add(el);
        }
        for (const node of keep) {
          for (const child of Array.from(node.parentElement?.children ?? [])) {
            if (!keep.has(child)) {
              (child as HTMLElement).style.visibility = "hidden";
            }
          }
        }
      });
      const fps: Record<string, number> = {};
      for (const id of VIEWS) {
        await page.evaluate(
          (s) => window.__poc?.handle.applyCameraState(s),
          states[id]
        );
        await page.waitForTimeout(2500);
        fps[id] = Math.round((await measure(page)) * 10) / 10;
        await page
          .locator("canvas[data-engine]")
          .screenshot({ path: join(OUT, `${id}-${mode}.png`) });
      }
      entry.fps = fps;
      entry.stats = await page.evaluate(() => {
        const s = (window.__poc?.stats ?? {}) as Record<string, unknown>;
        return { calls: s.calls, triangles: s.triangles, gpuBytes: s.gpuBytes };
      });
    } catch (err) {
      entry.failure = String(err);
      await page.screenshot({ path: join(OUT, `failure-${mode}.png`) });
    }
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    await context.close();
  }
  await browser.close();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
