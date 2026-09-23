import { describe, expect, test } from "bun:test";
import { descriptionOf, linkTargets, plainText, titleOf } from "./content";

describe("content", () => {
  test("plain text drops inline Markdown", () => {
    expect(
      plainText("The **DGM1** via [`prepare-data.ts`](../x.md) and *NDVI*")
    ).toBe("The DGM1 via prepare-data.ts and NDVI");
  });

  test("the title is the first level-one heading", () => {
    expect(titleOf("intro\n# Der Weg der Daten\n## Station 1")).toBe(
      "Der Weg der Daten"
    );
    expect(titleOf("no heading")).toBeNull();
  });

  test("the description skips the language switch and cuts at a sentence", () => {
    const md = [
      "# Woher die Daten kommen",
      "",
      "*English: [Where the data comes from](../en/data-sources.md)*",
      "",
      "Alles im Viewer ist aus **offenen Daten** abgeleitet. Nichts wurde selbst vermessen.",
    ].join("\n");
    expect(descriptionOf(md)).toBe(
      "Alles im Viewer ist aus offenen Daten abgeleitet. Nichts wurde selbst vermessen."
    );
    expect(descriptionOf(md, 60)).toBe(
      "Alles im Viewer ist aus offenen Daten abgeleitet."
    );
  });

  test("link targets come in reading order", () => {
    expect(linkTargets("[a](./a.md) then [b](b.md#x)")).toEqual([
      "./a.md",
      "b.md#x",
    ]);
  });
});
