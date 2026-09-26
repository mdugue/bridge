/**
 * The site's offline pipeline (pipeline/, Python in its own uv environment),
 * for the site `SITE` names (.env.local):
 *
 *   bun run fetch [tile…]             download what the site needs: the
 *                                     provider's DGM1 + LoD2 (→ data/<site>/)
 *                                     and DOM, DOP, Basis-DLM, OSM
 *                                     (→ data/_raw/<provider>/); skips what
 *                                     is already there
 *   bun run bake [tile…]              bake the derived artifacts
 *                                     (→ data/<site>/dlm, dop)
 *   bun run fetch --lsc               ... and the laser scan, where the
 *                                     provider's adapter reads one (≈380 MB
 *                                     a tile)
 *   bun run bake --step canopy        one step, in the order `all` runs them
 *                                     (landcover, islands, canopy, trees,
 *                                     ndvi, roof-colour, osm-buildings, rail,
 *                                     lamps, monuments, furniture, walls,
 *                                     stairs, surface, edges, markings,
 *                                     sport, tram, riverside, skyview,
 *                                     soundmarks, lowveg, cultivated,
 *                                     small-buildings)
 *   bun run bake --step lowveg --research   also every hedge/shrub
 *                                     candidate, under the raw folder
 *
 * The steps run in dependency order: land cover first (the canopy, the
 * tree cadastre, lamps and street furniture are gated on it); the bridges
 * (rail) before the furniture and trams; the hedges and scan trees late
 * (thinned against the canopy and the cadastre), then the orchards and the
 * small structures. Several steps read the neighbours' files across a seam,
 * so run a step for every tile. The site config (sites/) becomes one JSON
 * spec (pipeline/bake/spec.py), so Python never re-derives tiles, extents
 * or products. Then `bun dev` /
 * `bun run build` turn data/<site>/ into the tileset (prepare-data.ts).
 */
import { spawnSync } from "node:child_process";
import {
  osmExtractUrl,
  type Site,
  tileExtentOf,
  tileIdOf,
} from "../lib/city/site";
import { providerRawDir, siteDataDir } from "../lib/city/tile";
import { currentSite } from "../sites";

/** The spec pipeline/bake/spec.py parses. */
export function siteSpec(site: Site) {
  return {
    site: site.id,
    provider: site.provider.id,
    epsg: site.provider.epsg,
    products: site.provider.products,
    credit: site.provider.credit,
    treeCadastre: site.treeCadastre ?? null,
    raw: providerRawDir(site),
    data: siteDataDir(site),
    osm: osmExtractUrl(site),
    tiles: site.tiles.map((cell) => ({
      id: tileIdOf(site, cell),
      bounds: tileExtentOf(cell),
    })),
  };
}

/** The options each command takes (`--step` needs a value). */
const OPTIONS = {
  fetch: ["--lsc"],
  bake: ["--step", "--research"],
} as const;

/** The options `args` gives that `command` does not take. */
export function unknownOptions(
  command: keyof typeof OPTIONS,
  args: string[]
): string[] {
  const known: readonly string[] = OPTIONS[command];
  return args.filter((a) => a.startsWith("--") && !known.includes(a));
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "fetch" && command !== "bake") {
    process.stderr.write("usage: bun scripts/pipeline.ts fetch|bake [tile…]\n");
    process.exit(2);
  }
  const site = currentSite();
  const step = args.indexOf("--step");
  const bad = unknownOptions(command, args);
  if (bad.length > 0) {
    process.stderr.write(`${command}: unknown option ${bad.join(" ")}\n`);
    process.exit(2);
  }
  const tiles = args.filter(
    (a, i) => !a.startsWith("--") && (step < 0 || i !== step + 1)
  );
  process.stdout.write(`${command}: ${site.id} (${site.provider.name})\n`);
  const run = spawnSync(
    "uv",
    [
      "run",
      "--project",
      "pipeline",
      "python",
      "-m",
      "bake",
      command,
      "--spec",
      JSON.stringify(siteSpec(site)),
      ...(step >= 0 ? ["--step", args[step + 1] ?? ""] : []),
      ...(tiles.length > 0 ? ["--tile", ...tiles] : []),
      ...args.filter((a) => a === "--lsc" || a === "--research"),
    ],
    { stdio: "inherit", env: { ...process.env, PYTHONPATH: "pipeline" } }
  );
  process.exit(run.status ?? 1);
}
