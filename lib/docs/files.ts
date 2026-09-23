import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Every Markdown file under `docsDir` (the repo's docs/), repo-relative with
 * forward slashes, sorted.
 * The committed diagram SVGs live under docs/ too but are not pages.
 */
export function docFiles(docsDir: string): string[] {
  return readdirSync(docsDir, { recursive: true, encoding: "utf8" })
    .map((f) => `docs/${f.split(path.sep).join("/")}`)
    .filter((f) => f.endsWith(".md") && !f.startsWith("docs/diagrams/"))
    .sort();
}
