/**
 * SPIKE (plan 020): stutter on long flights. Chains the site's viewpoints
 * (so tiles stream in and out), records every frame's duration in the page
 * and reports long frames. `bun e2e/spike-flight.ts <mode> [base]`.
 */
import { chromium } from "@playwright/test";
import { DRESDEN } from "../sites/dresden";

const mode = process.argv[2] ?? "webgpu";
const BASE = process.argv[3] ?? "http://localhost:3002";
const HOPS = [
  "elbe-aerial",
  "carolabruecke",
  "rooftops",
  "canaletto",
  "elbe-promenade",
  "elbe-aerial",
  "rooftops",
  "carolabruecke",
];

type Poc = { ready: boolean; handle: { flyToViewpoint: (v: unknown) => void } };
declare const window: Window & { __poc?: Poc; __ft?: number[] };

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu"],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
await page.goto(`${BASE}/${mode === "webgl" ? "" : `?gpu=${mode}`}`);
await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
  timeout: 240_000,
});
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
const cdp = process.env.PROFILE
  ? await page.context().newCDPSession(page)
  : null;
if (cdp) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
}
const t0 = Date.now();
for (const id of HOPS) {
  const vp = DRESDEN.viewpoints.find((v) => v.id === id);
  await page.evaluate((v) => window.__poc?.handle.flyToViewpoint(v), vp);
  await page.waitForTimeout(7000);
}
if (cdp) {
  type Node = {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    children?: number[];
  };
  const { profile } = (await cdp.send("Profiler.stop")) as unknown as {
    profile: { nodes: Node[]; samples: number[]; timeDeltas: number[] };
  };
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes) {
    for (const c of n.children ?? []) {
      parent.set(c, n.id);
    }
  }
  const label = (n: Node) => {
    const f = n.callFrame;
    const file = f.url.split("/").pop()?.split("?")[0] ?? "";
    return `${f.functionName || "(anon)"} ${file}:${f.lineNumber}`;
  };
  // Runs of non-idle samples = tasks; keep those over 100 ms.
  const runs: number[][] = [];
  let run: number[] = [];
  let runMs = 0;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const ms = (profile.timeDeltas[i] ?? 0) / 1000;
    if (!n || n.callFrame.functionName === "(idle)") {
      if (runMs > 100) runs.push(run);
      run = [];
      runMs = 0;
      return;
    }
    run.push(i);
    runMs += ms;
  });
  const self = new Map<string, number>();
  const app = new Map<string, number>();
  for (const r of runs) {
    for (const i of r) {
      const ms = (profile.timeDeltas[i] ?? 0) / 1000;
      const n = byId.get(profile.samples[i]);
      if (!n) continue;
      self.set(label(n), (self.get(label(n)) ?? 0) + ms);
      // The innermost frame from our own code on the stack.
      let cur: number | undefined = n.id;
      while (cur !== undefined) {
        const c = byId.get(cur);
        if (c?.callFrame.url.includes("_components")) {
          app.set(label(c), (app.get(label(c)) ?? 0) + ms);
          break;
        }
        cur = parent.get(cur);
      }
    }
  }
  // The longest task as collapsed stacks (outermost first), top 8.
  const taskMs = (r: number[]) =>
    r.reduce((sum, i) => sum + (profile.timeDeltas[i] ?? 0) / 1000, 0);
  const longest = [...runs].sort((x, y) => taskMs(y) - taskMs(x))[0] ?? [];
  const stacks = new Map<string, number>();
  for (const i of longest) {
    const frames: string[] = [];
    let cur: number | undefined = profile.samples[i];
    while (cur !== undefined) {
      const c = byId.get(cur);
      if (c && c.callFrame.functionName !== "(root)") {
        frames.unshift(c.callFrame.functionName || "(anon)");
      }
      cur = parent.get(cur);
    }
    const key = frames.slice(9, 30).join(" > ");
    stacks.set(
      key,
      (stacks.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000
    );
  }
  process.stdout.write(`longest task ${Math.round(taskMs(longest))}ms\n`);
  for (const [k, ms] of [...stacks.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 8)) {
    process.stdout.write(`${Math.round(ms)}ms ${k}\n`);
  }
  const top = (m: Map<string, number>, k: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  process.stdout.write(`long tasks: ${runs.length}\n-- self\n`);
  for (const [k, ms] of top(self, 15))
    process.stdout.write(`${Math.round(ms)}ms ${k}\n`);
  process.stdout.write("-- our frame on the stack\n");
  for (const [k, ms] of top(app, 12))
    process.stdout.write(`${Math.round(ms)}ms ${k}\n`);
}
const ft: number[] = await page.evaluate(() => window.__ft ?? []);
const sorted = [...ft].sort((a, b) => a - b);
const pct = (p: number) =>
  Math.round(sorted[Math.floor(sorted.length * p)] ?? 0);
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
