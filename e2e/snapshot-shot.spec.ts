import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { utmToLatLng } from "../lib/city/crs";
import { arrivalHref } from "../lib/city/geolocation";
import {
  decodeLook,
  parseSnapshot,
  snapshotInstant,
} from "../lib/city/snapshot";
import type { Snapshot } from "../lib/city/snapshot";
import { siteById } from "../sites";
import { SWIFTSHADER_WEBGPU } from "./swiftshader-webgpu";

/**
 * Big crisp canvas for inspecting shadow/edge artifacts — or, with
 * `SHOTS_SMALL=1`, 800 × 500 at 1× (the same 16:10) and fifteen minutes to
 * load: what a software-rendered container (the routines' street-photo
 * check, docs/routines.md) can draw, with `SHOTS_QUERY=scene=lite&block=1`.
 * Dresden's `lite` boot took 7–11 minutes there (2026-10-31). That path
 * draws WebGPU on SwiftShader's Vulkan (swiftshader-webgpu.ts); the headed
 * real-GPU path keeps the browser's own adapter.
 */
const SHOTS_SMALL = Boolean(process.env.SHOTS_SMALL);
const READY_MS = SHOTS_SMALL ? 900_000 : 120_000;
test.use(
  SHOTS_SMALL
    ? {
        viewport: { width: 800, height: 500 },
        deviceScaleFactor: 1,
        launchOptions: SWIFTSHADER_WEBGPU,
      }
    : { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 }
);

/**
 * Snapshot screenshot harness — NOT a smoke test. Reproduces an exact view
 * from a copied Snapshot JSON (see the in-app Snapshot panel) and writes a PNG
 * next to it, so shadow/edge tuning can be eyeballed by the developer (or the
 * agent) instead of asking the user for screenshots each round.
 *
 * Run it against a real GPU (otherwise shadows render under SwiftShader and
 * look nothing like the user's machine):
 *
 *   bunx playwright test e2e/snapshot-shot.spec.ts --headed
 *
 * Drop snapshot JSON files into shots/ (e.g. shots/current.json); each one
 * yields shots/<name>.png.
 */

const SHOTS_DIR = nodePath.join(process.cwd(), "shots");
/**
 * Before/after pairs from one set of snapshots — the ONE mechanism:
 * `SHOTS_QUERY` is appended to the page URL (with or without its leading
 * `?`, e.g. `SHOTS_QUERY=scene=lite`), and `SHOTS_TAG=x` writes
 * `shots/<name>.x.png` so the untagged plate is not overwritten.
 */
const SHOTS_QUERY = (process.env.SHOTS_QUERY ?? "").replace(/^\?/u, "");
/** The city the shots are taken in (its route): `SHOTS_SITE=leipzig`. */
const SHOTS_SITE = process.env.SHOTS_SITE ?? "dresden";
const SHOTS_TAG = process.env.SHOTS_TAG ?? "";
/**
 * `SHOTS_AT=1`: boot the page at the snapshot's own place (`?at=lat,lng`
 * from its `camera.epsg`) instead of the site's spawn. The `lite` scene
 * streams only around where it booted, so a pose a kilometre from the
 * spawn would otherwise show the wrong part of the city — the street
 * photos are spread over the whole site.
 */
const SHOTS_AT = Boolean(process.env.SHOTS_AT);

/** The page a snapshot is taken on: the site, its query, its place. */
function shotUrl(snap: Snapshot): string {
  const query = SHOTS_QUERY ? `?${SHOTS_QUERY}` : "";
  const epsg = siteById(SHOTS_SITE)?.provider.epsg;
  const at =
    SHOTS_AT && snap.camera.epsg && epsg
      ? utmToLatLng(epsg, snap.camera.epsg.x, snap.camera.epsg.y)
      : null;
  if (!at) {
    return `/${SHOTS_SITE}${query}`;
  }
  return `${arrivalHref(SHOTS_SITE, at)}${SHOTS_QUERY ? `&${SHOTS_QUERY}` : ""}`;
}

/** Hide every HUD/control overlay so the shot is a clean render plate:
 *  keep only the canvas and its DOM ancestors visible. */
function hideOverlays(): void {
  const canvas = document.querySelector("canvas[data-engine]");
  if (!canvas) {
    return;
  }
  const keep = new Set<Element>();
  for (let el: Element | null = canvas; el; el = el.parentElement) {
    keep.add(el);
  }
  for (const node of keep) {
    const parent = node.parentElement;
    if (!parent) {
      continue;
    }
    for (const child of Array.from(parent.children)) {
      if (!keep.has(child)) {
        (child as HTMLElement).style.visibility = "hidden";
      }
    }
  }
}

/**
 * The committed QA views (plan 048, `bun scripts/qa-views.ts`): rendered
 * beside the dropped snapshots as `shots/qa-<name>.png`, so `shots/`
 * stays the one output (and gitignored). One of them:
 * `bun run shots -- --grep qa-<name>`.
 */
