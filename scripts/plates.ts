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
 *   bun run plates -- --claims a,b       # these views are meant to differ:
 *                                        # reported, not failed
 *   bun run plates -- --claims-file <f>  # the same, read from a PR's
 *                                        # description: the views named
 *                                        # under its `## Snapshots`
 *   bun run plates -- --summary <file>   # append the report (Markdown) there
 *   bun run plates -- --no-build         # the head's .next is built already
 *                                        # (with NEXT_PUBLIC_POC_DEBUG=1)
 *   bun run plates -- pairs <n>          # the noise floor: n + 1 renders of the
 *                                        # head, n same-commit pairs
 *   bun run plates -- diff <a> <b>       # two rendered folders compared
 *
 * Exit 1 when a view differs that no claim names; 2 on a run that could
 * not be compared — a render failed, a side was not held `still`, a
 * plate is blank. The one exception is a base from before the plates
 * existed, which cannot be held: reported as not compared, exit 0.
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
  /** what rendered it: the harness's files, the views', the tier's page
   *  (`harnessKey`); written here, after the render */
  harness?: string;
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
  const info = { ...readRun(out), harness: harnessKey(tier, views) };
  writeFileSync(
    nodePath.join(out, "run.json"),
    `${JSON.stringify(info, null, 2)}\n`
  );
  return info;
}

/** The files that decide how a plate is taken, beside the build served. */
const HARNESS_FILES = [
  "e2e/snapshot-shot.spec.ts",
  "e2e/swiftshader-webgpu.ts",
  "playwright.config.ts",
];

/**
 * What a render was taken with: the harness's files, the views' own
 * (all of them, when none is named) and the tier's page. Kept base
 * plates are only used again by a render that would take them the same
 * way.
 */
