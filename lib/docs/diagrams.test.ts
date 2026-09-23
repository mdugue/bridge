import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  authoredColors,
  DIAGRAM_COLORS,
  DIAGRAM_DIR,
  diagramKey,
  diagramVar,
  INHERITED,
  mermaidBlocks,
  rgbOf,
  strayPaint,
  themeSvg,
} from "./diagrams";
import { docFiles } from "./files";

const ROOT = path.join(import.meta.dir, "..", "..");

describe("diagram sources", () => {
  test("mermaid blocks are found as written, other fences are not", () => {
    const md = "a\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```ts\nx\n```\n";
    expect(mermaidBlocks(md)).toEqual(["flowchart LR\n  A --> B"]);
  });

  test("the key ignores trailing whitespace but not content", () => {
    expect(diagramKey("A --> B  \n")).toBe(diagramKey("A --> B"));
    expect(diagramKey("A --> B")).not.toBe(diagramKey("A --> C"));
  });
});

describe("theming", () => {
  test("sentinels become the page's variables, alpha kept as a mix", () => {
    const svg = `<rect fill="${DIAGRAM_COLORS.node}"/><p style="background-color:rgba(254, 1, 8, 0.5)"/>`;
    expect(themeSvg(svg, '"Inter Variable", sans-serif')).toBe(
      `<rect fill="var(${diagramVar("node")})"/><p style="background-color:color-mix(in srgb, var(${diagramVar("labelBackground")}) 50%, transparent)"/>`
    );
  });

  test("every spelling of the measured font becomes --font-sans", () => {
    const out = themeSvg(
      `a{font-family:"Inter Variable",sans-serif}b{font-family:"Inter Variable", sans-serif}`,
      '"Inter Variable", sans-serif'
    );
    expect(out).not.toContain("Inter Variable");
    expect(out.match(/var\(--font-sans\)/gu)).toHaveLength(2);
  });

  test("only colours from neither the theme nor the diagram are stray", () => {
    expect(
      strayPaint(
        [
          rgbOf(DIAGRAM_COLORS.line),
          rgbOf("#fef3c7"),
          INHERITED,
          "none",
          "rgba(0, 0, 0, 0)",
          "rgb(0, 0, 0)",
        ],
        authoredColors("classDef planned fill:#fef3c7")
      )
    ).toEqual(["rgb(0, 0, 0)"]);
  });
});

// The committed SVGs against the Markdown: a diagram edited without
// `bun run docs:diagrams` fails here, before the build does.
describe("committed diagrams", () => {
  const blocks = docFiles(path.join(ROOT, "docs")).flatMap((file) =>
    mermaidBlocks(readFileSync(path.join(ROOT, file), "utf8")).map(
      (source) => ({
        file,
        key: diagramKey(source),
      })
    )
  );
  const dir = path.join(ROOT, DIAGRAM_DIR);

  test.each(blocks)("$file has its SVG ($key)", ({ key }) => {
    expect(existsSync(path.join(dir, `${key}.svg`))).toBe(true);
  });

  test("no SVG is left over from a diagram that changed or went", () => {
    const wanted = new Set(blocks.map((b) => `${b.key}.svg`));
    const stale = readdirSync(dir).filter(
      (f) => f.endsWith(".svg") && !wanted.has(f)
    );
    expect(stale).toEqual([]);
  });

  test("no committed SVG carries a sentinel or the measured font", () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".svg"))) {
      const svg = readFileSync(path.join(dir, f), "utf8");
      for (const hex of Object.values(DIAGRAM_COLORS)) {
        expect(svg.toLowerCase()).not.toContain(hex);
      }
      expect(svg).not.toContain("Inter Variable");
    }
  });
});
