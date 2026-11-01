import { expect, test } from "bun:test";
import { dictationProblem, speakable } from "./ask-voice";

test("an answer is heard without links, list marks or Markdown, with units as words", () => {
  expect(
    speakable(
      "Die **Frauenkirche** ist 91 m hoch (https://www.wikidata.org/wiki/Q157229).\n- Kuppel: 1 200 m²"
    )
  ).toBe("Die Frauenkirche ist 91 Meter hoch. Kuppel: 1 200 Quadratmeter");
});

test("a Markdown link is heard by its words", () => {
  expect(
    speakable("Mehr bei [Wikipedia](https://de.wikipedia.org/wiki/Zwinger).")
  ).toBe("Mehr bei Wikipedia.");
});

test("a recognition error the visitor caused says nothing, others say why", () => {
  expect(dictationProblem("no-speech")).toBeNull();
  expect(dictationProblem("aborted")).toBeNull();
  expect(dictationProblem("not-allowed")).toContain("Mikrofon");
  expect(dictationProblem("whatever")).toBeTruthy();
});
