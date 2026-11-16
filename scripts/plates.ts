/**
 * The compared plates (plan 087, phases 3 and 4; ADR 0018): the QA views
 * (`qa/views/`) rendered for a base commit and for the head by the same
 * browser on the same adapter, and each pair diffed
 * (lib/city/plate-diff.ts). No reference image is stored: the base is
 * built and rendered here, in a worktree under the gitignored `plates/`,
 * and its plates are kept there under the tier and the commit. It says
 * which views *changed* — never whether a picture is good.
 *
 * Two tiers over the same code:
 *
 * - **Tier 1**, `SHOTS_SMALL=1`: headless, WebGPU on SwiftShader, 800 × 500,
 *   the `lite` profile (`TIER1_QUERY`), eight views that stand on the
 *   spawn tile (`TIER1_VIEWS`). What CI runs
 *   (.github/workflows/plates.yml).
 * - **Tier 2**, without it: headed on the machine's own GPU, the full
 *   profile at 1600 × 1000 @2×, every view.
 *
 *   bun run plates                       # merge base with origin/main against the head
 *   bun run plates -- --base <ref>       # another base
 *   bun run plates -- --views a,b        # these views only
 *   bun run plates -- --claims-change    # report differing views, exit 0
 *                                        # (a PR with a `## Snapshots` section)
 *   bun run plates -- --summary <file>   # append the report (Markdown) there
 *   bun run plates -- --no-build         # the head's .next is built already
 *                                        # (with NEXT_PUBLIC_POC_DEBUG=1)
 *   bun run plates -- pairs <n>          # the noise floor: n + 1 renders of the
 *                                        # head, n same-commit pairs
 *   bun run plates -- diff <a> <b>       # two rendered folders compared
 *
 * Exit 1 when a view differs (unless `--claims-change`), 2 on a run that
 * could not be compared.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";
import sharp from "sharp";
import {
  diffImage,
  diffPlates,
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

function tierOf(env: NodeJS.ProcessEnv): Tier {
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
 * Every view of `base` and `head` compared; for a view that differs, its
 * base, head and difference image go to `report` (when given).
 */
export async function compare(
  base: string,
  head: string,
  tolerance: PlateTolerance,
  report: string | null
): Promise<ViewResult[]> {
  const views = platesIn(head);
  const missing = platesIn(base).filter((v) => !views.includes(v));
  if (missing.length > 0 || views.length === 0) {
    throw new Error(
      `the two renders do not hold the same views (${missing.join(", ") || "none rendered"})`
    );
  }
  const results: ViewResult[] = [];
  for (const view of views) {
    const file = `qa-${view}.png`;
    const [a, b] = await Promise.all([
      readPlate(nodePath.join(base, file)),
      readPlate(nodePath.join(head, file)),
    ]);
    const diff = diffPlates(a, b, tolerance.level);
    const differs = plateDiffers(diff, tolerance.share);
    results.push({
      view,
      differs,
      differing: diff.differing,
      share: diff.share,
      max: diff.max,
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
    claimsChange: boolean;
    seconds?: number;
  }
): string {
  const differing = results.filter((r) => r.differs);
  let verdict = "the picture is the same.";
  if (differing.length > 0) {
    verdict = opts.claimsChange
      ? "the PR claims a visible change (`## Snapshots`): reported, not failed. List these views under that section."
      : "the PR claims none (no `## Snapshots` section): **failed**. Name the change there, or find what moved.";
  }
  const lines = [
    `## Plates, ${opts.tier}: ${differing.length} of ${results.length} views differ`,
    "",
    `\`${opts.base}\` against \`${opts.head}\` on *${opts.adapter}* — ${verdict}`,
    "",
    `A pixel differs above ${opts.tolerance.level} of 255 in a channel, a view above ${percent(opts.tolerance.share)} of its pixels. This says *changed*, never *good* (ADR 0018).${
      opts.seconds === undefined
        ? ""
        : ` Rendered and compared in ${Math.round(opts.seconds)} s.`
    }`,
    "",
    "| View | | Pixels over the level | Share | Largest difference |",
    "|---|---|---:|---:|---:|",
    ...results.map(
      (r) =>
        `| \`${r.view}\` | ${r.differs ? "**differs**" : "same"} | ${r.differing} | ${percent(r.share)} | ${r.max} |`
    ),
    "",
  ];
  if (differing.length > 0) {
    lines.push(
      "Base, head and difference image of each differing view: the run's `plates-report` artifact (`plates/report/`).",
      ""
    );
  }
  return lines.join("\n");
}

interface Args {
  base: string | null;
  claimsChange: boolean;
  command: "compare" | "diff" | "pairs";
  noBuild: boolean;
  rest: string[];
  summary: string | null;
  views: string[] | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    base: null,
    claimsChange: false,
    command: "compare",
    noBuild: false,
    rest: [],
    summary: null,
    views: null,
  };
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
    } else if (arg === "--claims-change") {
      args.claimsChange = true;
    } else if (arg === "--no-build") {
      args.noBuild = true;
    } else if (arg === "pairs" || arg === "diff") {
      args.command = arg;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      args.rest.push(arg);
    }
  }
  return args;
}

