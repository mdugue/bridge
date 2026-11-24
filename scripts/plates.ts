/**
 * The compared plates (plan 087, phases 3 and 4; ADR 0018): the QA views
 * (`qa/views/`) rendered for a base commit and for the head by the same
 * browser on the same adapter, and each pair diffed
 * (lib/city/plate-diff.ts). No reference image is stored: the base is
 * built and rendered here, in a worktree under the gitignored `plates/`.
 * It says which views *changed* — never whether a picture is good.
 *
 * Scaffolding: kept while the rewrite series' plans move pixels (plan
 * 087), not a permanent gate.
 *
 * Two tiers over the same code:
 *
 * - **Tier 1**, `SHOTS_SMALL=1`: headless, WebGPU on SwiftShader, 800 × 500,
 *   the `lite` profile (`TIER1_QUERY`), eight views that stand on the
 *   spawn tile (`TIER1_VIEWS`). What .github/workflows/plates.yml runs,
 *   on the label `plates` or by hand.
 * - **Tier 2**, without it: headed on the machine's own GPU, the full
 *   profile at 1600 × 1000 @2×, every view.
 *
 *   bun run plates                       # merge base with origin/main against the head
 *   bun run plates -- --base <ref>       # another base
 *   bun run plates -- --views a,b        # these views only
 *   bun run plates -- --summary <file>   # append the report (Markdown) there
 *   bun run plates -- --no-build         # the head's .next is built already
 *                                        # (with NEXT_PUBLIC_POC_DEBUG=1)
 *
 * Exit 1 when a view differs; 2 on a run that could not be compared — a
 * render failed, a side was not held `still`, a plate is blank.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";
import sharp from "sharp";
import {
  diffImage,
  diffPlates,
  plateBlank,
  plateDiffers,
  TIER1_TOLERANCE,
  TIER2_TOLERANCE,
} from "../lib/city/plate-diff";
import type { Plate, PlateTolerance } from "../lib/city/plate-diff";

const ROOT = process.cwd();
const PLATES_DIR = nodePath.join(ROOT, "plates");
/** The reference site's route: every QA view is a place in it. */
const SITE = "dresden";

/**
 * Tier 1's page: the `lite` profile — the spawn tile alone, a small
 * shadow map, a low pixel ratio, fewer AO samples — which is what makes a
 * SwiftShader frame affordable at all (seconds each while the shadow
 * rings redraw). With the whole site streamed (`&block=1`) a view took
 * three to five minutes to settle in the cloud container (2026-11-16).
 */
export const TIER1_QUERY = "scene=lite";

/**
 * The views tier 1 renders, in this order: eight of the 25 that stand on
 * the spawn tile (`lite` streams no other), chosen to fit a CI job — 25
 * to 55 s a view on SwiftShader, base and head each (plan 087, Findings)
 * — and to cover between them the oblique flight, the street's ground
 * and markings, a picture style, monuments and trees, the night's lamps,
 * the roofs, the water's edge and Modell's parallel camera. Tier 2
 * renders every view.
 */
export const TIER1_VIEWS: readonly string[] = [
  "across-400",
  "shore-eye",
  "street-crossings",
  "street-crossings-comic",
  "fountain-july-day",
  "lamps-july-night",
  "rooftops",
  "modell-night",
];

/** A tier: how its plates are rendered and compared. */
interface Tier {
  name: "tier1" | "tier2";
  env: Record<string, string>;
  /** playwright's extra arguments */
  args: string[];
  tolerance: PlateTolerance;
  views: readonly string[] | null;
}

/** The tier an environment asks for: `SHOTS_SMALL` is tier 1. */
export function tierOf(env: Partial<Record<string, string>>): Tier {
  return env.SHOTS_SMALL
    ? {
        name: "tier1",
        env: { SHOTS_SMALL: "1", SHOTS_QUERY: TIER1_QUERY },
        args: [],
        tolerance: TIER1_TOLERANCE,
        views: TIER1_VIEWS,
      }
    : {
        name: "tier2",
        env: {},
        args: ["--headed"],
        tolerance: TIER2_TOLERANCE,
        views: null,
      };
}

function log(message: string): void {
  process.stderr.write(`plates: ${message}\n`);
}

/** A command's trimmed output; throws with its stderr when it fails. */
function sh(cmd: string, args: string[], cwd = ROOT): string {
  const done = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
  if (done.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")}: ${done.stderr.trim()}`);
  }
  return done.stdout.trim();
}

/** A command with its output passed through; rejects when it fails. */
async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", 2, 2],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} ${args.join(" ")}: exit ${code}`));
      }
    });
  });
}

/** A free port asked of the system. */
async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = server;
  await server.stop(true);
  if (port === undefined) {
    throw new Error("no free port");
  }
  return port;
}

/** Build `dir` with the debug hook: the reference site alone, since the
 *  views are all its own. */
async function build(dir: string): Promise<void> {
  await run("bun", ["run", "build"], {
    cwd: dir,
    env: {
      NEXT_PUBLIC_POC_DEBUG: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      PREPARE_SITES: process.env.PREPARE_SITES ?? SITE,
    },
  });
}

