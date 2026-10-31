/**
 * How prepare-sites.ts spreads a cold build over the machine. Every bake is
 * a prepare-data.ts process, and single-threaded, so a cold build runs
 * several side by side — as many at once as the cores allow and their
 * peaks fit in the memory. A site is baked by **warmers**, prepare-data.ts
 * runs that only fill the bake cache for one of its tiles, before one plain
 * run finds everything cached and publishes:
 *
 *  0. the plain run with `--if-cached`: when every entry is cached it
 *     publishes, and that is all (a warm build runs no warmer); at the
 *     first entry it would bake it stops (`NOT_CACHED`), and the warmers
 *     follow;
 *  1. `--warm-ground=<first tile>` alone, in step 0's slot: the site-wide
 *     values every later process reads (the frame, the line levels) and
 *     that tile's fine ground — everything else waits for it;
 *  2. `--warm-ground=<tile>` for each other tile: its fine ground, which
 *     every fine level's walls, kerbs, stairs and fences stand on;
 *  3. `--warm=<tile>` for every tile: its buildings and both terrain levels,
 *     on the grounds step 2 cached;
 *  4. the plain run: all cache hits; it publishes.
 *
 * Each step waits for the one before it; a warmer publishes nothing. One
 * tile per warmer: a process's memory grows with every tile it bakes, and
 * a whole cold site in one process peaks near twice its heaviest tile
 * (München 4.47 GiB, its heaviest tile alone 2.4), so Vercel's 4-core,
 * 8.6 GB builder holds one cold site at a time but two tiles; and a free
 * slot takes the next tile, so a slot that frees late still finds work.
 *
 * Measured cold on 2026-10-31, all seven sites on a box held to Vercel's
 * builder (4 cores, `PREPARE_MEMORY_GB=8.6`): one process per site, one
 * cold site at a time, 11:07 min; the warmers, two tiles at once, 5:19.
 * `PREPARE_WARMERS=0` bakes every site in one process (counted at
 * `SITE_PEAK`), as before 2026-10-31. Until then the warmers were opt-in,
 * for Dresden alone: on 2026-10-10 two cold sites still fitted side by
 * side, the parallelism two tile warmers give, and they showed no gain.
 */

const WARM_GROUND = "--warm-ground=";
const WARM_TILES = "--warm=";
const IF_CACHED = "--if-cached";
/** prepare-data.ts's exit code when `--if-cached` met an entry not cached. */
export const NOT_CACHED = 3;

/** What one prepare-data.ts run does. */
export type BakeMode =
  | { kind: "publish"; ifCached: boolean }
  | { kind: "ground"; tiles: string[] }
  | { kind: "tiles"; tiles: string[] };

/** The mode prepare-data.ts's arguments after the site id name. */
export function bakeMode(
  args: readonly string[],
  siteTiles: readonly string[]
): BakeMode {
  if (args.length === 0 || (args.length === 1 && args[0] === IF_CACHED)) {
    return { kind: "publish", ifCached: args.length === 1 };
  }
  const [arg] = args;
  const kind = arg.startsWith(WARM_GROUND)
    ? "ground"
    : arg.startsWith(WARM_TILES)
      ? "tiles"
      : null;
  if (args.length > 1 || kind === null) {
    throw new Error(
      `unknown arguments "${args.join(" ")}"; a warmer takes one ${WARM_GROUND}<tile>,… or ${WARM_TILES}<tile>,…, a plain run ${IF_CACHED}`
    );
  }
  const tiles = arg.slice(arg.indexOf("=") + 1).split(",");
  const unknown = tiles.filter((t) => !siteTiles.includes(t));
  if (unknown.length > 0) {
    throw new Error(`not tiles of the site: ${unknown.join(", ")}`);
  }
  return { kind, tiles };
}

/**
 * The most resident memory one bake process reaches, with a margin: a tile
 * warmer's is its buildings' — measured cold on 2026-10-31 (Bun 1.4.4),
 * München's heaviest tile, 32690_5334, 2.40 GiB (2.58 GB), the others
 * 0.4–2.2 GiB; Vercel's Bun 1.3.14 took about 15 % more for a whole site,
 * which puts that tile near 2.96 GB there. Two at once still fit Vercel's
 * 8.6 GB builder (80 %: 6.9 GB), four CI's 16.8 GB runner. Every other
 * process stays under `PROCESS_PEAK` (a ground warmer 0.6 GiB at most, a
 * site's publishing run 1.12 GiB — Dresden's —, a small site's plain run).
 */
