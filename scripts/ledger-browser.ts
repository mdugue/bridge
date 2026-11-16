/**
 * The ledger's browser read (plan 087, phase 2), for scripts/ledger.ts
 * `--browser`: runs e2e/ledger.spec.ts against the NEXT_PUBLIC_POC_DEBUG=1
 * production build (a running `next start` is reused, else Playwright
 * builds and starts one), gzips each script body it saved with this, the
 * pinned, Bun, and returns the ledger's `browser` and `timings` sections
 * (lib/city/ledger-browser.ts). Without `--browser`, the committed ones
 * stand, uncompared.
 *
 * It refuses a read whose JavaScript is not CI's: a build environment that
 * inlines a value CI does not set (next.config.ts, the crash reports'
 * DSN, release and environment), or a running server that serves another
 * build than `.next/` holds, or a build older than the sources.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { browserLedger, jsGzip } from "../lib/city/ledger-browser";
import type {
  BrowserFigures,
  BrowserReading,
  Timings,
} from "../lib/city/ledger-browser";

const ROOT = nodePath.join(import.meta.dir, "..");

/** The name of the reading inside the folder the spec writes to. */
export const READING_FILE = "reading.json";

/** What next.config.ts inlines into the client from the build's
 *  environment (lib/city/crash-reports.ts `reportBuild`). CI sets none:
 *  a read with one set weighs JavaScript CI never builds. */
export const INLINED_ENV = [
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_RELEASE",
  "SENTRY_ENVIRONMENT",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_ENV",
] as const;

/** The inlined variables set (non-empty) in `env`. */
export function inlinedEnvSet(
  env: Readonly<Record<string, string | undefined>>
): string[] {
  return INLINED_ENV.filter((name) => (env[name]?.trim() ?? "") !== "");
}

/** The folders and files a client build compiles (as CI's cache key
 *  lists them). */
const BUILD_SOURCES = [
  "app",
  "components",
  "hooks",
  "lib",
  "sites",
  "types",
  "next.config.ts",
];

/** The newest modification time among the build's sources, tests left
 *  out (ms). */
function newestSource(root: string): number {
  let newest = 0;
  for (const entry of BUILD_SOURCES) {
    const path = nodePath.join(root, entry);
    if (!existsSync(path)) {
      continue;
    }
    const files = statSync(path).isDirectory()
      ? readdirSync(path, { recursive: true, encoding: "utf-8" })
          .filter(
            (f) => /\.(?:tsx?|css|mdx)$/u.test(f) && !f.includes(".test.")
          )
          .map((f) => nodePath.join(path, f))
      : [path];
    for (const file of files) {
      newest = Math.max(newest, statSync(file).mtimeMs);
    }
  }
  return newest;
}

/** Why a running server's JavaScript is not this tree's build, or null:
 *  its page must carry `.next/BUILD_ID`, and that build must be newer
 *  than every source. */
export function staleServer(
  page: string,
  buildId: string,
  builtAt: number,
  sourcesAt: number
): string | null {
  if (!page.includes(buildId)) {
    return `the running server does not serve .next's build (${buildId})`;
  }
  if (sourcesAt > builtAt) {
    return "a source is newer than .next's build: build again";
  }
  return null;
}

/** Refuses a read whose JavaScript would not be CI's (see the head). */
async function refuseForeignBuild(root: string): Promise<void> {
  const set = inlinedEnvSet(process.env);
  if (set.length > 0) {
    throw new Error(
      `ledger: ${set.join(", ")} set: the build inlines it into the JavaScript, and CI sets none. Unset it, build again and read.`
    );
  }
  const port = process.env.PORT ?? "3000";
  let page: string;
  try {
    const response = await fetch(`http://localhost:${port}/dresden`);
    page = await response.text();
  } catch {
    // no server: Playwright builds one (locally) or starts CI's build
    return;
  }
  const buildIdFile = nodePath.join(root, ".next/BUILD_ID");
  const reason = existsSync(buildIdFile)
    ? staleServer(
        page,
        readFileSync(buildIdFile, "utf-8").trim(),
        statSync(buildIdFile).mtimeMs,
        newestSource(root)
      )
    : "no .next/BUILD_ID beside a running server";
  if (reason) {
    throw new Error(`ledger: ${reason}; nothing read`);
  }
}

/** What a read of the spec left: its reading and each script's body. */
export interface BrowserRead {
  reading: BrowserReading;
  body: (file: string) => Uint8Array;
  done: () => void;
}

/** Throws unless the spec passed and wrote its reading. */
export function checkRun(exitCode: number | null, wroteReading: boolean): void {
  if (exitCode !== 0 || !wroteReading) {
    throw new Error(
      `ledger: the browser's read failed (e2e/ledger.spec.ts, exit ${exitCode})`
    );
  }
}

/** Runs the spec into a fresh folder. */
async function readBrowser(root = ROOT): Promise<BrowserRead> {
  await refuseForeignBuild(root);
  const dir = mkdtempSync(nodePath.join(tmpdir(), "ledger-"));
  const run = Bun.spawnSync(
    ["bunx", "playwright", "test", "e2e/ledger.spec.ts", "--reporter=line"],
    {
      cwd: root,
      env: { ...process.env, LEDGER: "1", LEDGER_OUT: dir },
      // Playwright's progress to stderr: stdout is the ledger's report
      stdio: ["ignore", process.stderr.fd, "inherit"],
    }
  );
  const readingPath = nodePath.join(dir, READING_FILE);
  try {
    checkRun(run.exitCode, existsSync(readingPath));
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    reading: JSON.parse(readFileSync(readingPath, "utf-8")) as BrowserReading,
    body: (file) => new Uint8Array(readFileSync(nodePath.join(dir, file))),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The browser's sections from a read; `files` is the site's manifest
 *  (logical → served), for the cache's logical names. */
export function sectionsOf(
  read: Omit<BrowserRead, "done">,
  files: Record<string, string>,
  machine: string,
  today: string
): { browser: BrowserFigures; timings: Timings } {
  const logicalOf = new Map(
    Object.entries(files).map(([logical, served]) => [served, logical])
  );
  const gzip = new Map(
    read.reading.firstLoad.map((f) => [f.url, jsGzip(read.body(f.body))])
  );
  return browserLedger(
    read.reading,
    (url) => {
      const bytes = gzip.get(url);
      if (bytes === undefined) {
        throw new Error(`ledger: no body weighed for ${url}`);
      }
      return bytes;
    },
    (served) => logicalOf.get(served),
    machine,
    today
  );
}

/** The browser's sections, read now. */
export async function browserSections(
  files: Record<string, string>,
  machine: string,
  root = ROOT
): Promise<{ browser: BrowserFigures; timings: Timings }> {
  const read = await readBrowser(root);
  try {
    return sectionsOf(
      read,
      files,
      machine,
      new Date().toISOString().slice(0, 10)
    );
  } finally {
    read.done();
  }
}

/** The timings as `--check` prints them: one line a category and side. */
export function timingReport(timings: Timings): string {
  const rows = (["desktop", "phone"] as const).flatMap((side) =>
    Object.entries(timings[side]).map(
      ([category, t]) =>
        `recorded, not compared: ${side} ${category}: ${t.count}× ${t.totalMs} ms (max ${t.maxMs})\n`
    )
  );
  return `${rows.join("")}recorded on: ${timings.machine}\n`;
}
