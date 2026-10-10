/**
 * How prepare-sites.ts spreads a cold build over the machine. Every bake is
 * a prepare-data.ts process, and single-threaded, so the sites run side by
 * side; a site with more tiles than `WARM_ABOVE` is split further:
 * prepare-data.ts runs as **warmers** that only fill the bake cache for one
 * of its tiles, before one plain run finds everything cached and publishes.
 *
 *  1. `--warm-ground=<first tile>` alone: the site-wide values every later
 *     process reads (the frame, the line levels) and that tile's fine ground;
 *  2. `--warm-ground=<tile>` for each other tile: its fine ground, which
 *     every fine level's walls, kerbs, stairs and fences stand on;
 *  3. `--warm=<tile>` for every tile: its buildings and both terrain levels,
 *     on the grounds step 2 cached;
 *  4. the plain run: all cache hits; it publishes.
 *
 * Each step waits for the one before it; a warmer publishes nothing. One
 * tile per warmer: a process's memory grows with every tile it bakes (a
 * cold Dresden in one process peaked at 4.3 GiB, its heaviest tile alone at
 * 2.7 GB), and a free slot takes the next tile, so a slot that frees late
 * still finds work.
 */

/** A site with more tiles than this is baked by warmers. */
export const WARM_ABOVE = 4;

const WARM_GROUND = "--warm-ground=";
const WARM_TILES = "--warm=";

/** What one prepare-data.ts run does. */
export type BakeMode =
  | { kind: "publish" }
  | { kind: "ground"; tiles: string[] }
  | { kind: "tiles"; tiles: string[] };

/** The mode prepare-data.ts's arguments after the site id name. */
export function bakeMode(
  args: readonly string[],
  siteTiles: readonly string[]
): BakeMode {
  if (args.length === 0) {
    return { kind: "publish" };
  }
  const [arg] = args;
  const kind = arg.startsWith(WARM_GROUND)
    ? "ground"
    : arg.startsWith(WARM_TILES)
      ? "tiles"
      : null;
  if (args.length > 1 || kind === null) {
    throw new Error(
      `unknown arguments "${args.join(" ")}"; a warmer takes one ${WARM_GROUND}<tile>,… or ${WARM_TILES}<tile>,…`
    );
  }
  const tiles = arg.slice(arg.indexOf("=") + 1).split(",");
  const unknown = tiles.filter((t) => !siteTiles.includes(t));
  if (unknown.length > 0) {
    throw new Error(`not tiles of the site: ${unknown.join(", ")}`);
  }
  return { kind, tiles };
}
