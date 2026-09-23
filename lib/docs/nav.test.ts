import { expect, test } from "bun:test";
import { navGroups, orderByIndex } from "./nav";

const FILES = [
  "docs/README.md",
  "docs/adr/0001-a.md",
  "docs/adr/0002-b.md",
  "docs/adr/README.md",
  "docs/data-flow.md",
  "docs/guide/README.md",
  "docs/guide/de/data-sources.md",
  "docs/guide/de/how-it-works.md",
  "docs/guide/en/data-sources.md",
  "docs/guide/en/how-it-works.md",
  "docs/rendering.md",
];

const MARKDOWN: Record<string, string> = {
  "docs/README.md":
    "[r](./rendering.md) [a](./adr/README.md) [g](../AGENTS.md)",
  "docs/adr/README.md": "[2](./0002-b.md) [1](./0001-a.md)",
  "docs/guide/README.md":
    "[h](./en/how-it-works.md) [h](./de/how-it-works.md) [d](./en/data-sources.md) [d](./de/data-sources.md)",
};

test("an index gives the order, the rest follows alphabetically", () => {
  expect(
    orderByIndex("docs/README.md", MARKDOWN["docs/README.md"] ?? "", [
      "docs/data-flow.md",
      "docs/rendering.md",
      "docs/adr/README.md",
    ])
  ).toEqual(["docs/rendering.md", "docs/adr/README.md", "docs/data-flow.md"]);
});

test("the menu: guide per language, developer docs with folders nested", () => {
  const groups = navGroups(
    FILES,
    (f) => MARKDOWN[f] ?? "",
    (f) => f
  );
  expect(groups.map((g) => g.id)).toEqual(["de", "en", "dev"]);
  expect(groups[0]?.items.map((i) => i.href)).toEqual([
    "/wissen/de/how-it-works",
    "/wissen/de/data-sources",
  ]);
  const dev = groups[2]?.items ?? [];
  expect(dev.map((i) => i.href)).toEqual([
    "/wissen/dev",
    "/wissen/dev/rendering",
    "/wissen/dev/adr",
    "/wissen/dev/data-flow",
  ]);
  expect(dev[2]?.children.map((i) => i.href)).toEqual([
    "/wissen/dev/adr/0002-b",
    "/wissen/dev/adr/0001-a",
  ]);
});