/**
 * The base commit's plates: from `plates/<tier>/<sha>/` when this machine
 * rendered them before with the same adapter and views, else built in a
 * worktree (`plates/src/<sha>`, with the head's bake cache) and rendered.
 */
async function basePlates(
  tier: Tier,
  sha: string,
  views: readonly string[] | null,
  headRun: RunInfo
): Promise<string> {
  const out = nodePath.join(PLATES_DIR, tier.name, sha);
  if (existsSync(nodePath.join(out, "run.json"))) {
    const kept = readRun(out);
    const wanted =
      views ?? platesIn(nodePath.join(PLATES_DIR, tier.name, "head"));
    if (
      kept.adapter === headRun.adapter &&
      wanted.every((v) => existsSync(nodePath.join(out, `qa-${v}.png`)))
    ) {
      log(`base ${sha.slice(0, 8)}: plates kept from an earlier run`);
      return out;
    }
  }
  const src = nodePath.join(PLATES_DIR, "src", sha);
  if (!existsSync(src)) {
    log(`base ${sha.slice(0, 8)}: checking out into ${src}`);
    sh("git", ["worktree", "add", "--detach", "--force", src, sha]);
  }
  await run("bun", ["install", "--frozen-lockfile"], { cwd: src });
  // Any earlier bake cache is a sound start (every artifact is keyed by
  // its inputs): the base bakes only what differs from the head.
  const cache = nodePath.join(ROOT, ".cache");
  if (existsSync(cache) && !existsSync(nodePath.join(src, ".cache"))) {
    symlinkSync(cache, nodePath.join(src, ".cache"));
  }
  log(`base ${sha.slice(0, 8)}: building`);
  await build(src);
  await served(src, async (port) => await render(tier, port, out, views));
  return out;
}

async function comparePlates(args: Args, tier: Tier): Promise<number> {
  const started = Date.now();
  const views = args.views ?? tier.views;
  const headSha = sh("git", ["rev-parse", "HEAD"]);
  const baseSha = sh("git", [
    "rev-parse",
    args.base ?? sh("git", ["merge-base", "HEAD", "origin/main"]),
  ]);
  const dirty = sh("git", ["status", "--porcelain", "--untracked-files=no"]);
  const headName = `${headSha.slice(0, 8)}${dirty ? "+changes" : ""}`;
  if (!args.noBuild) {
    log(`head ${headName}: building`);
    await build(ROOT);
  }
  const head = nodePath.join(PLATES_DIR, tier.name, "head");
  const headRun = await served(
    ROOT,
    async (port) => await render(tier, port, head, views)
  );
  const base = await basePlates(tier, baseSha, views, headRun);
  const report = nodePath.join(PLATES_DIR, "report");
  rmSync(report, { recursive: true, force: true });
  mkdirSync(report, { recursive: true });
  const say = (markdown: string) => {
    writeFileSync(nodePath.join(report, "report.md"), markdown);
    process.stdout.write(markdown);
    if (args.summary) {
      appendFileSync(args.summary, markdown);
    }
  };
  // A base from before the `still` probe (plan 087) cannot be held: its
  // clouds drift and its crowns sway between any two renders, so a
  // comparison with it would report the weather.
  if (!readRun(base).held) {
    say(
      `## Plates, ${tier.name}: not compared\n\nThe base \`${baseSha.slice(0, 8)}\` predates the \`still\` probe (plan 087): its plates cannot be held still, so nothing was compared. Its plates and the head's are in \`plates/${tier.name}/\`.\n`
    );
    return 0;
  }
  const results = await compare(base, head, tier.tolerance, report);
  const markdown = reportOf(results, {
    base: baseSha.slice(0, 8),
    head: headName,
    tier: tier.name,
    adapter: headRun.adapter,
    tolerance: tier.tolerance,
    claimsChange: args.claimsChange,
    seconds: (Date.now() - started) / 1000,
  });
  say(markdown);
  const differs = results.some((r) => r.differs);
  return differs && !args.claimsChange ? 1 : 0;
}