const QA_VIEWS_DIR = nodePath.join(process.cwd(), "qa", "views");

/** The snapshots in `dir`, their plates named `<prefix><name>`. */
function jsonsIn(
  dir: string,
  prefix: string
): { path: string; name: string }[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        path: nodePath.join(dir, f),
        name: `${prefix}${f.replace(/\.json$/u, "")}`,
      }));
  } catch {
    return [];
  }
}

/**
 * `PLATES_DIR=<folder>` (set by scripts/plates.ts, plan 087): the QA views
 * as compared plates, `<folder>/qa-<name>.png` and a `run.json` with the
 * adapter and each view's time. `PLATES_VIEWS=a,b` names the views, in
 * that order; without it, every one.
 */
const PLATES_DIR = process.env.PLATES_DIR ?? "";
const PLATES_VIEWS = (process.env.PLATES_VIEWS ?? "")
  .split(",")
  .filter(Boolean);
/** `PLATES_STILL=0` lets time run: how the noise floor was read without
 *  the hold (plan 087, Findings). */
const PLATES_STILL = process.env.PLATES_STILL !== "0";
/** A view's budget: on SwiftShader a far view streams for minutes. */
const PLATE_VIEW_MS = SHOTS_SMALL ? 600_000 : 60_000;
/**
 * Frames a plate waits at the least — the stream has seen the view — and
 * for a shadow map by night, when none is drawn; and the loop's step a frame while it does (ms): the largest the loop takes
 * (it clamps a step to 50 ms), so that what settles by the clock (the
 * regression's recovery, the lens's fade, the eye onto the ground) needs
 * a third of the frames of a 60 Hz step. With `still` nothing animates by
 * it, and a SwiftShader frame takes seconds.
 */
const PLATE_SETTLE = { settle: 8, shadowless: 12 };
const PLATE_FRAME_MS = 50;

/** What the adapter says of itself (`GPUAdapterInfo`). */
interface GpuLike {
  requestAdapter: () => Promise<{
    info?: Record<"architecture" | "description" | "device" | "vendor", string>;
  } | null>;
}

/** The views a plates run renders, in the order asked for. */
function plateViews(): { path: string; name: string }[] {
  const all = jsonsIn(QA_VIEWS_DIR, "qa-");
  if (PLATES_VIEWS.length === 0) {
    return all;
  }
  return PLATES_VIEWS.map((view) => {
    const found = all.find((v) => v.name === `qa-${view}`);
    if (!found) {
      throw new Error(`no QA view named ${view}`);
    }
    return found;
  });
}

/** Each snapshot to render: the dropped ones, then the QA views. */
function snapshotFiles(): { path: string; name: string }[] {
  return [...jsonsIn(SHOTS_DIR, ""), ...jsonsIn(QA_VIEWS_DIR, "qa-")];
}

/** Frames on end the scene has to say it is settled before a plate. */
const SETTLE_QUIET_FRAMES = 3;
/** How long a view may take to settle. */
const SETTLE_MS = READY_MS + 60_000;

/** A snapshot file, validated: a broken one fails loudly instead of
 *  silently rendering the defaults. */
function readSnapshot(file: string): Snapshot {
  const parsed = parseSnapshot(readFileSync(file, "utf-8"));
  if (!parsed.ok) {
    throw new Error(`${file}: ${parsed.reason}`);
  }
  return parsed.snapshot;
}

/** The page booted and everything in view streamed in; the loading veil
 *  (load-veil.ts) off, which would draw over what a flight brings. */
async function bootPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
    timeout: READY_MS,
  });
  await page.evaluate(async () => {
    if (window.__poc) {
      window.__poc.veil = { radius: 6000, strength: 0 };
      await window.__poc.handle?.sync();
    }
  });
}

/**
 * Apply a snapshot and wait, in frames, until its picture has settled:
 * the shadow map re-rendered for the new pose and sun, the motion
 * regression lifted (DoF is off for RECOVER_MS after the move), the lens
 * grown in, the view's own tiles landed. Counted in frames, not waited out
 * on a clock (a slow GPU took longer than any fixed sleep). By night no
 * shadow map is drawn, so after `shadowless` frames the plate is taken
 * without one. `settle`: the frames the stream needs to see the new view
 * at all.
 */
