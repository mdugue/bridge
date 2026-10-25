import { expect, test } from "bun:test";
import { REFERENCE_SITE, SITES } from "../sites";
import { readDgmFile } from "./dgm-cache";
import {
  AxisIndex,
  clearOfTracks,
  outsideAreas,
  ringLength,
} from "../lib/city/platform-clearance";
import { tileIds } from "../lib/city/tile";
import {
  isDlmLine,
  measureJumps,
  railFeatures,
  sitePlatforms,
  siteLineLevels,
  siteTrackAxes,
} from "./line-levels";

/**
 * The steps the reference site's rails and trams are drawn with, beyond
 * their grade by more than 0.3 m (scripts/line-levels.ts). Lifting every
 * point inside a deck's outline drew 230 of them beyond a metre (ADR
 * 0041); the levels alone still left 16 beyond a metre and 100 beyond
 * 0.3 m — deck ends above lower ground, the DGM's bumps. Drawn on its
 * profile (ADR 0052) a line keeps its grade by construction: none.
 * Raising the budget needs a reason in the commit. `bun
 * scripts/line-levels-cli.ts <site> [step]` prints the count and the worst
 * places.
 */
const BUDGET = 0;
const STEP_M = 0.3;

test("the reference site's lines are drawn without jumps beyond the budget", async () => {
  const r = await measureJumps(
    SITES[REFERENCE_SITE],
    undefined,
    STEP_M,
    (tif, tfw) => readDgmFile(tif, tfw, "native")
  );
  expect(r.samples).toBeGreaterThan(0);
  expect(r.after).toBeLessThanOrEqual(BUDGET);
}, 120_000);

/**
 * No platform of the reference site stands over a drawn track: every
 * outline the build cuts back (lib/city/platform-clearance.ts) keeps its
 * edge distance, and no Basis-DLM centreline runs over one (an island's
 * outline held one at Dresden-Neustadt and the Hauptbahnhof, and the
 * edge of one stood 0.6 m from a track's centre at the Hauptbahnhof).
 */
test("the reference site's platforms keep clear of its tracks", async () => {
  const site = SITES[REFERENCE_SITE];
  const axes = siteTrackAxes(site, await siteLineLevels(site));
  const cut = new AxisIndex(axes);
  // a centimetre's rounding inside the cut's own distance
  const check = new AxisIndex(
    axes.map((a) => ({ ...a, clear: a.clear - 0.02 }))
  );
  const platforms = sitePlatforms(site);
  expect(platforms.length).toBeGreaterThan(0);
  for (const coordinates of platforms) {
    const cleared = clearOfTracks({ type: "Polygon", coordinates }, cut);
    if (cleared) {
      expect(clearOfTracks(cleared, check)).toBe(cleared);
    }
  }
  for (const tile of tileIds(site)) {
    for (const f of railFeatures(site, tile)) {
      if (f.geometry?.type === "LineString" && isDlmLine(f)) {
        const coords = f.geometry.coordinates;
        const parts = outsideAreas(coords, platforms, 0) ?? [coords];
        // an end cut where the line grazes an outline moves along it with
        // the centimetre's rounding
        expect(
          ringLength(coords) - parts.reduce((s, p) => s + ringLength(p), 0)
        ).toBeLessThan(0.5);
      }
    }
  }
}, 120_000);