/** `fn` against `dir`'s production server on a port of its own. */
async function served<T>(
  dir: string,
  fn: (port: number) => Promise<T>
): Promise<T> {
  const port = await freePort();
  const server = spawn("bun", ["run", "start", "--", "-p", String(port)], {
    cwd: dir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "ignore", 2],
    detached: true,
  });
  const stop = () => {
    if (server.pid !== undefined) {
      try {
        // the group: `bun run` is the parent of the server itself
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // gone already
      }
    }
  };
  try {
    await waitForServer(port);
    return await fn(port);
  } finally {
    stop();
  }
}

async function waitForServer(port: number): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await Bun.sleep(500);
  }
  throw new Error(`no server on port ${port} after 120 s`);
}

/** What a render wrote beside its plates (e2e/snapshot-shot.spec.ts). */
interface RunInfo {
  adapter: string;
  /** the served build knows the `still` probe (poc-scene.ts) */
  held: boolean;
  ms: Record<string, number>;
  query: string;
  small: boolean;
}

/**
 * The views rendered from the server on `port` into `out`, by the head's
 * harness whichever commit is served: both sides are driven alike.
 */
async function render(
  tier: Tier,
  port: number,
  out: string,
  views: readonly string[] | null
): Promise<RunInfo> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await run(
    "bunx",
    [
      "playwright",
      "test",
      "e2e/snapshot-shot.spec.ts",
      "--reporter=line",
      "--trace=off",
      "--retries=0",
      ...tier.args,
    ],
    {
      env: {
        ...tier.env,
        SHOTS: "1",
        SHOTS_SITE: SITE,
        PLATES_DIR: out,
        PLATES_VIEWS: (views ?? []).join(","),
        PORT: String(port),
      },
    }
  );
  return readRun(out);
}

function readRun(dir: string): RunInfo {
  // reason: written by the harness of this same commit, read back at once
  return JSON.parse(
    readFileSync(nodePath.join(dir, "run.json"), "utf-8")
  ) as RunInfo;
}

async function readPlate(file: string): Promise<Plate> {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    channels: 3,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    height: info.height,
    width: info.width,
  };
}

async function writePlate(file: string, plate: Plate): Promise<void> {
  await sharp(plate.data, {
    raw: { width: plate.width, height: plate.height, channels: plate.channels },
  })
    .png()
    .toFile(file);
}

/** One view of two rendered folders. */
export interface ViewResult {
  differs: boolean;
  /** pixels over the level, their share, the largest channel difference */
  differing: number;
  max: number;
  /** the mean over the pixels of each one's largest channel difference */
  mean: number;
  share: number;
  view: string;
}

/** The plates (`qa-<view>.png`) of a rendered folder, by view. */
function platesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("qa-") && f.endsWith(".png"))
    .map((f) => f.slice(3, -4))
    .toSorted();
}

/**
 * A rendered folder's plates, decoded — and refused when it shows a
 * harness that did not work rather than a city: no plate, a blank one,
 * or two views with the very same pixels (a pose that was not applied
 * draws the view before it). Base and head are driven by one harness, so
 * a comparison alone would find such a pair "the same".
 */
async function readSide(dir: string): Promise<Map<string, Plate>> {
  const views = platesIn(dir);
  if (views.length === 0) {
    throw new Error(`${dir}: no plate was rendered`);
  }
  const plates = new Map<string, Plate>();
  const seen = new Map<string, string>();
  for (const view of views) {
    const plate = await readPlate(nodePath.join(dir, `qa-${view}.png`));
    if (plateBlank(plate)) {
      throw new Error(`${dir}: the plate of ${view} is blank`);
    }
    const digest = createHash("sha256").update(plate.data).digest("hex");
    const twin = seen.get(digest);
    if (twin) {
      throw new Error(
        `${dir}: ${twin} and ${view} are the same picture — a view was not applied`
      );
    }
    seen.set(digest, view);
    plates.set(view, plate);
  }
  return plates;
}

/**
 * Every view of `base` and `head` compared; for a view that differs, its
 * base, head and difference image go to `report` (when given).
 */
export async function compare(
  base: string,
  head: string,
  tolerance: PlateTolerance,
  report: string | null
): Promise<ViewResult[]> {
  const [bases, heads] = [await readSide(base), await readSide(head)];
  const uneven = [...bases.keys(), ...heads.keys()].filter(
    (v) => !(bases.has(v) && heads.has(v))
  );
  if (uneven.length > 0) {
    throw new Error(
      `the two renders do not hold the same views (${uneven.join(", ")})`
    );
  }
  const results: ViewResult[] = [];
  for (const [view, b] of heads) {
    const a = bases.get(view);
    if (!a) {
      // (`uneven` is empty: the base has every view of the head)
      continue;
    }
    const diff = diffPlates(a, b, tolerance.level);
    const differs = plateDiffers(diff, tolerance);
    results.push({
      view,
      differs,
      differing: diff.differing,
      share: diff.share,
      max: diff.max,
      mean: diff.mean,
    });
    if (differs && report) {
      mkdirSync(report, { recursive: true });
      await Promise.all([
        writePlate(nodePath.join(report, `${view}.base.png`), a),
        writePlate(nodePath.join(report, `${view}.head.png`), b),
        writePlate(
          nodePath.join(report, `${view}.diff.png`),
          diffImage(b, diff, tolerance.level)
        ),
      ]);
    }
  }
  return results;
}