/**
 * The noise floor: the head rendered `n + 1` times from one server, each
 * render a page of its own, and every pair of consecutive renders
 * compared. Prints, per view, the worst pair.
 */
async function pairs(args: Args, tier: Tier): Promise<number> {
  const n = Number(args.rest[0] ?? 10);
  const views = args.views ?? tier.views;
  if (!args.noBuild) {
    await build(ROOT);
  }
  const dir = (i: number) => nodePath.join(PLATES_DIR, tier.name, `pair-${i}`);
  const worst = new Map<string, ViewResult>();
  let differing = 0;
  const seconds: number[] = [];
  let adapter = "";
  await served(ROOT, async (port) => {
    for (let i = 0; i <= n; i += 1) {
      const started = Date.now();
      ({ adapter } = await render(tier, port, dir(i), views));
      seconds.push((Date.now() - started) / 1000);
      if (i === 0) {
        continue;
      }
      const results = await compare(
        dir(i - 1),
        dir(i),
        tier.tolerance,
        nodePath.join(PLATES_DIR, "report", `pair-${i}`)
      );
      for (const r of results) {
        differing += r.differs ? 1 : 0;
        const w = worst.get(r.view);
        if (!w || r.max > w.max || r.differing > w.differing) {
          worst.set(r.view, {
            ...r,
            max: Math.max(r.max, w?.max ?? 0),
            differing: Math.max(r.differing, w?.differing ?? 0),
            share: Math.max(r.share, w?.share ?? 0),
            differs: r.differs || (w?.differs ?? false),
          });
        }
      }
      log(
        `pair ${i} of ${n}: ${results.filter((r) => r.differs).length} views differ`
      );
    }
  });
  const markdown = [
    `## Noise floor, ${tier.name}: ${n} same-commit pairs on *${adapter}*`,
    "",
    `${differing} differing views in ${n} pairs of ${worst.size} views; a render took ${Math.round(Math.min(...seconds))}–${Math.round(Math.max(...seconds))} s.`,
    "",
    "| View | Worst pair: pixels over the level | Share | Largest difference |",
    "|---|---:|---:|---:|",
    ...[...worst.values()].map(
      (r) =>
        `| \`${r.view}\` | ${r.differing} | ${percent(r.share)} | ${r.max} |`
    ),
    "",
  ].join("\n");
  process.stdout.write(markdown);
  if (args.summary) {
    appendFileSync(args.summary, markdown);
  }
  return differing > 0 ? 1 : 0;
}

async function diffFolders(args: Args, tier: Tier): Promise<number> {
  const [a, b] = args.rest;
  if (!(a && b)) {
    throw new Error("diff takes two rendered folders");
  }
  const report = nodePath.join(PLATES_DIR, "report");
  const results = await compare(a, b, tier.tolerance, report);
  process.stdout.write(
    reportOf(results, {
      base: a,
      head: b,
      tier: tier.name,
      adapter: readRun(b).adapter,
      tolerance: tier.tolerance,
      claimsChange: args.claimsChange,
    })
  );
  return results.some((r) => r.differs) && !args.claimsChange ? 1 : 0;
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const tier = tierOf(process.env);
    const commands = { compare: comparePlates, diff: diffFolders, pairs };
    process.exitCode = await commands[args.command](args, tier);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
