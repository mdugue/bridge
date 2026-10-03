import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DRESDEN } from "../../sites/dresden";
import { LOOK_CONTROLS } from "../city/look-controls";

/**
 * The user guide names every scenic view and every look slider the HUD
 * shows, in both languages: a new viewpoint or slider fails here until both
 * guides describe it (the guide once missed five viewpoints and claimed the
 * Großer Garten had none).
 */
const GUIDES = ["en", "de"].map((lang) =>
  join(import.meta.dir, "../../docs/guide", lang, "using-the-viewer.md")
);

const LABELS = [
  ...DRESDEN.viewpoints.map((v) => v.label),
  ...LOOK_CONTROLS.map((c) => c.label),
];

describe("the guide names what the HUD shows", () => {
  for (const path of GUIDES) {
    test(path.split("docs/")[1] ?? path, () => {
      // Labels wrap across lines ("*Brühlsche\n    Terrasse*").
      const text = readFileSync(path, "utf8").replace(/\s+/g, " ");
      const missing = LABELS.filter((label) => !text.includes(label));
      expect(missing).toEqual([]);
    });
  }
});
