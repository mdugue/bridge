import { expect, test } from "bun:test";
import { RENDER_STYLES } from "@/lib/city/render-style";
import { STYLE_PENS } from "./stylize-effect";

// setStyle returns early for a mode without pens: a new picture style that
// forgets its pen would draw with the previous style's lines, silently.
// (The Schwarzplan draws no ink, so it has none.)
test("every inked picture style has its pens", () => {
  const missing = RENDER_STYLES.filter(
    (style) => style.inkWeight > 0 && !STYLE_PENS[style.shaderMode]
  ).map((style) => style.id);
  expect(missing).toEqual([]);
});
