import { expect, test } from "bun:test";
import { REFERENCE_SITE, SITES } from "../sites";
import { measureJumps } from "./line-levels";

/**
 * The steps the reference site's rails and trams are drawn with, beyond
 * their grade by more than a metre (scripts/line-levels.ts): the measured
 * state, a little above it. Lifting every point inside a deck's outline
 * drew 230 of them — lower lines jumping onto the decks they pass under,
 * upper ones dropping into the gap beside a bridge. What remains are deck
 * ends above lower ground the approaches meet and tracks that end in a
 * gap. Lower the budget when a fix lowers the count; raising it needs a
 * reason in the commit. `bun scripts/line-levels-cli.ts <site>` prints the
 * count and the worst places.
 */
const BUDGET = 20;

test("the reference site's lines are drawn without jumps beyond the budget", async () => {
  const r = await measureJumps(SITES[REFERENCE_SITE]);
  expect(r.samples).toBeGreaterThan(0);
  expect(r.after).toBeLessThanOrEqual(BUDGET);
}, 120_000);