export const TILE_PEAK = 3.2e9;
export const PROCESS_PEAK = 1.6e9;
/**
 * A whole site baked cold in one process, as every site is baked without
 * the warmers. Measured cold on 2026-10-25 (Bun 1.4.4): München 4.42 GiB
 * (4.75 GB, on main as on a branch), Leipzig 3.95 GiB, Dresden 3.6–5.7
 * GiB, the small sites near 2 GiB. Counted at 3 GB, Vercel's 4-core,
 * 8.6 GB builder baked two of them at once, and a build that re-baked
 * every site's buildings (a change to a module every city bake imports)
 * was killed there for its memory, München beside Dresden, twice. So a site
 * is first asked whether it is cached (`--if-cached`, at `PROCESS_PEAK`: a
 * warm site publishes and is done), and only a site that bakes is counted
 * at this: one at a time on Vercel's builder, beside the warm sites'
 * runs; two on CI's 16.8 GB runner. München had grown to 6.1 GiB by
 * 2026-10-31 (garbage the buildings' appends left), 4.47 GiB since
 * bake-city-mesh.ts collects after each.
 */
export const SITE_PEAK = 4.8e9;
/** The share of the machine's memory the bakes may hold together. */
export const MEMORY_SHARE = 0.8;

/** One prepare-data.ts run: its arguments after the site id, and the peak
 *  it is admitted with. */
export interface BakeRun {
  args: string[];
  peak: number;
}

/** Step 0: the plain run, if every entry is cached. */
export const IF_CACHED_RUN: BakeRun = { args: [IF_CACHED], peak: PROCESS_PEAK };

/** A cold site's bake after step 0, step by step; a step's runs may go
 *  side by side. */
export function warmSteps(tiles: readonly string[]): BakeRun[][] {
  const [first, ...rest] = tiles;
  const ground = (tile: string) => ({
    args: [`${WARM_GROUND}${tile}`],
    peak: PROCESS_PEAK,
  });
  return [
    [ground(first)],
    ...(rest.length > 0 ? [rest.map(ground)] : []),
    tiles.map((tile) => ({ args: [`${WARM_TILES}${tile}`], peak: TILE_PEAK })),
    [{ args: [], peak: PROCESS_PEAK }],
  ];
}

/** Whether the warmers bake the sites: on unless `PREPARE_WARMERS=0`
 *  (see the module's comment). */
export function warmersOn(env: { PREPARE_WARMERS?: string }): boolean {
  const value = env.PREPARE_WARMERS ?? "";
  if (value !== "" && value !== "0" && value !== "1") {
    throw new Error(`PREPARE_WARMERS must be 0 or 1, got "${value}"`);
  }
  return value !== "0";
}

/** A number above 0 from an environment override (PREPARE_JOBS: a whole
 *  one), or undefined when it is not set. */
function overridden(
  name: string,
  value: string | undefined
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  if (!(n > 0) || (name === "PREPARE_JOBS" && !Number.isInteger(n))) {
    throw new Error(`${name} must be a number above 0, got "${value}"`);
  }
  return n;
}

/**
 * What the bakes may take together: `jobs` processes at once (the cores,
 * or PREPARE_JOBS) and `memory` bytes of their peaks (`MEMORY_SHARE` of the
 * machine's memory, or of PREPARE_MEMORY_GB gigabytes).
 */
export function bakeLimits(opts: {
  cores: number;
  memory: number;
  env?: { PREPARE_JOBS?: string; PREPARE_MEMORY_GB?: string };
}): { jobs: number; memory: number } {
  const { cores, env = {} } = opts;
  const jobs = overridden("PREPARE_JOBS", env.PREPARE_JOBS) ?? cores;
  const gb = overridden("PREPARE_MEMORY_GB", env.PREPARE_MEMORY_GB);
  return {
    jobs,
    memory: MEMORY_SHARE * (gb === undefined ? opts.memory : gb * 1e9),
  };
}

/**
 * Runs tasks within `limits`: at most `jobs` at once, their peaks together
 * within `memory` (a task alone always runs). The waiting go by `priority`
 * (lower first), then in the order they asked; one that does not fit yet
 * holds back the ones behind it, so a heavy task is never passed over for
 * good.
 */
export function createSlots(limits: { jobs: number; memory: number }): {
  run: <T>(
    priority: number,
    peak: number,
    task: () => Promise<T>
  ) => Promise<T>;
} {
  let running = 0;
  let held = 0;
  const waiting: { peak: number; priority: number; start: () => void }[] = [];
  const admit = () => {
    for (let next = waiting[0]; next; next = waiting[0]) {
      const fits =
        running === 0 ||
        (running < limits.jobs && held + next.peak <= limits.memory);
      if (!fits) {
        return;
      }
      waiting.shift();
      running++;
      held += next.peak;
      next.start();
    }
  };
  return {
    run: async (priority, peak, task) => {
      await new Promise<void>((start) => {
        const at = waiting.findIndex((w) => w.priority > priority);
        waiting.splice(at < 0 ? waiting.length : at, 0, {
          peak,
          priority,
          start,
        });
        admit();
      });
      try {
        return await task();
      } finally {
        running--;
        held -= peak;
        admit();
      }
    },
  };
}
