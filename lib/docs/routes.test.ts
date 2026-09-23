import { describe, expect, test } from "bun:test";
import {
  joinPath,
  langOf,
  REPO_URL,
  resolveHref,
  routeOf,
  segmentsOf,
  twinOf,
} from "./routes";

describe("routeOf", () => {
  test.each([
    ["docs/guide/README.md", "/wissen"],
    ["docs/guide/de/data-sources.md", "/wissen/de/data-sources"],
    ["docs/guide/en/glossary.md", "/wissen/en/glossary"],
    ["docs/README.md", "/wissen/dev"],
    ["docs/rendering.md", "/wissen/dev/rendering"],
    ["docs/adr/README.md", "/wissen/dev/adr"],
    ["docs/adr/0009-shadow-recipe.md", "/wissen/dev/adr/0009-shadow-recipe"],
  ])("%s → %s", (file, route) => {
    expect(routeOf(file)).toBe(route);
  });

  test.each([
    "AGENTS.md",
    "docs/diagrams/abc.svg",
    "docs/guide/fr/data-sources.md",
    "docs/guide/de/README.md",
  ])("%s is not a page", (file) => {
    expect(routeOf(file)).toBeNull();
  });

  test("segments are the route under /wissen", () => {
    expect(segmentsOf("docs/guide/README.md")).toEqual([]);
    expect(segmentsOf("docs/adr/README.md")).toEqual(["dev", "adr"]);
  });
});

describe("languages", () => {
  test("guide pages carry their folder's language, the rest is English", () => {
    expect(langOf("docs/guide/de/glossary.md")).toBe("de");
    expect(langOf("docs/rendering.md")).toBe("en");
    expect(langOf("docs/guide/README.md")).toBeNull();
  });

  test("a guide page's twin is the same file in the other language", () => {
    expect(twinOf("docs/guide/de/data-journey.md")).toEqual({
      lang: "en",
      file: "docs/guide/en/data-journey.md",
    });
    expect(twinOf("docs/rendering.md")).toBeNull();
  });
});

describe("resolveHref", () => {
  const pages = new Set([
    "docs/README.md",
    "docs/data-pipeline.md",
    "docs/adr/README.md",
    "docs/guide/de/glossary.md",
    "docs/guide/en/glossary.md",
  ]);

  test("a link between docs goes to the page, anchor kept", () => {
    expect(
      resolveHref(
        "docs/guide/de/how-it-works.md",
        "../../data-pipeline.md#provenance",
        pages
      )
    ).toEqual({ kind: "page", href: "/wissen/dev/data-pipeline#provenance" });
    expect(resolveHref("docs/guide/de/x.md", "./glossary.md", pages)).toEqual({
      kind: "page",
      href: "/wissen/de/glossary",
    });
  });

  test("a folder link finds its README", () => {
    expect(resolveHref("docs/README.md", "./adr/", pages)).toEqual({
      kind: "page",
      href: "/wissen/dev/adr",
    });
  });

  test("anything outside docs/ goes to GitHub", () => {
    expect(resolveHref("docs/README.md", "../AGENTS.md", pages)).toEqual({
      kind: "external",
      href: `${REPO_URL}/blob/main/AGENTS.md`,
    });
    expect(resolveHref("docs/README.md", "../scripts/", pages)).toEqual({
      kind: "external",
      href: `${REPO_URL}/tree/main/scripts/`.replace(/\/$/u, ""),
    });
  });

  test("absolute URLs and in-page anchors stay as written", () => {
    for (const href of ["https://example.org/x", "mailto:a@b.c", "#top"]) {
      expect(resolveHref("docs/README.md", href, pages).href).toBe(href);
    }
  });

  test("joinPath normalises like POSIX path.join", () => {
    expect(joinPath("docs/guide/de", "../../x.md")).toBe("docs/x.md");
    expect(joinPath("docs", "./a/./b/../c.md")).toBe("docs/a/c.md");
  });
});
