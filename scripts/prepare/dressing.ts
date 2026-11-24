/**
 * A tile's two tree files (scripts/bake-trees.ts, bake-entries.ts
 * `dressing`): published with the terrain, which names them on its levels.
 * Keyed on the trees' sources and on the fine ground they stand on — the
 * tile's DGM and what shapes it — so a change of either re-bakes them.
 */
import { tileExtentOf } from "../../lib/city/site";
import { tileArtifacts } from "../../lib/city/tile";
import { BAKE_ENTRIES } from "../bake-entries";
import { packTrees, standTrees, treeSources } from "../bake-trees";
import type { TreeGround } from "../bake-trees";
import { SITE, TILES, cacheKey, cached, gz, publish } from "./context";
import { offset } from "./frame";

type Published = Promise<{ dressing: string; dressingCoarse: string }>;
const published = new Map<string, Published>();

/**
 * Publishes `tile`'s tree files, once: the fine level's and the coarse
 * level's. `fine` is the tile's shaped fine ground; `keyed` what that
 * ground is keyed on beside its sources (`inputs`).
 */
export async function publishDressing(
  tile: string,
  fine: () => Promise<Pick<TreeGround, "bounds" | "heightAt">>,
  inputs: readonly string[],
  keyed: string
): Published {
  const memo = published.get(tile);
  if (memo) {
    return await memo;
  }
  const sources = treeSources(SITE, tile, process.cwd());
  const key = cacheKey(
    [...Object.values(sources).filter((p) => p !== undefined), ...inputs],
    BAKE_ENTRIES.dressing,
    offset,
    keyed
  );
  const origin = tileExtentOf(SITE.tiles[TILES.indexOf(tile)]).slice(0, 2) as [
    number,
    number,
  ];
  let baking: Promise<ReturnType<typeof packTrees>> | undefined;
  const level = async (kind: "dressing" | "dressingCoarse") => {
    const { file } = tileArtifacts(tile)[kind];
    const bytes = await cached(file, key, async () => {
      baking ??= fine().then(async (ground) =>
        packTrees(
          await standTrees(sources, { ...ground, offset, origin }),
          origin
        )
      );
      const files = await baking;
      return gz(kind === "dressing" ? files.fine : files.coarse);
    });
    return publish(file, bytes);
  };
  const files = Promise.all([level("dressing"), level("dressingCoarse")]).then(
    ([dressing, dressingCoarse]) => ({ dressing, dressingCoarse })
  );
  published.set(tile, files);
  return await files;
}
