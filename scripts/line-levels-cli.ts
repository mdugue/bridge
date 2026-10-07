/**
 * Where a site's drawn rail and tram lines still jump, before (the old
 * rule: any deck under a point lifts it) and after the solved levels
 * (scripts/line-levels.ts):
 *
 *   bun scripts/line-levels-cli.ts <site>
 *
 * A runner of its own so the bake module does not import `sites/`: the
 * build cache keys each artifact on its bake's import graph
 * (scripts/bake-sources.ts), and the site configs would put every site's
 * edits into every terrain key.
 */
import { siteFromArgs } from "../sites";
import { measureJumps } from "./line-levels";

const { site } = siteFromArgs(process.argv.slice(2));
const r = await measureJumps(site);
process.stdout.write(
  `${site.id}: ${r.samples} samples; jumps ${r.before} before, ${r.after} after\n`
);
for (const w of r.worst.slice(0, 20)) {
  process.stdout.write(
    `  ${w.line} at ${w.x.toFixed(1)} ${w.y.toFixed(1)} by ${w.by.toFixed(2)} m\n`
  );
}
