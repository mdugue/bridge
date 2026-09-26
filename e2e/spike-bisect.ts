/**
 * SPIKE (plan 020): one mode, one view; fps with everything on, then with one
 * look knob at a time turned off. `bun e2e/spike-bisect.ts <mode> <view>`.
 */
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3002";
const mode = process.argv[2] ?? "webgl2";
const view = process.argv[3] ?? "carolabruecke";
const states = JSON.parse(
  readFileSync("shots/spike2/states.json", "utf8")
) as Record<string, unknown>;
const OFF: Record<string, Record<string, unknown>> = {
  contact: { contact: 0 },
  dof: { dof: false },
  mist: { waterMist: 0 },
  grading: { grading: 0, grain: 0 },
  fog: { heightFog: 0 },
  shimmer: { shimmer: 0, translucency: 0, leafFlutter: 0 },
};

type Poc = {
  frames: number;
  ready: boolean;
  handle: {
    applyCameraState: (s: unknown) => void;
    setSun: (d: Date) => unknown;
  };
  look: {
    set: (p: Record<string, unknown>) => void;
    get: () => Record<string, unknown>;
  };
  stats?: Record<string, unknown>;
};
declare const window: Window & { __poc?: Poc };

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu"],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const q = mode === "webgl" ? "" : `?gpu=${mode}`;
await page.goto(`${BASE}/${q}`);
await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
  timeout: 240_000,
});
await page.evaluate((s) => {
  window.__poc?.handle.applyCameraState(s);
  window.__poc?.handle.setSun(new Date("2026-06-21T15:00:00Z"));
}, states[view]);
const measure = async () => {
  await page.waitForTimeout(2000);
  const f0 = await page.evaluate(() => window.__poc?.frames ?? 0);
  await page.waitForTimeout(5000);
  const f1 = await page.evaluate(() => window.__poc?.frames ?? 0);
  return Math.round(((f1 - f0) / 5) * 10) / 10;
};
const defaults: Record<string, unknown> = await page.evaluate(
  () => window.__poc?.look.get() ?? {}
);
const out: Record<string, number | string> = { all: await measure() };
for (const [name, patch] of Object.entries(OFF)) {
  await page.evaluate((p) => window.__poc?.look.set(p), patch);
  out[`-${name}`] = await measure();
  const restore = Object.fromEntries(
    Object.keys(patch).map((k) => [k, defaults[k]])
  );
  await page.evaluate((p) => window.__poc?.look.set(p), restore);
}
out.info = JSON.stringify(
  await page.evaluate(() => {
    const s: Record<string, unknown> = window.__poc?.stats ?? {};
    return { calls: s.calls, triangles: s.triangles, programs: s.programs };
  })
);
process.stdout.write(`${mode} ${view} ${JSON.stringify(out)}\n`);
await browser.close();
