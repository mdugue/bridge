import { readFileSync } from "node:fs";
import path from "node:path";
import { descriptionOf, titleOf } from "@/lib/docs/content";
import { docFiles } from "@/lib/docs/files";
import { type NavGroup, type NavItem, navGroups } from "@/lib/docs/nav";
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

export function descriptionFor(file: string): string | null {
  return descriptionOf(readDoc(file));
}

/** A page's neighbours in its menu group, flattened (folders in order). */
export function neighbours(file: string): {
  group: NavGroup;
  index: number;
  count: number;
  prev: NavItem | null;
  next: NavItem | null;
} | null {
  for (const group of nav()) {
    const flat = group.items.flatMap((item) => [item, ...item.children]);
    const index = flat.findIndex((item) => item.file === file);
    if (index >= 0) {
      return {
        group,
        index,
        count: flat.length,
        prev: flat[index - 1] ?? null,
        next: flat[index + 1] ?? null,
      };
    }
  }
  return null;
}

export interface HeroImage {
  src: string;
}

/**
 * The land-cover map of the tile block (scripts/bake-wissen-hero.ts), as
 * prepare-data published it; next/image serves it in the sizes a page asks
 * for. Null when the bake was skipped – the pages then go without it.
 */
export function heroImage(): HeroImage | null {
  try {
    const manifest = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "public", "data", "manifest.json"),
        "utf8"
      )
    ) as { files: Record<string, string> };
    const file = manifest.files["wissen-hero.webp"];
    return file ? { src: `/data/${file}` } : null;
  } catch {
    return null;
  }
}
