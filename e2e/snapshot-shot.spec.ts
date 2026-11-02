import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { utmToLatLng } from "../lib/city/crs";
import { arrivalHref } from "../lib/city/geolocation";
import {
  decodeLook,
  parseSnapshot,
  type Snapshot,
  snapshotInstant,
} from "../lib/city/snapshot";
import { siteById } from "../sites";

/**
 * Big crisp canvas for inspecting shadow/edge artifacts — or, with
 * `SHOTS_SMALL=1`, 800 × 500 at 1× (the same 16:10) and fifteen minutes to
 * load: what a software-rendered container (the routines' street-photo
 * check, docs/routines.md) can draw, with `SHOTS_QUERY=scene=lite&block=1`.
 * Dresden's `lite` boot took 7–11 minutes there (2026-10-31).
 */
const SHOTS_SMALL = Boolean(process.env.SHOTS_SMALL);
const READY_MS = SHOTS_SMALL ? 900_000 : 120_000;
test.use(
  SHOTS_SMALL
    ? { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 }
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

const SHOTS_DIR = join(process.cwd(), "shots");
/**
 * Before/after pairs from one set of snapshots — the ONE mechanism:
 * `SHOTS_QUERY` is appended to the page URL (with or without its leading
 * `?`, e.g. `SHOTS_QUERY=scene=lite`), and `SHOTS_TAG=x` writes
 * `shots/<name>.x.png` so the untagged plate is not overwritten.
 */
const SHOTS_QUERY = (process.env.SHOTS_QUERY ?? "").replace(/^\?/, "");
/** The city the shots are taken in (its route): `SHOTS_SITE=leipzig`. */
const SHOTS_SITE = process.env.SHOTS_SITE ?? "dresden";
const SHOTS_TAG = process.env.SHOTS_TAG ?? "";
/**
 * `SHOTS_AT=1`: boot the page at the snapshot's own place (`#at=lat,lng`
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
  const [path, hash] = arrivalHref(SHOTS_SITE, at).split("#");
  return `${path}${query}#${hash}`;
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

function snapshotFiles(): string[] {
  try {
    return readdirSync(SHOTS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

for (const file of snapshotFiles()) {
  const name = file.replace(/\.json$/, "");
  test(`snapshot: ${name}`, async ({ page }) => {
    test.setTimeout(READY_MS + 150_000);
    // Validate before rendering: a broken shot fails loudly instead of
    // silently rendering the defaults.
    const parsed = parseSnapshot(readFileSync(join(SHOTS_DIR, file), "utf8"));
    if (!parsed.ok) {
      throw new Error(`${file}: ${parsed.reason}`);
    }
    const snap: Snapshot = parsed.snapshot;

    await page.goto(shotUrl(snap));
    await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
      timeout: READY_MS,
    });

    // The same codec (and the same minute-floored instant) the HUD's Apply
    // button uses, against the same store the sliders write — a new look
    // control needs no edit here.
    const lookPatch = decodeLook(snap.look);
    const instant = snapshotInstant(snap).toISOString();
    const before = await page.evaluate(
      ([camera, date, patch]) => {
        const poc = window.__poc;
        if (!(poc?.handle && poc.look)) {
          throw new Error("scene handle not published");
        }
        const counts = { frames: poc.frames, shadows: poc.shadowRenders };
        poc.handle.applyCameraState(camera);
        poc.handle.setSun(new Date(date));
        poc.look.set(patch);
        return counts;
      },
      [snap.camera, instant, lookPatch] as const
    );

    await page.evaluate(hideOverlays);

    // Let the shadow map re-render for the new pose and sun, the motion
    // regression lift (DoF is off for RECOVER_MS after the move) and grading
    // settle: counted in frames, not waited out on a clock (a slow
    // GPU took longer than any fixed sleep). By night no shadow map is
    // drawn, so after `shadowless` frames the plate is taken without one.
    await page.waitForFunction(
      ({ frames, shadows, settle, shadowless }) => {
        const poc = window.__poc;
        const drawn = (poc?.frames ?? 0) - frames;
        return (
          drawn >= settle &&
          // the move regressed the post stack: DoF is back once it is still
          !poc?.regressed &&
          ((poc?.shadowRenders ?? 0) > shadows || drawn >= shadowless)
        );
      },
      { ...before, settle: 3, shadowless: 30 },
      { timeout: 120_000 }
    );

    // Again: a notice raised after the move ("Umgebung lädt") was not
    // there to hide the first time.
    await page.evaluate(hideOverlays);
    const canvas = page.locator("canvas[data-engine]");
    await expect(canvas).toBeVisible();
    const tag = SHOTS_TAG ? `.${SHOTS_TAG}` : "";
    await canvas.screenshot({ path: join(SHOTS_DIR, `${name}${tag}.png`) });
  });
}
