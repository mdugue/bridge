/**
 * Where each file under docs/ is published, and where a link between them
 * goes. The site mirrors the folder, so there is nothing to keep in sync:
 *
 *   docs/guide/README.md          → /wissen            the entry, both languages
 *   docs/guide/<de|en>/<page>.md  → /wissen/<de|en>/<page>
 *   docs/README.md                → /wissen/dev        the developer docs …
 *   docs/<path>.md                → /wissen/dev/<path> … everything else
 *   docs/<dir>/README.md          → /wissen/dev/<dir>
 *
 * A link to anything outside docs/ (AGENTS.md, a script, the skill) points at
 * the file on GitHub, so the Markdown stays written for GitHub and the site
 * follows it.
 */

export const WISSEN = "/wissen";
export const REPO_URL = "https://github.com/mdugue/bridge";
export const LANGS = ["de", "en"] as const;
export type Lang = (typeof LANGS)[number];

const GUIDE = "docs/guide/";

const isLang = (s: string | undefined): s is Lang => s === "de" || s === "en";

/** The published route of a docs file, or null if it is not a page. */
export function routeOf(file: string): string | null {
  if (!(file.startsWith("docs/") && file.endsWith(".md"))) {
    return null;
  }
  if (file.startsWith("docs/diagrams/")) {
    return null;
  }
  if (file === `${GUIDE}README.md`) {
    return WISSEN;
  }
  if (file.startsWith(GUIDE)) {
    const [lang, ...rest] = file.slice(GUIDE.length, -3).split("/");
    return isLang(lang) && rest.length === 1 && rest[0] !== "README"
      ? `${WISSEN}/${lang}/${rest[0]}`
      : null;
  }
  const inner = file.slice("docs/".length, -3).replace(/(^|\/)README$/u, "");
  return inner ? `${WISSEN}/dev/${inner}` : `${WISSEN}/dev`;
}

/** The route's segments under /wissen, as `generateStaticParams` wants them. */
export function segmentsOf(file: string): string[] | null {
  const route = routeOf(file);
  if (route === null) {
    return null;
  }
  return route === WISSEN ? [] : route.slice(WISSEN.length + 1).split("/");
}

/** The language a page is written in; the guide's entry holds both. */
export function langOf(file: string): Lang | null {
  if (file.startsWith(GUIDE)) {
    const lang = file.slice(GUIDE.length).split("/")[0];
    return isLang(lang) ? lang : null;
  }
  return "en";
}

/** The same guide page in the other language (the guide keeps them paired). */
export function twinOf(file: string): { lang: Lang; file: string } | null {
  const lang = langOf(file);
  if (!file.startsWith(GUIDE) || lang === null) {
    return null;
  }
  const other: Lang = lang === "de" ? "en" : "de";
  return {
    lang: other,
    file: `${GUIDE}${other}/${file.slice(GUIDE.length + 3)}`,
  };
}

/** POSIX `join` + `normalize` without node:path, for the browserless core. */
export function joinPath(dir: string, rel: string): string {
  const out: string[] = [];
  for (const part of `${dir}/${rel}`.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

const dirOf = (file: string) => file.split("/").slice(0, -1).join("/");

export type Resolved =
  | { kind: "page"; href: string }
  | { kind: "external"; href: string };

/**
 * Where a link written in `from` (a repo-relative docs file) goes on the
 * site. `pages` is every file that is published.
 */
export function resolveHref(
  from: string,
  href: string,
  pages: ReadonlySet<string>
): Resolved {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith("//")) {
    return { kind: "external", href };
  }
  if (href.startsWith("#")) {
    return { kind: "page", href };
  }
  const [target = "", hash] = href.split("#");
  const suffix = hash ? `#${hash}` : "";
  const file = target.startsWith("/")
    ? target.slice(1)
    : joinPath(dirOf(from), target);
  for (const candidate of [file, `${file}/README.md`.replace("//", "/")]) {
    const route = pages.has(candidate) ? routeOf(candidate) : null;
    if (route !== null) {
      return { kind: "page", href: `${route}${suffix}` };
    }
  }
  const isDir = target.endsWith("/") || !/\.[a-z0-9]+$/iu.test(file);
  return {
    kind: "external",
    href: `${REPO_URL}/${isDir ? "tree" : "blob"}/main/${file}${suffix}`,
  };
}

/** The file on GitHub, for the "view source" link. */
export const sourceUrl = (file: string) => `${REPO_URL}/blob/main/${file}`;
