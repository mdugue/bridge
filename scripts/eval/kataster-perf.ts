/**
 * Historical: the cadastre is drawn by default now and `?trees=kataster` no
 * longer switches anything, so both runs below measure the same scene. Kept
 * as the recipe behind the numbers in docs/transformations.md.
 *
 * Real-GPU timing for the 🧪 tree-cadastre layer: boots the viewer headed
 * (vsync and the frame-rate limit off, so the frame counter measures the GPU,
 * not the display) with and without `?trees=kataster`, and reports the time
 * to the first frame and to `ready`, the vegetation census and GPU estimate
 * the HUD stats carry, and the frame rate at each shots/kat-*.json pose.
 *
 * Needs a server with the debug hook on BASE (default http://localhost:3101):
 *   NEXT_PUBLIC_POC_DEBUG=1 bun run build && PORT=3101 bun run start
 * Run: bun scripts/eval/kataster-perf.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3101";
const ROOT = join(import.meta.dir, "..", "..");
const SHOTS = join(ROOT, "shots");
const RUNS = Number(process.env.RUNS ?? 2);

interface PocView {
  firstFrame: boolean;
  frames: number;
  ready: boolean;
  stats?: { gpuMegabytes: number; layerStats: Record<string, unknown> };
}

const poc = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __poc?: PocView }).__poc;
    return p
      ? {
          firstFrame: p.firstFrame,
          frames: p.frames,
          ready: p.ready,
          stats: p.stats,
        }
      : null;
  });

async function fps(page: Page, ms: number): Promise<number> {
  const a = (await poc(page))?.frames ?? 0;
  await page.waitForTimeout(ms);
  const b = (await poc(page))?.frames ?? 0;
  return Math.round(((b - a) * 1000) / ms);
}

async function run(query: string) {
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
  });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/${query}`);
  await page.waitForFunction(
    () => (window as never as { __poc?: PocView }).__poc?.firstFrame === true,
    undefined,
    { timeout: 120_000 }
  );
  const firstFrameMs = Date.now() - t0;
  await page.waitForFunction(
    () => (window as never as { __poc?: PocView }).__poc?.ready === true,
    undefined,
    { timeout: 180_000 }
  );
  const readyMs = Date.now() - t0;
  const state = await poc(page);
  const views: Record<string, number> = {};
  for (const file of readdirSync(SHOTS)
    .filter((f) => f.startsWith("kat-") && f.endsWith(".json"))
    .sort()) {
    const snap = JSON.parse(readFileSync(join(SHOTS, file), "utf8")) as {
      camera: unknown;
      date: string;
    };
    await page.evaluate(
      ([camera, date]) => {
        const h = (
          window as never as {
            __poc?: {
              handle?: {
                applyCameraState: (c: unknown) => void;
                setSun: (d: Date) => void;
              };
            };
          }
        ).__poc?.handle;
        h?.applyCameraState(camera);
        h?.setSun(new Date(date));
      },
      [snap.camera, snap.date] as const
    );
    await page.waitForTimeout(1500);
    views[file.replace(/\.json$/, "")] = await fps(page, 3000);
  }
  await browser.close();
  return {
    firstFrameMs,
    readyMs,
    gpuMegabytes: state?.stats?.gpuMegabytes,
    vegetation: state?.stats?.layerStats.vegetation,
    fps: views,
  };
}

const out: Record<string, unknown[]> = { canopy: [], kataster: [] };
for (let i = 0; i < RUNS; i++) {
  out.canopy.push(await run(""));
  out.kataster.push(await run("?trees=kataster"));
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
