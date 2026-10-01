/**
 * Writes the knowledge base's "sources by city" pages
 * (docs/guide/{en,de}/sources-by-city.md) from the site and provider
 * configs (lib/city/source-matrix.ts). `bun run docs:matrix`; the test
 * fails when the committed pages differ from what this writes.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Lang, sourceMatrixPage } from "../lib/city/source-matrix";
import type { Site } from "../lib/city/site";
import { REFERENCE_SITE, SITES } from "../sites";

const ROOT = join(import.meta.dir, "..");

/** The sites in the table's column order, and those whose data is here. */
export function matrixInputs(root = ROOT) {
  const all = Object.values(SITES);
  const built = new Set(
    all.filter((s) => existsSync(join(root, "data", s.id))).map((s) => s.id)
  );
  // the reference site first, then the built ones, then the configured ones
  const rank = (s: Site) =>
    s.id === REFERENCE_SITE ? 0 : built.has(s.id) ? 1 : 2;
  const sites = [...all].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "de")
  );
  return { sites, built };
}

export function matrixPath(lang: Lang, root = ROOT): string {
  return join(root, "docs", "guide", lang, "sources-by-city.md");
}

if (import.meta.main) {
  const { sites, built } = matrixInputs();
  for (const lang of ["en", "de"] as const) {
    writeFileSync(matrixPath(lang), sourceMatrixPage(sites, lang, built));
    process.stdout.write(`docs-matrix: wrote ${matrixPath(lang)}\n`);
  }
}
