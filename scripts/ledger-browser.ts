/**
 * The ledger's browser read (plan 087, phase 2), for scripts/ledger.ts
 * `--browser`: runs e2e/ledger.spec.ts against the NEXT_PUBLIC_POC_DEBUG=1
 * production build (a running `next start` is reused, else Playwright
 * builds and starts one), gzips each script body it saved with this, the
 * pinned, Bun, and returns the ledger's `browser` and `timings` sections
 * (lib/city/ledger-browser.ts). Without `--browser`, the committed ones
 * stand, uncompared.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/** Runs the spec into a fresh folder; its reading and each script's body. */
function readBrowser(): {
  reading: BrowserReading;
  body: (file: string) => Uint8Array;
  done: () => void;
} {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "ledger-"));
  const run = Bun.spawnSync(
    ["bunx", "playwright", "test", "e2e/ledger.spec.ts", "--reporter=line"],
    {
      cwd: ROOT,
      env: { ...process.env, LEDGER: "1", LEDGER_OUT: dir },
      // Playwright's progress to stderr: stdout is the ledger's report
      stdio: ["ignore", process.stderr.fd, "inherit"],
    }
  );
  const readingPath = nodePath.join(dir, READING_FILE);
  if (run.exitCode !== 0 || !existsSync(readingPath)) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `ledger: the browser's read failed (e2e/ledger.spec.ts, exit ${run.exitCode})`
    );
  }
  return {
    reading: JSON.parse(readFileSync(readingPath, "utf-8")) as BrowserReading,
    body: (file) => new Uint8Array(readFileSync(nodePath.join(dir, file))),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** The browser's sections, read now; `files` is the site's manifest
 *  (logical → served), for the cache's logical names. */
export function browserSections(
  files: Record<string, string>,
  machine: string
): { browser: BrowserFigures; timings: Timings } {
  const logicalOf = new Map(
    Object.entries(files).map(([logical, served]) => [served, logical])
  );
  const { reading, body, done } = readBrowser();
  try {
    const gzip = new Map(
      reading.firstLoad.map((f) => [f.url, jsGzip(body(f.body))])
    );
    return browserLedger(
      reading,
      (url) => gzip.get(url) ?? 0,
      (served) => logicalOf.get(served),
      machine,
      new Date().toISOString().slice(0, 10)
    );
  } finally {
    done();
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
