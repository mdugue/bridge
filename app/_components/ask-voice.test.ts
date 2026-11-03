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

test("a link with brackets in it goes whole, and a bracketed source with it", () => {
  expect(
    speakable(
      "Die [Frauenkirche](https://de.wikipedia.org/wiki/Frauenkirche_(Dresden)) steht am Neumarkt (Quelle: https://de.wikipedia.org/wiki/Neumarkt_(Dresden))."
    )
  ).toBe("Die Frauenkirche steht am Neumarkt.");
  expect(
    speakable("Siehe https://de.wikipedia.org/wiki/Zwinger_(Dresden) dort.")
  ).toBe("Siehe dort.");
});

test("lines are heard as sentences, ids keep their underscores, a link leaves the full stop", () => {
  expect(
    speakable("**Fakten:**\n- Höhe: 40 m\n- Raum: 300 m³\nKennung DESN_0815")
  ).toBe("Fakten: Höhe: 40 Meter. Raum: 300 Kubikmeter. Kennung DESN_0815");
  expect(speakable("Siehe https://x.de/a.")).toBe("Siehe.");
  // a number before the line's end is no ordinal
  expect(speakable("Baujahr: 1726\nArchitekt: George Bähr")).toBe(
    "Baujahr: 1726, Architekt: George Bähr"
  );
});

test("a date at a line's start is no list mark", () => {
  expect(speakable("13. Februar 1945: die Bomben.\n1743.\nWeiter")).toBe(
    "13. Februar 1945: die Bomben. 1743. Weiter"
  );
});

test("a word after a number that starts with m stays a word", () => {
  expect(
    speakable("Seit 1945 müssen die 2 mächtigen Türme 91 m hoch sein.")
  ).toBe("Seit 1945 müssen die 2 mächtigen Türme 91 Meter hoch sein.");
});
