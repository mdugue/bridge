/**
 * Runs the offline bakes for the site (pipeline/, Python in its own uv
 * environment): provider downloads → the per-tile artifacts under data/.
 *
 *   bun run bake                      every tile, every step
 *   bun run bake 33412_5656_2_sn      one tile
 *   bun run bake --ingest             fetch the raw inputs first (the site's
 *                                     ingest adapter, e.g. GeoSN for Saxony)
 *   bun run bake --step canopy        one step (landcover, canopy, trees,
 *                                     ndvi, roof-colour, osm-buildings,
 *                                     lamps, monuments,
 *                                     furniture, walls, stairs, rail,
 *                                     surface, edges, markings, sport,
 *                                     cultivated, tram, riverside, names,
 *                                     skyview, soundmarks, lowveg, small-buildings,
 *                                     islands)
 *   bun run bake --ingest --lsc       ... and the laser scan (≈380 MB a tile)
 *   bun run bake --step lowveg --research   also every hedge/shrub candidate
 *
 * The site (SITE, default dresden; sites/) supplies the tiles, their extent
 * and CRS; raw inputs live in data/_raw/<site>/ (gitignored). The steps run
 * in dependency order — land cover first, the canopy, the tree cadastre,
 * lamps and street furniture are gated on it; the hedges and scan trees
 * last (they are thinned against the canopy and the cadastre). Then `bun scripts/prepare-data.ts` turns data/ into the tileset.
 */
import { spawnSync } from "node:child_process";
import { tileExtentOf, tileIdOf } from "../lib/city/site";
import { currentSite } from "../sites";

const SITE = currentSite();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const wanted = new Set(args.filter((a) => /^\d+_\d+/u.test(a)));
const step = option("--step") ?? "all";
const raw = `data/_raw/${SITE.id}`;

function python(module: string, rest: string[]): void {
  const run = spawnSync(
    "uv",
    ["run", "--project", "pipeline", "python", "-m", module, ...rest],
    { stdio: "inherit", env: { ...process.env, PYTHONPATH: "pipeline" } }
  );
  if (run.status !== 0) {
    process.stderr.write(`bake: ${module} ${rest[0]} failed\n`);
    process.exit(run.status ?? 1);
  }
}

for (const cell of SITE.tiles) {
  const tile = tileIdOf(SITE, cell);
  if (wanted.size > 0 && !wanted.has(tile)) {
    continue;
  }
  const bounds = tileExtentOf(SITE, cell).map(String);
  if (flag("--ingest")) {
    python(`bake.ingest_${SITE.ingest}`, [
      "--raw",
      raw,
      "--tile",
      tile,
      "--bounds",
      ...bounds,
      ...(flag("--lsc") ? ["--lsc"] : []),
    ]);
  }
  python("bake", [
    step,
    "--tile",
    tile,
    "--bounds",
    ...bounds,
    "--epsg",
    String(SITE.epsg),
    "--raw",
    raw,
    "--data",
    "data",
    ...(flag("--research") ? ["--research"] : []),
  ]);
}
