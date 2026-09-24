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
 *   bun run bake --step canopy        one step (landcover, canopy, ndvi,
 *                                     roof-colour, lamps, walls, rail)
 *
 * The site config (sites/) becomes one JSON spec (pipeline/bake/spec.py), so
 * Python never re-derives tiles, extents or products. Then `bun dev` /
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
    raw: providerRawDir(site),
    data: siteDataDir(site),
    osm: osmExtractUrl(site),
    tiles: site.tiles.map((cell) => ({
      id: tileIdOf(site, cell),
      bounds: tileExtentOf(cell),
    })),
  };
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "fetch" && command !== "bake") {
    process.stderr.write("usage: bun scripts/pipeline.ts fetch|bake [tile…]\n");
    process.exit(2);
  }
  const site = currentSite();
  const step = args.indexOf("--step");
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--step");
  if (unknown.length > 0) {
    process.stderr.write(`${command}: unknown option ${unknown.join(" ")}\n`);
    process.exit(2);
  }
  if (step >= 0 && command === "fetch") {
    process.stderr.write("fetch: --step is a bake option\n");
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
    ],
    { stdio: "inherit", env: { ...process.env, PYTHONPATH: "pipeline" } }
  );
  process.exit(run.status ?? 1);
}
