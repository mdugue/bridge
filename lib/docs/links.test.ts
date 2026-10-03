import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { linkTargets } from "./content";
import { docFiles } from "./files";

/**
 * Every relative link in docs/ and AGENTS.md points at a file that exists.
 * Plans are condensed and deleted (docs/plans/README.md, "Lifecycle"), ADRs
 * renumbered on merges — nothing else notices the links left pointing at
 * them.
 */
const ROOT = path.join(import.meta.dir, "../..");

function isRelative(target: string): boolean {
  return !(
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("#") ||
    target.startsWith("/")
  );
}

/** Code is not prose: `STEPS[step](tile)` is not a link. */
function withoutCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** The relative link targets of one file that resolve to nothing. */
function brokenLinks(file: string): string[] {
  const markdown = withoutCode(readFileSync(path.join(ROOT, file), "utf8"));
  const dir = path.dirname(path.join(ROOT, file));
  return linkTargets(markdown)
    .filter(isRelative)
    .map((target) => target.split("#")[0] ?? "")
    .filter((target) => target !== "")
    .filter((target) => !existsSync(path.resolve(dir, decodeURI(target))))
    .map((target) => `${file} → ${target}`);
}

describe("relative links in the knowledge base", () => {
  test("resolve to files that exist", () => {
    const files = [...docFiles(path.join(ROOT, "docs")), "AGENTS.md"];
    expect(files.flatMap(brokenLinks)).toEqual([]);
  });
});
