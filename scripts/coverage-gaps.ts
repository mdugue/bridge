/**
 * Lists the sources no unit test imports at all. Bun's coverage report
 * names only files some test loads, so `create-app.ts`, `post-stack.ts` or
 * `prepare-data.ts` are simply absent from it and a plain percentage reads
 * high while the riskiest modules do not appear. Run after
 * `bun run test:coverage`; prints a Markdown table (CI appends it to the
 * job summary). A report, not a gate.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** The sources that should show up in the report (tests excluded). */
const SOURCE_GLOBS = [
  "app/_components/**/*.{ts,tsx}",
  "lib/**/*.ts",
  "scripts/*.ts",
];

export interface Source {
  path: string;
  lines: number;
}

/** The repo-relative paths an lcov report covers (its `SF:` records). */
export function coveredPaths(lcov: string): Set<string> {
  const paths = new Set<string>();
  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      paths.add(line.slice(3).trim());
    }
  }
  return paths;
}

/** The sources the report never mentions, the longest first. */
export function coverageGaps(lcov: string, sources: Source[]): Source[] {
  const covered = coveredPaths(lcov);
  return sources
    .filter((s) => !covered.has(s.path))
    .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
}

export function gapTable(gaps: Source[]): string {
  const total = gaps.reduce((sum, g) => sum + g.lines, 0);
  return [
    `### Sources no unit test imports (${gaps.length} files, ${total} lines)`,
    "",
    "| File | Lines |",
    "|---|---:|",
    ...gaps.map((g) => `| \`${g.path}\` | ${g.lines} |`),
    "",
  ].join("\n");
}

function isTest(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

function sources(root: string): Source[] {
  const out: Source[] = [];
  for (const pattern of SOURCE_GLOBS) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: root })) {
      if (!isTest(path)) {
        const text = readFileSync(join(root, path), "utf8");
        out.push({ path, lines: text.split("\n").length });
      }
    }
  }
  return out;
}

if (import.meta.main) {
  // CI runs this even when the tests failed (`if: always()`), possibly
  // before Bun wrote the report: say so rather than fail a second time.
  const report = join(ROOT, "coverage", "lcov.info");
  process.stdout.write(
    existsSync(report)
      ? gapTable(coverageGaps(readFileSync(report, "utf8"), sources(ROOT)))
      : "_No coverage report (the unit tests did not finish)._\n"
  );
}
