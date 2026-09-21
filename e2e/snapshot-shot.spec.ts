import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LOOK_CONTROLS } from "../lib/city/look-controls";
import { parseSnapshot, type Snapshot } from "../lib/city/snapshot";

// Big crisp canvas for inspecting shadow/edge artifacts.
test.use({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

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
    test.setTimeout(180_000);
    // Validate before rendering: a broken shot fails loudly instead of
    // silently rendering the defaults.
    const parsed = parseSnapshot(readFileSync(join(SHOTS_DIR, file), "utf8"));
    if (!parsed.ok) {
      throw new Error(`${file}: ${parsed.reason}`);
    }
    const snap: Snapshot = parsed.snapshot;

    await page.goto("/");
    await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
      timeout: 120_000,
    });

    // The look controls come from the same table the HUD renders, so a new
    // slider needs no edit here (see lib/city/look-controls.ts).
    await page.evaluate(
      ([s, defs]) => {
        const api = window.__poc;
        if (!api?.applyCameraState) {
          throw new Error("snapshot api unavailable");
        }
        api.applyCameraState(s.camera);
        api.setSunIso?.(s.date);
        const look = s.look ?? {};
        for (const def of defs) {
          const raw = look[def.snapshotKey];
          const setter = api[def.setter];
          if (typeof raw === "number" && setter) {
            setter(raw / 100);
          }
        }
        if (look.dof !== undefined) {
          api.setDepthOfField?.(look.dof);
        }
        if (look.focusMode !== undefined) {
          api.setFocusMode?.(look.focusMode);
        }
        if (look.focusDistanceM !== undefined) {
          api.setFocusDistance?.(look.focusDistanceM);
        }
        if (look.multiTuft !== undefined) {
          api.setTreeMultiTuft?.(look.multiTuft);
        }
      },
      [snap, LOOK_CONTROLS] as const
    );

    // Hide every HUD/control overlay so the shot is a clean render plate:
    // keep only the canvas and its DOM ancestors visible.
    await page.evaluate(() => {
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
    });

    // Let the throttled shadow map re-render and DoF/grading settle.
    await page.waitForTimeout(1200);

    const canvas = page.locator("canvas[data-engine]");
    await expect(canvas).toBeVisible();
    await canvas.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
  });
}
