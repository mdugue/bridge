/**
 * SPIKE (plan 020): stutter on long flights. Chains the site's viewpoints
 * (so tiles stream in and out), records every frame's duration in the page
 * and reports long frames. `bun e2e/spike-flight.ts <mode> [base]`.
 */
import { chromium } from "@playwright/test";
import { DRESDEN } from "../sites/dresden";

const mode = process.argv[2] ?? "webgpu";
const BASE = process.argv[3] ?? "http://localhost:3002";
const HOPS = ["elbe-aerial", "carolabruecke", "rooftops", "canaletto", "elbe-promenade", "elbe-aerial", "rooftops", "carolabruecke"];

type Poc = { ready: boolean; handle: { flyToViewpoint: (v: unknown) => void } };
declare const window: Window & { __poc?: Poc; __ft?: number[] };

const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/${mode === "webgl" ? "" : `?gpu=${mode}`}`);
await page.waitForFunction(() => window.__poc?.ready === true, undefined, { timeout: 240_000 });
await page.evaluate(() => {
  const w = window as unknown as { __lt: [number, number][] };
  w.__lt = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      w.__lt.push([Math.round(e.startTime), Math.round(e.duration)]);
    }
  }).observe({ type: "longtask" });
  performance.clearMeasures();
  window.__ft = [];
  let last = performance.now();
  const tick = (t: number) => {
    window.__ft?.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
for (const id of HOPS) {
  const vp = DRESDEN.viewpoints.find((v) => v.id === id);
  await page.evaluate((v) => window.__poc?.handle.flyToViewpoint(v), vp);
  await page.waitForTimeout(7000);
}
const ft: number[] = await page.evaluate(() => window.__ft ?? []);
const sorted = [...ft].sort((a, b) => a - b);
const pct = (p: number) => Math.round(sorted[Math.floor(sorted.length * p)] ?? 0);
const report = {
  mode,
  seconds: Math.round((Date.now() - t0) / 1000),
  frames: ft.length,
  median: pct(0.5),
  p99: pct(0.99),
  over100: ft.filter((d) => d > 100).length,
  over500: ft.filter((d) => d > 500).length,
  worst: Math.round(sorted.at(-1) ?? 0),
  stalledMs: Math.round(ft.filter((d) => d > 100).reduce((s, d) => s + d, 0)),
};
const detail = await page.evaluate(() => {
  const measures = performance
    .getEntriesByType("measure")
    .filter((m) => m.duration > 50)
    .map((m) => [m.name, Math.round(m.startTime), Math.round(m.duration)]);
  const tasks = (window as unknown as { __lt: [number, number][] }).__lt.filter(
    ([, d]) => d > 100
  );
  return { measures, tasks };
});
const byName: Record<string, { n: number; ms: number; max: number }> = {};
for (const [name, , d] of detail.measures as [string, number, number][]) {
  const e = (byName[name] ??= { n: 0, ms: 0, max: 0 });
  e.n++;
  e.ms += d;
  e.max = Math.max(e.max, d);
}
const explained = (start: number, dur: number) =>
  (detail.measures as [string, number, number][]).some(
    ([, s, d]) => s < start + dur && s + d > start
  );
const unexplained = detail.tasks.filter(([s, d]) => !explained(s, d));
process.stdout.write(
  `${JSON.stringify({ ...report, steps: byName, longTasks: detail.tasks.length, unexplained })}\n`
);
await browser.close();