const percent = (share: number): string => `${(share * 100).toFixed(3)} %`;

/** The report as Markdown: the verdict, then a row a view. */
export function reportOf(
  results: ViewResult[],
  opts: {
    base: string;
    head: string;
    tier: Tier["name"];
    adapter: string;
    tolerance: PlateTolerance;
  }
): string {
  const differing = results.filter((r) => r.differs).length;
  return [
    `## Plates, ${opts.tier}: ${differing} of ${results.length} views differ`,
    "",
    `\`${opts.base}\` against \`${opts.head}\` on *${opts.adapter}*. A pixel differs above ${opts.tolerance.level} of 255 in a channel; a view differs above ${percent(opts.tolerance.share)} of its pixels, or above ${opts.tolerance.mean} of 255 on average. This says *changed*, never *good* (ADR 0018), and only of the views below; base, head and difference image of each differing view are in \`plates/report/\`.`,
    "",
    "| View | | Pixels over the level | Share | Largest difference | Mean |",
    "|---|---|---:|---:|---:|---:|",
    ...results.map(
      (r) =>
        `| \`${r.view}\` | ${r.differs ? "**differs**" : "same"} | ${r.differing} | ${percent(r.share)} | ${r.max} | ${r.mean.toFixed(3)} |`
    ),
    "",
  ].join("\n");
}

interface Args {
  base: string | null;
  noBuild: boolean;
  summary: string | null;
  views: string[] | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { base: null, noBuild: false, summary: null, views: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") {
      i += 1;
      args.base = argv[i] ?? null;
    } else if (arg === "--views") {
      i += 1;
      args.views = (argv[i] ?? "").split(",").filter(Boolean);
    } else if (arg === "--summary") {
      i += 1;
      args.summary = argv[i] ?? null;
    } else if (arg === "--no-build") {
      args.noBuild = true;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

/**
 * The base commit's plates: built in a worktree (`plates/src/<sha>`,
 * removed once rendered) and rendered. The base bakes into a cache of its
 * own, cold: sharing the head's would hand it whatever the head just
 * baked under a key that misses a changed input.
 */
async function basePlates(
  tier: Tier,
  sha: string,
  views: readonly string[] | null
): Promise<string> {
  const out = nodePath.join(PLATES_DIR, tier.name, sha);
  const src = nodePath.join(PLATES_DIR, "src", sha);
  if (!existsSync(src)) {
    log(`base ${sha.slice(0, 8)}: checking out into ${src}`);
    sh("git", ["worktree", "add", "--detach", "--force", src, sha]);
  }
  await run("bun", ["install", "--frozen-lockfile"], { cwd: src });
  log(`base ${sha.slice(0, 8)}: building`);
  await build(src);
  await served(src, async (port) => await render(tier, port, out, views));
  // its plates are kept; the checkout (a gigabyte of data) is not
  sh("git", ["worktree", "remove", "--force", src]);
  return out;
}

/** The base against the head: the report, and whether a view differs. */
async function comparePlates(args: Args, tier: Tier): Promise<number> {
  const headSha = sh("git", ["rev-parse", "HEAD"]);
  const dirty = sh("git", ["status", "--porcelain", "--untracked-files=no"]);
  const baseSha = sh("git", [
    "rev-parse",
    args.base ?? sh("git", ["merge-base", "HEAD", "origin/main"]),
  ]);
  const report = nodePath.join(PLATES_DIR, "report");
  rmSync(report, { recursive: true, force: true });
  if (!args.noBuild) {
    log("head: building");
    await build(ROOT);
  }
  const views = args.views ?? tier.views;
  const head = nodePath.join(PLATES_DIR, tier.name, "head");
  const headRun = await served(
    ROOT,
    async (port) => await render(tier, port, head, views)
  );
  const base = await basePlates(tier, baseSha, views);
  // each side held `still`, or the comparison reports the weather
  if (!(headRun.held && readRun(base).held)) {
    throw new Error(
      "a side was not held still: its build does not know the `still` probe (poc-scene.ts)"
    );
  }
  const results = await compare(base, head, tier.tolerance, report);
  const markdown = reportOf(results, {
    base: baseSha.slice(0, 8),
    head: `${headSha.slice(0, 8)}${dirty ? "+changes" : ""}`,
    tier: tier.name,
    adapter: headRun.adapter,
    tolerance: tier.tolerance,
  });
  mkdirSync(report, { recursive: true });
  writeFileSync(nodePath.join(report, "report.md"), markdown);
  process.stdout.write(markdown);
  if (args.summary) {
    appendFileSync(args.summary, markdown);
  }
  return results.some((r) => r.differs) ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await comparePlates(
      parseArgs(process.argv.slice(2)),
      tierOf(process.env)
    );
  } catch (error) {
    // a run that could not be compared: 2, never 0
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
