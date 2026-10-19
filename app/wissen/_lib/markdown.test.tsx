import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderDoc } from "./markdown";

describe("renderDoc", () => {
  test("a fence in a language the highlighter did not load up front still renders", async () => {
    const markdown = [
      "```json",
      '{ "tiles": 15 }',
      "```",
      "",
      "```no-such-language",
      "plain words",
      "```",
    ].join("\n");
    const { content } = await renderDoc(
      "docs/example.md",
      markdown,
      new Set(),
      "en"
    );
    const html = renderToStaticMarkup(content);
    // a grammar Shiki bundles loads on demand: its tokens are coloured
    expect(html).toMatch(/style="color:#[0-9A-F]{6}">&quot;tiles&quot;/iu);
    // one it does not know is plain text, not a failed build
    expect(html).toContain("<span>plain words</span>");
  });
});