async function applyAndSettle(
  page: Page,
  snap: Snapshot,
  { settle, shadowless }: { settle: number; shadowless: number }
): Promise<void> {
  // The same codec (and the same minute-floored instant) the HUD's Apply
  // button uses, against the same store the sliders write — a new look
  // control needs no edit here.
  const lookPatch = decodeLook(snap.look);
  const instant = snapshotInstant(snap).toISOString();
  const before = await page.evaluate(
    async ([camera, date, patch]) => {
      const poc = window.__poc;
      if (!(poc?.handle && poc.look)) {
        throw new Error("scene handle not published");
      }
      poc.handle.applyCameraState(camera);
      poc.handle.setSun(new Date(date));
      poc.look.set(patch);
      // The scene may run in a worker (ADR 0061): the counts below are
      // its mirror, read only once it has heard the three calls — or the
      // frames of a boot still streaming count as this view's.
      await poc.handle.sync();
      return { frames: poc.frames, shadows: poc.shadowRenders };
    },
    [snap.camera, instant, lookPatch] as const
  );
  await page.evaluate(hideOverlays);
  // One loop inside the page, awaited: `waitForFunction` on an interval
  // takes an async predicate's promise for its answer, and so never waited.
  await page.evaluate(
    async ({ frames, shadows, least, nightly, quiet, budget }) => {
      const until = performance.now() + budget;
      let busyAt = 0;
      while (performance.now() < until) {
        const poc = window.__poc;
        const drawn = (poc?.frames ?? 0) - frames;
        let busy =
          // the move regressed the post stack: DoF is back once it is
          // still, and grown in fully where the style draws it
          poc?.regressed === true ||
          // the rings redraw one a frame, the wide ones at a distance
          poc?.handle?.shadowBusy() === true ||
          // a plate far from the spawn waits for its own tiles to land
          poc?.handle?.streamBusy() === true;
        if (!busy) {
          // (asked last: a call wakes the scene's pace, lib/city/frame-pace.ts)
          const focus = await poc?.handle?.getFocusDebug();
          busy = focus?.settled === false;
        }
        // Quiet for some frames on end, not for one: between a tile
        // landing and its dressing being queued the scene says "settled".
        if (busy) {
          busyAt = Math.max(drawn, 0);
        }
        if (
          drawn >= least &&
          drawn - busyAt >= quiet &&
          ((poc?.shadowRenders ?? 0) > shadows || drawn >= nightly)
        ) {
          return;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
      throw new Error("the view never settled");
    },
    {
      ...before,
      least: settle,
      nightly: shadowless,
      quiet: SETTLE_QUIET_FRAMES,
      budget: SETTLE_MS,
    }
  );
  // Again: a notice raised after the move ("Umgebung lädt") was not
  // there to hide the first time.
  await page.evaluate(hideOverlays);
}

if (PLATES_DIR) {
  // The compared plates (scripts/plates.ts): every view from ONE booted
  // page, in the table's order, on the held clock.
  test("plates", async ({ page }) => {
    const views = plateViews();
    test.setTimeout(READY_MS + views.length * PLATE_VIEW_MS);
    mkdirSync(PLATES_DIR, { recursive: true });
    const times: Record<string, number> = {};
    const started = Date.now();
    await bootPage(
      page,
      `/${SHOTS_SITE}${SHOTS_QUERY ? `?${SHOTS_QUERY}` : ""}`
    );
    times.boot = Date.now() - started;
    const adapter = await page.evaluate(async () => {
      // reason: lib.dom of this TypeScript has no `navigator.gpu`
      const { gpu } = navigator as unknown as { gpu?: GpuLike };
      const found = await gpu?.requestAdapter();
      const info = found?.info;
      return info
        ? [info.vendor, info.architecture, info.device, info.description]
            .filter(Boolean)
            .join(" ")
        : "none";
    });
    // A fixed step a drawn frame, and no time passing in what animates
    // (poc-scene.ts `still`): two renders of one commit are one picture.
    const held = await page.evaluate(
      async ([frameMs, still]) => {
        const poc = window.__poc;
        if (!poc) {
          return false;
        }
        // a build from before the probe takes the value and holds nothing
        const known =
          Object.getOwnPropertyDescriptor(poc, "still")?.set !== undefined;
        poc.frameMs = frameMs;
        poc.still = still;
        await poc.handle?.sync();
        return known && still;
      },
      [PLATE_FRAME_MS, PLATES_STILL] as const
    );
    const canvas = page.locator("canvas[data-engine]");
    for (const { path: file, name } of views) {
      const viewStarted = Date.now();
      await applyAndSettle(page, readSnapshot(file), PLATE_SETTLE);
      await canvas.screenshot({
        path: nodePath.join(PLATES_DIR, `${name}.png`),
      });
      times[name] = Date.now() - viewStarted;
    }
    writeFileSync(
      nodePath.join(PLATES_DIR, "run.json"),
      `${JSON.stringify({ adapter, held, query: SHOTS_QUERY, small: SHOTS_SMALL, ms: times }, null, 2)}\n`
    );
  });
} else {
  for (const { path: file, name } of snapshotFiles()) {
    test(`snapshot: ${name}`, async ({ page }) => {
      test.setTimeout(READY_MS + 150_000);
      const snap = readSnapshot(file);
      await bootPage(page, shotUrl(snap));
      // settle: frames for the stream to see the new view at all
      await applyAndSettle(page, snap, { settle: 10, shadowless: 30 });
      const canvas = page.locator("canvas[data-engine]");
      await expect(canvas).toBeVisible();
      const tag = SHOTS_TAG ? `.${SHOTS_TAG}` : "";
      await canvas.screenshot({
        path: nodePath.join(SHOTS_DIR, `${name}${tag}.png`),
      });
    });
  }
}
