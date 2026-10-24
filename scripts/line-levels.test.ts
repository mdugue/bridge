import { expect, test } from "bun:test";
import { REFERENCE_SITE, SITES } from "../sites";
import { measureJumps } from "./line-levels";

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
  const r = await measureJumps(SITES[REFERENCE_SITE], undefined, STEP_M);
  expect(r.samples).toBeGreaterThan(0);
  expect(r.after).toBeLessThanOrEqual(BUDGET);
}, 120_000);
