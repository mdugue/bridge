import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

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

interface Snapshot {
  camera: {
    fov: number;
    headingDeg: number;
    mode: "walk" | "fly";
    pitchDeg: number;
    pos: { x: number; y: number; z: number };
    epsg: { x: number; y: number };
  };
  date: string;
  look: {
    bandsPct?: number;
    contactPct: number;
    dof: boolean;
    duskGlowPct?: number;
    eavePct?: number;
    focusDistanceM?: number;
    focusMode?: "auto" | "manual";
    fogPct: number;
    gradingPct: number;
    grainPct: number;
    groundShadePct?: number;
    heightFogPct?: number;
    multiTuft?: boolean;
    rimPct?: number;
    roofTintPct?: number;
    roughnessPct?: number;
    shimmerPct?: number;
    style: string;
    tintPct?: number;
    translucencyPct?: number;
    transparencyPct: number;
    waterMistPct?: number;
  };
}

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
    const snap = JSON.parse(
      readFileSync(join(SHOTS_DIR, file), "utf8")
    ) as Snapshot;

    await page.goto("/");
    await page.waitForFunction(() => window.__poc?.ready === true, undefined, {
      timeout: 120_000,
    });

    await page.evaluate((s: Snapshot) => {
      const api = window.__poc;
      if (!api?.applyCameraState) {
        throw new Error("snapshot api unavailable");
      }
      api.applyCameraState(s.camera);
      api.setSunIso?.(s.date);
      api.setStyle?.(s.look.style as Parameters<typeof api.setStyle>[0]);
      api.setBuildingTransparency?.(s.look.transparencyPct / 100);
      api.setAtmosphere?.(s.look.fogPct / 100);
      api.setDepthGrading?.(s.look.gradingPct / 100);
      api.setContactShadows?.(s.look.contactPct / 100);
      api.setPaperGrain?.(s.look.grainPct / 100);
      api.setDepthOfField?.(s.look.dof);
      if (s.look.focusMode !== undefined) {
        api.setFocusMode?.(s.look.focusMode);
      }
      if (s.look.focusDistanceM !== undefined) {
        api.setFocusDistance?.(s.look.focusDistanceM);
      }
      // Optional (newer) look fields — only applied when present in the shot.
      if (s.look.groundShadePct !== undefined) {
        api.setBuildingGroundShade?.(s.look.groundShadePct / 100);
      }
      if (s.look.bandsPct !== undefined) {
        api.setBuildingBands?.(s.look.bandsPct / 100);
      }
      if (s.look.rimPct !== undefined) {
        api.setBuildingRim?.(s.look.rimPct / 100);
      }
      if (s.look.tintPct !== undefined) {
        api.setBuildingTint?.(s.look.tintPct / 100);
      }
      if (s.look.roofTintPct !== undefined) {
        api.setBuildingRoofTint?.(s.look.roofTintPct / 100);
      }
      if (s.look.eavePct !== undefined) {
        api.setBuildingEave?.(s.look.eavePct / 100);
      }
      if (s.look.duskGlowPct !== undefined) {
        api.setBuildingDuskGlow?.(s.look.duskGlowPct / 100);
      }
      if (s.look.roughnessPct !== undefined) {
        api.setBuildingRoughness?.(s.look.roughnessPct / 100);
      }
      if (s.look.shimmerPct !== undefined) {
        api.setTreeShimmer?.(s.look.shimmerPct / 100);
      }
      if (s.look.translucencyPct !== undefined) {
        api.setTreeTranslucency?.(s.look.translucencyPct / 100);
      }
      if (s.look.multiTuft !== undefined) {
        api.setTreeMultiTuft?.(s.look.multiTuft);
      }
      if (s.look.heightFogPct !== undefined) {
        api.setHeightFog?.(s.look.heightFogPct / 100);
      }
      if (s.look.waterMistPct !== undefined) {
        api.setWaterMist?.(s.look.waterMistPct / 100);
      }
    }, snap);

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
