import { readFileSync } from "node:fs";
import path from "node:path";
import { titleOf } from "@/lib/docs/content";
import { docFiles } from "@/lib/docs/files";
import { type NavGroup, navGroups } from "@/lib/docs/nav";
import { routeOf, segmentsOf } from "@/lib/docs/routes";

/**
 * The docs/ folder as the /wissen pages read it, at build time: every page is
 * prerendered from `generateStaticParams`, so nothing here runs per request.
 */
const DOCS = path.join(process.cwd(), "docs");

/** Every published docs file, repo-relative. */
export function pageFiles(): string[] {
  return docFiles(DOCS).filter((f) => routeOf(f) !== null);
}

/** A docs file's Markdown. Paths stay inside docs/, so only docs/ is traced. */
export function readDoc(file: string): string {
  return readFileSync(path.join(DOCS, file.replace(/^docs\//u, "")), "utf8");
}

/** The file published at these segments under /wissen, if any. */
export function fileAt(segments: readonly string[]): string | null {
  const wanted = segments.map((s) => decodeURIComponent(s)).join("/");
  return pageFiles().find((f) => segmentsOf(f)?.join("/") === wanted) ?? null;
}

export function titleFor(file: string): string {
  return titleOf(readDoc(file)) ?? path.basename(file, ".md");
}

export function nav(): NavGroup[] {
  return navGroups(pageFiles(), readDoc, titleFor);
}
