/**
 * A tile's two dressing files (scripts/bake-dressing.ts,
 * bake-entries.ts `dressing`): published with the terrain, which names
 * them on its levels. Keyed on the trees' sources and on the fine ground
 * they stand on — the tile's DGM and what shapes it — so a change of
 * either re-bakes them.
 */
import { existsSync } from "node:fs";
import { tileExtentOf } from "../../lib/city/site";
import type { TerrainBounds } from "../../lib/city/terrain-geometry";
import { tileArtifacts } from "../../lib/city/tile";
import { BAKE_ENTRIES } from "../bake-entries";
import { bakeDressing } from "../bake-dressing";
import { treeSourcePaths } from "../dressing-sources";
import { SITE, TILES, cacheKey, cached, gz, publish } from "./context";
import { offset } from "./frame";

/** The fine level's ground of a tile, shaped (prepare/terrain.ts). */
type FineGround = () => Promise<{
  bounds: TerrainBounds;
  heightAt: (x: number, y: number) => number | null;
}>;

const published = new Map<
  string,
  Promise<{ dressing: string; dressingCoarse: string }>
>();

/**
 * Publishes `tile`'s dressing files, once: the fine level's and the
 * coarse level's, by their artifact kinds. `keyed` is what the tile's
 * fine ground is keyed on beside its sources (`inputs`).
 */
export async function publishDressing(
  tile: string,
  fine: FineGround,
  inputs: readonly string[],
  keyed: string
): Promise<{ dressing: string; dressingCoarse: string }> {
  let files = published.get(tile);
  if (!files) {
    files = bake(tile, fine, inputs, keyed);
    published.set(tile, files);
  }
  return await files;
}

async function bake(
  tile: string,
  fine: FineGround,
  inputs: readonly string[],
  keyed: string
): Promise<{ dressing: string; dressingCoarse: string }> {
  const artifacts = tileArtifacts(tile);
  const sources = Object.values(
    treeSourcePaths(SITE, tile, process.cwd())
  ).filter((path) => existsSync(path));
  const key = cacheKey(
    [...sources, ...inputs],
    BAKE_ENTRIES.dressing,
    offset,
    keyed
  );
  const [minX, minY] = tileExtentOf(SITE.tiles[TILES.indexOf(tile)]);
  let baking: ReturnType<typeof bakeDressing> | null = null;
  const baked = async () => {
    baking ??= (async () => {
      const ground = await fine();
      return await bakeDressing(SITE, tile, process.cwd(), {
        bounds: ground.bounds,
        heightAt: ground.heightAt,
        offset,
        origin: [minX, minY],
      });
    })();
    return await baking;
  };
  const dressing = await cached(artifacts.dressing.file, key, async () => {
    const files = await baked();
    return gz(files.fine);
  });
  const coarse = await cached(artifacts.dressingCoarse.file, key, async () => {
    const files = await baked();
    return gz(files.coarse);
  });
  return {
    dressing: publish(artifacts.dressing.file, dressing),
    dressingCoarse: publish(artifacts.dressingCoarse.file, coarse),
  };
}
