// usage: node probe.mjs <outDir> <styles,comma> [query] [w h] [date] [lookJSON]
// env: POSE (a camera state, JSON) instead of the initial view; STEP_M (the
// sideways step, m; default 0.025); BASE_URL (default localhost:3000);
// CHROME (a browser binary). Needs a build with NEXT_PUBLIC_POC_DEBUG=1.
// Boots /dresden, holds the loop and fixes the clock step, and per style
// saves a, b (the next frame, camera still) and m1–m3 (three frames, each
// after one more step to the camera's right).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [outDir, stylesArg, query = "gpu=webgl2", W = "960", H = "600", date = "2026-10-30T12:00:00.000Z", extra = "{}"] = process.argv.slice(2);
const styles = stylesArg.split(",");
mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0) + "s", ...a);
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on("pageerror", (e) => log("pageerror", e.message));
page.on("console", (m) => { if (m.type() === "error") log("console", m.text().slice(0, 300)); });
if (process.env.POSE) await page.addInitScript((pose) => { window.__probePose = JSON.parse(pose); }, process.env.POSE);
await page.goto(`${process.env.BASE_URL ?? "http://localhost:3000"}/dresden?${query}`);
await page.waitForFunction(() => window.__poc?.firstFrame === true, undefined, { timeout: 1_500_000, polling: 2000 });
log("first frame");
const pose = await page.evaluate(([d, ex]) => {
  const p = window.__poc;
  p.handle.setSun(new Date(d));
  p.look.set({ style: "pastel", ...JSON.parse(ex) });
  const cam = p.handle.getCameraState();
  const keepEl = document.querySelector("canvas[data-engine]");
  const keep = new Set();
  for (let el = keepEl; el; el = el.parentElement) keep.add(el);
  for (const n of keep) { const par = n.parentElement; if (!par) continue; for (const c of par.children) if (!keep.has(c)) c.style.visibility = "hidden"; }
  const forced = window.__probePose;
  if (forced) { p.handle.applyCameraState(forced); return forced; }
  return cam;
}, [date, extra]);
writeFileSync(`${outDir}/pose.json`, JSON.stringify(pose));
await page.waitForFunction(() => window.__poc?.ready === true, undefined, { timeout: 2_400_000, polling: 3000 });
log("ready");
const frames = (n) => page.evaluate(async (n) => {
  // window.__poc is replaced on every patch (poc-debug.ts): never keep it
  const poc = () => window.__poc;
  const f = poc().frames;
  poc().step = n;
  const t = Date.now();
  while (poc().frames < f + n) {
    if (Date.now() - t > 240000) return `stuck at ${poc().frames - f}/${n}, step ${poc().step}`;
    await new Promise((r) => setTimeout(r, 50));
  }
  return "ok";
}, n).then((r) => { if (r !== "ok") log(r); });
await page.evaluate(() => { const p = window.__poc; p.frameMs = 1000 / 60; p.hold = true; p.step = 0; });
// Walk mode lets the eye settle onto the ground after a teleport (a
// fraction of a mm a frame, decaying): step until it holds still, so a→b
// is a true still pair, and return the settled state as the motion base.
const settle = async () => {
  let last = null;
  for (let i = 0; i < 400; i++) {
    await frames(1);
    const c = await page.evaluate(() => { const c = window.__poc.handle.getCameraState(); return { ...c, pos: { ...c.pos } }; });
    if (last && Math.abs(c.pos.x - last.pos.x) + Math.abs(c.pos.y - last.pos.y) + Math.abs(c.pos.z - last.pos.z) < 2e-5) return c;
    last = c;
  }
  log("camera never settled");
  return last;
};
for (const style of styles) {
  await page.evaluate((s) => window.__poc.look.set({ style: s }), style);
  await frames(8);
  const base = await settle();
  await page.screenshot({ path: `${outDir}/${style}.a.png`, timeout: 300_000 });
  await frames(1);
  await page.screenshot({ path: `${outDir}/${style}.b.png`, timeout: 300_000 });
  // three steps to the camera's right: 2.5 cm (1.5 m/s at 60 fps) by
  // default; STEP_M=0.001 makes the motion sub-pixel, where a stable
  // picture barely changes and any binary decision that flips shows
  for (let k = 1; k <= 3; k++) {
    await page.evaluate(([cam, k, step]) => {
      const c = structuredClone(cam);
      const h = (c.headingDeg * Math.PI) / 180;
      c.pos.x += step * k * Math.cos(h); c.pos.z += step * k * Math.sin(h);
      window.__poc.handle.applyCameraState(c);
    }, [base, k, Number(process.env.STEP_M ?? 0.025)]);
    await frames(1);
    await page.screenshot({ path: `${outDir}/${style}.m${k}.png`, timeout: 300_000 });
  }
  await page.evaluate((cam) => window.__poc.handle.applyCameraState(cam), base);
  log(style);
}
await browser.close();
