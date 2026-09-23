import { linkTargets } from "./content";
import { langOf, resolveHref, routeOf } from "./routes";

export interface NavItem {
  file: string;
  href: string;
  title: string;
  /** Pages in the folder this item is the README of (docs/adr/, docs/plans/). */
  children: NavItem[];
}

export interface NavGroup {
  id: "de" | "en" | "dev";
  label: string;
  items: NavItem[];
}

/**
 * The order the index pages already give: the files `index` links to, first
 * appearance first, then whatever it does not mention, alphabetically. The
 * site's menu is the knowledge base's own reading order, not a second list.
 */
export function orderByIndex(
  indexFile: string,
  indexMarkdown: string,
  files: readonly string[]
): string[] {
  const pages = new Set(files);
  const byRoute = new Map(files.map((f) => [routeOf(f), f]));
  const seen = new Set<string>();
  for (const target of linkTargets(indexMarkdown)) {
    const resolved = resolveHref(indexFile, target, pages);
    const route = resolved.href.split("#")[0] ?? "";
    const file = resolved.kind === "page" ? byRoute.get(route) : undefined;
    if (file !== undefined && file !== indexFile) {
      seen.add(file);
    }
  }
  return [...seen, ...files.filter((f) => !seen.has(f)).sort()];
}

const GROUP_LABELS: Record<NavGroup["id"], string> = {
  de: "Leitfaden",
  en: "Guide (English)",
  dev: "Entwicklung (English)",
};

const dirOf = (file: string) => file.slice(0, file.lastIndexOf("/"));

/** The folder README a developer page sits under, if it is not docs/ itself. */
function parentOf(file: string, files: ReadonlySet<string>): string | null {
  const dir = dirOf(file);
  const readme = `${dir}/README.md`;
  return dir !== "docs" && readme !== file && files.has(readme) ? readme : null;
}

/** The three menu groups, each in its index's order. */
export function navGroups(
  files: readonly string[],
  read: (file: string) => string,
  title: (file: string) => string
): NavGroup[] {
  const all = new Set(files);
  const item = (file: string, children: NavItem[] = []): NavItem => ({
    file,
    href: routeOf(file) ?? "",
    title: title(file),
    children,
  });
  const guide = (lang: "de" | "en"): NavGroup => {
    const members = files.filter(
      (f) => f.startsWith("docs/guide/") && langOf(f) === lang
    );
    const index = "docs/guide/README.md";
    return {
      id: lang,
      label: GROUP_LABELS[lang],
      items: orderByIndex(index, read(index), members).map((f) => item(f)),
    };
  };
  const devIndex = "docs/README.md";
  const dev = files.filter(
    (f) => !f.startsWith("docs/guide/") && routeOf(f) !== null
  );
  const top = dev.filter((f) => f !== devIndex && parentOf(f, all) === null);
  const childrenOf = (readme: string) => {
    const kids = dev.filter((f) => parentOf(f, all) === readme);
    return orderByIndex(readme, read(readme), kids).map((f) => item(f));
  };
  return [
    guide("de"),
    guide("en"),
    {
      id: "dev",
      label: GROUP_LABELS.dev,
      items: [
        item(devIndex),
        ...orderByIndex(devIndex, read(devIndex), top).map((f) =>
          item(f, f.endsWith("/README.md") ? childrenOf(f) : [])
        ),
      ],
    },
  ];
}