function harnessKey(tier: Tier, views: readonly string[] | null): string {
  const hash = createHash("sha256");
  const viewFiles = (
    views ??
    readdirSync(nodePath.join(ROOT, "qa", "views"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .toSorted()
  ).map((v) => `qa/views/${v}.json`);
  for (const file of [...HARNESS_FILES, ...viewFiles]) {
    hash.update(file).update(readFileSync(nodePath.join(ROOT, file)));
  }
  hash.update(JSON.stringify([tier.env, tier.args]));
  return hash.digest("hex").slice(0, 16);
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

/** The heading a PR's description claims a visible change under. */
const SNAPSHOTS_HEADING = /^## Snapshots[ \t]*$/u;

/**
 * The views a PR's description names as changed: those of `views` whose
 * name stands under its `## Snapshots` section (up to the next heading
 * of that level or above), as a word of its own. Null without the
 * section — the PR claims the picture is the same. The heading alone
 * names nothing: a view that differs unnamed is a change nobody owned.
 */
export function claimedViews(
  body: string,
  views: readonly string[]
): string[] | null {
  const lines = body.replaceAll("\r", "").split("\n");
  const from = lines.findIndex((line) => SNAPSHOTS_HEADING.test(line));
  if (from === -1) {
    return null;
  }
  const rest = lines.slice(from + 1);
  const end = rest.findIndex((line) => /^##? /u.test(line));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  return views.filter((view) =>
    new RegExp(`(^|[^\\w-])${view}($|[^\\w-])`, "u").test(section)
  );
}

/** The differing views no claim names: what fails a run. */
export function unclaimed(
  results: readonly ViewResult[],
  claimed: readonly string[] | null
): string[] {
  return results
    .filter((r) => r.differs && !(claimed ?? []).includes(r.view))
    .map((r) => r.view);
}

/** A run's exit code: 1 when a view differs that no claim names. */
export function exitOf(
  results: readonly ViewResult[],
  claimed: readonly string[] | null
): number {
  return unclaimed(results, claimed).length > 0 ? 1 : 0;
}

/**
 * Whether two renders can be compared at all. Each side has to have been
 * held `still`, or the comparison reports the weather. An unheld head is
 * a broken probe or harness: an error. An unheld base is an error too,
 * once the base knows the plates (it has `lib/city/plate-diff.ts`) — the
 * probe was lost on the way — and only a base from before them is let
 * through, uncompared.
 */
export function comparability(sides: {
  headHeld: boolean;
  baseHeld: boolean;
  baseKnowsPlates: boolean;
}): { compare: true } | { compare: false; exit: 0 | 2; why: string } {
  if (!sides.headHeld) {
    return {
      compare: false,
      exit: 2,
      why: "the head was not held still: its build does not know the `still` probe (poc-scene.ts), or the harness did not set it",
    };
  }
  if (sides.baseHeld) {
    return { compare: true };
  }
  return sides.baseKnowsPlates
    ? {
        compare: false,
        exit: 2,
        why: "the base was not held still although it has the plates: the `still` probe was lost on the way to it",
      }
    : {
        compare: false,
        exit: 0,
        why: "the base predates the plates (plan 087) and cannot be held still, so nothing was compared",
      };
}

const percent = (share: number): string => `${(share * 100).toFixed(3)} %`;

/** A view's word in the report. */
function standing(r: ViewResult, claimed: readonly string[] | null): string {
  if (!r.differs) {
    return "same";
  }
  return (claimed ?? []).includes(r.view)
    ? "differs, named"
    : "**differs, not named**";
}

/** The report's sentence on what the differing views mean for the run. */
function verdictOf(
  results: readonly ViewResult[],
  claimed: readonly string[] | null
): string {
  const loose = unclaimed(results, claimed);
  if (!results.some((r) => r.differs)) {
    return "the picture is the same.";
  }
  if (loose.length === 0) {
    return "every differing view is named under the PR's `## Snapshots`: reported, not failed.";
  }
  const names = loose.map((v) => `\`${v}\``).join(", ");
  return claimed === null
    ? `the PR claims no change (no \`## Snapshots\` section): **failed** on ${names}. Name each there and show it, or find what moved.`
    : `**failed**: ${names} differ${loose.length === 1 ? "s" : ""} and ${loose.length === 1 ? "is" : "are"} not named under \`## Snapshots\`. Name each there, or find what moved.`;
}

/** The report as Markdown: the verdict, then a row a view. */
export function reportOf(
  results: ViewResult[],
  opts: {
    base: string;
    head: string;
    tier: Tier["name"];
    adapter: string;
    tolerance: PlateTolerance;
    /** the views the PR names as changed; null: it claims no change */
    claimed: readonly string[] | null;
    seconds?: number;
  }
): string {
  const differing = results.filter((r) => r.differs);
  const lines = [
    `## Plates, ${opts.tier}: ${differing.length} of ${results.length} views differ`,
    "",
    `\`${opts.base}\` against \`${opts.head}\` on *${opts.adapter}* — ${verdictOf(results, opts.claimed)}`,
    "",
    `A pixel differs above ${opts.tolerance.level} of 255 in a channel; a view differs above ${percent(opts.tolerance.share)} of its pixels, or above ${opts.tolerance.mean} of 255 on average. This says *changed*, never *good* (ADR 0018), and only of the views below.${
      opts.seconds === undefined
        ? ""
        : ` Rendered and compared in ${Math.round(opts.seconds)} s.`
    }`,
    "",
    "| View | | Pixels over the level | Share | Largest difference | Mean |",
    "|---|---|---:|---:|---:|---:|",
    ...results.map(
      (r) =>
        `| \`${r.view}\` | ${standing(r, opts.claimed)} | ${r.differing} | ${percent(r.share)} | ${r.max} | ${r.mean.toFixed(3)} |`
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

export interface Args {
  base: string | null;
  /** the views meant to differ; null: none is claimed */
  claims: string[] | null;
  /** a PR's description to read them from */
  claimsFile: string | null;
  command: "compare" | "diff" | "pairs";
  noBuild: boolean;
  rest: string[];
  summary: string | null;
  views: string[] | null;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    base: null,
    claims: null,
    claimsFile: null,
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
    } else if (arg === "--claims") {
      i += 1;
      args.claims = (argv[i] ?? "").split(",").filter(Boolean);
    } else if (arg === "--claims-file") {
      i += 1;
      args.claimsFile = argv[i] ?? null;
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
 * rendered them before on the same adapter, with the same harness, views
 * and page; else built in a worktree (`plates/src/<sha>`, removed once
 * rendered) and rendered.
 *
 * The base bakes into a cache of its own, cold: sharing the head's would
 * hand it whatever the head just baked under a key that misses a changed
 * input, and an under-keyed bake would then show on neither side. It
 * costs the base's build the reference site's bake (plan 087, Findings).
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
    if (kept.adapter === headRun.adapter && kept.harness === headRun.harness) {
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
  log(`base ${sha.slice(0, 8)}: building`);
  await build(src);
  await served(src, async (port) => await render(tier, port, out, views));
  // its plates are kept; the checkout (a gigabyte of data) is not
  sh("git", ["worktree", "remove", "--force", src]);
  return out;
}

/**
 * Whether a commit has the plates (`lib/city/plate-diff.ts` in its
 * tree): the marker `comparability` asks for. A commit git cannot read —
 * unknown, or not fetched into a shallow clone — is an error, never
 * "from before the plates": that answer is the one way an uncompared
 * run passes.
 */
export function knowsPlates(sha: string, cwd = ROOT): boolean {
  const tree = spawnSync(
    "git",
    ["ls-tree", "--name-only", sha, "--", "lib/city/plate-diff.ts"],
    { cwd, encoding: "utf-8" }
  );
  if (tree.status !== 0) {
    throw new Error(
      `cannot read the base commit ${sha}: ${tree.stderr.trim() || "git ls-tree failed"}`
    );
  }
  return tree.stdout.trim() === "lib/city/plate-diff.ts";
}

/**
 * The views a run's claims name, of the ones it rendered: those of
 * `--claims`, and those a description names under its `## Snapshots`
 * (`--claims-file`). Null when neither claims anything.
 */
export function claimsOf(
  args: Pick<Args, "claims" | "claimsFile">,
  views: readonly string[]
): string[] | null {
  const named = args.claims
    ? views.filter((v) => args.claims?.includes(v))
    : [];
  const read = args.claimsFile
    ? claimedViews(readFileSync(args.claimsFile, "utf-8"), views)
    : null;
  return args.claims || read ? [...new Set([...named, ...(read ?? [])])] : null;
}

/**
 * Two rendered folders brought to a verdict: the report and the exit
 * code. `report`: where a differing view's three images go.
 */
export async function conclude(opts: {
  base: string;
  head: string;
  baseName: string;
  headName: string;
  baseKnowsPlates: boolean;
  tier: Pick<Tier, "name" | "tolerance">;
  claims: (views: readonly string[]) => string[] | null;
  report: string | null;
  seconds?: number;
}): Promise<{ exit: number; markdown: string }> {
  const [baseRun, headRun] = [readRun(opts.base), readRun(opts.head)];
  const able = comparability({
    headHeld: headRun.held,
    baseHeld: baseRun.held,
    baseKnowsPlates: opts.baseKnowsPlates,
  });
  if (!able.compare) {
    return {
      exit: able.exit,
      markdown: `## Plates, ${opts.tier.name}: not compared${able.exit === 0 ? "" : " — **failed**"}\n\n\`${opts.baseName}\` against \`${opts.headName}\`: ${able.why}.\n`,
    };
  }
  const results = await compare(
    opts.base,
    opts.head,
    opts.tier.tolerance,
    opts.report
  );
  const claimed = opts.claims(results.map((r) => r.view));
  return {
    exit: exitOf(results, claimed),
    markdown: reportOf(results, {
      base: opts.baseName,
      head: opts.headName,
      tier: opts.tier.name,
      adapter: headRun.adapter,
      tolerance: opts.tier.tolerance,
      claimed,
      seconds: opts.seconds,
    }),
  };
}

/** A report where a run's readers look: the folder, stdout, the summary. */
function say(markdown: string, summary: string | null, report: string): void {
  mkdirSync(report, { recursive: true });
  writeFileSync(nodePath.join(report, "report.md"), markdown);
  process.stdout.write(markdown);
  if (summary) {
    appendFileSync(summary, markdown);
  }
}

/** What a comparison renders and reads: the real ones build and serve. */
export interface CompareSteps {
  /** the base's and the head's commit, and the head's name in a report */
  commits: (args: Args) => { base: string; head: string };
  /** the head rendered: its folder */
  head: (args: Args, tier: Tier) => Promise<string>;
  /** the base rendered, or its kept plates: its folder */
  base: (tier: Tier, sha: string, args: Args, head: RunInfo) => Promise<string>;
  knowsPlates: (sha: string) => boolean;
  /** where the report goes */
  report: string;
}

const realSteps: CompareSteps = {
  commits: (args) => {
    const head = sh("git", ["rev-parse", "HEAD"]);
    const dirty = sh("git", ["status", "--porcelain", "--untracked-files=no"]);
    return {
      base: sh("git", [
        "rev-parse",
        args.base ?? sh("git", ["merge-base", "HEAD", "origin/main"]),
      ]),
      head: `${head.slice(0, 8)}${dirty ? "+changes" : ""}`,
    };
  },
  head: async (args, tier) => {
    if (!args.noBuild) {
      log("head: building");
      await build(ROOT);
    }
    const out = nodePath.join(PLATES_DIR, tier.name, "head");
    await served(
      ROOT,
      async (port) => await render(tier, port, out, args.views ?? tier.views)
    );
    return out;
  },
  base: async (tier, sha, args, head) =>
    await basePlates(tier, sha, args.views ?? tier.views, head),
  knowsPlates,
  report: nodePath.join(PLATES_DIR, "report"),
};

/**
 * The base against the head: its exit code. A run that ends without a
 * verdict — a build that failed, a view that did not settle (the harness
 * names it), a blank plate — says so where the verdict would stand, and
 * still fails: the error goes on to `main`.
 */
export async function comparePlates(
  args: Args,
  tier: Tier,
  steps: CompareSteps = realSteps
): Promise<number> {
  const started = Date.now();
  const seconds = () => (Date.now() - started) / 1000;
  const commits = steps.commits(args);
  rmSync(steps.report, { recursive: true, force: true });
  try {
    const head = await steps.head(args, tier);
    const base = await steps.base(tier, commits.base, args, readRun(head));
    const { exit, markdown } = await conclude({
      base,
      head,
      baseName: commits.base.slice(0, 8),
      headName: commits.head,
      baseKnowsPlates: steps.knowsPlates(commits.base),
      tier,
      claims: (rendered) => claimsOf(args, rendered),
      report: steps.report,
      seconds: seconds(),
    });
    say(markdown, args.summary, steps.report);
    return exit;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    say(
      `## Plates, ${tier.name}: not compared — **failed**\n\n\`${commits.base.slice(0, 8)}\` against \`${commits.head}\` after ${Math.round(seconds())} s: ${why}. The step's log names the view.\n`,
      args.summary,
      steps.report
    );
    throw error;
  }
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
  const { exit, markdown } = await conclude({
    base: a,
    head: b,
    baseName: a,
    headName: b,
    // two folders rendered by hand: both are held, or it is an error
    baseKnowsPlates: true,
    tier,
    claims: (rendered) => claimsOf(args, rendered),
    report: nodePath.join(PLATES_DIR, "report"),
  });
  process.stdout.write(markdown);
  return exit;
}

/** The commands by name; a test puts its own in their place. */
type Commands = Record<
  Args["command"],
  (args: Args, tier: Tier) => Promise<number>
>;

/**
 * The script: its exit code. Whatever a command throws is a run that
 * could not be compared — 2, never 0.
 */
export async function main(
  argv: string[],
  env: Partial<Record<string, string>>,
  commands?: Commands
): Promise<number> {
  try {
    const args = parseArgs(argv);
    const table = commands ?? {
      compare: comparePlates,
      diff: diffFolders,
      pairs,
    };
    return await table[args.command](args, tierOf(env));
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
